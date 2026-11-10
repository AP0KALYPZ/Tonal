use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};
use crate::imaging::decode::{decode_source, file_checksum, file_size, proxy_data_url};
use crate::imaging::png::encode_png;
use crate::imaging::render::{render, render_with_image, validate_export_size, RenderSpec};
use crate::models::{
    background_color, ExportMode, ExportProgress, ExportResult, ImportedSource, PdfExportRequest,
    PngExportRequest, SourceReference,
};
use crate::paper::{compute_print_layout, print_warnings};
use crate::paths::{
    application_sources_dir, atomic_write_bytes, cleanup_temp,
    default_export_dir as resolve_export_dir, finalize_atomic, path_exists as path_is_present,
    resolve_source_path as resolve_path, reveal_in_folder as reveal_path, safe_clipboard_filename,
    source_reference as build_reference, temporary_path_for, validate_output_path,
};
use crate::pdf::write_reference_pdf;

const MAX_PROJECT_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PRINT_PAGES: u32 = 500;

#[derive(Clone, Default)]
pub struct JobRegistry {
    jobs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl JobRegistry {
    pub fn register(&self, job_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.insert(job_id.to_string(), Arc::clone(&flag));
        }
        flag
    }

    pub fn cancel(&self, job_id: &str) -> bool {
        if let Ok(jobs) = self.jobs.lock() {
            if let Some(flag) = jobs.get(job_id) {
                flag.store(true, Ordering::SeqCst);
                return true;
            }
        }
        false
    }

    pub fn finish(&self, job_id: &str) {
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.remove(job_id);
        }
    }
}

fn emit_progress(app: &AppHandle, job_id: &str, stage: &str, fraction: f64, message: &str) {
    let _ = app.emit(
        "tonal://export-progress",
        ExportProgress {
            job_id: job_id.to_string(),
            stage: stage.to_string(),
            progress: fraction.clamp(0.0, 1.0),
            message: message.to_string(),
        },
    );
}

pub fn build_imported_source(path: &Path, display_name: Option<&str>) -> AppResult<ImportedSource> {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let source = decode_source(&canonical)?;
    let oriented_width = source.image.width();
    let oriented_height = source.image.height();
    let (proxy_width, proxy_height, data_url) = proxy_data_url(&source.image, source.has_alpha)?;
    let mut warnings = source.warnings;
    if u64::from(oriented_width) * u64::from(oriented_height) > 120_000_000 {
        warnings.push(
            "This is a very large photo. Exporting at full resolution may take a while, but your source is untouched."
                .to_string(),
        );
    }

    Ok(ImportedSource {
        path: canonical.to_string_lossy().to_string(),
        filename: display_name
            .map(|name| name.to_string())
            .or_else(|| {
                canonical
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| "reference".to_string()),
        oriented_width,
        oriented_height,
        proxy_width,
        proxy_height,
        data_url,
        format: source.format,
        has_alpha: source.has_alpha,
        checksum_sha256: file_checksum(&canonical)?,
        bytes: file_size(&canonical),
        warnings,
    })
}

#[tauri::command]
pub async fn import_image(path: String) -> Result<ImportedSource, AppError> {
    tauri::async_runtime::spawn_blocking(move || build_imported_source(Path::new(&path), None))
        .await
        .map_err(|error| AppError::new(format!("Image import stopped unexpectedly: {error}")))?
}

#[tauri::command]
pub async fn import_clipboard_image(
    app: AppHandle,
    bytes_base64: String,
    extension: String,
    filename: String,
) -> Result<ImportedSource, AppError> {
    let normalized_extension = match extension.to_ascii_lowercase().as_str() {
        "png" => "png",
        "jpg" | "jpeg" => "jpg",
        "webp" => "webp",
        _ => {
            return Err(AppError::new(
                "The clipboard image must be PNG, JPG or WebP.",
            ))
        }
    };
    let data = bytes_base64
        .split_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(&bytes_base64);
    let bytes = BASE64
        .decode(data)
        .map_err(|_| AppError::new("The clipboard image could not be read."))?;
    if bytes.is_empty() {
        return Err(AppError::new("The clipboard does not contain an image."));
    }
    let display_name = filename
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("pasted-reference")
        .to_string();

    tauri::async_runtime::spawn_blocking(move || -> AppResult<ImportedSource> {
        let directory = application_sources_dir(&app)?;
        let path = directory.join(safe_clipboard_filename(&display_name, normalized_extension));
        fs::write(&path, &bytes)?;
        let result = build_imported_source(&path, Some(&display_name));
        if result.is_err() {
            let _ = fs::remove_file(&path);
        }
        result
    })
    .await
    .map_err(|error| AppError::new(format!("Clipboard import stopped unexpectedly: {error}")))?
}

fn validate_project_document(json: &str) -> AppResult<Value> {
    if json.len() as u64 > MAX_PROJECT_BYTES {
        return Err(AppError::new("This project file is too large to open."));
    }
    let value: Value = serde_json::from_str(json)?;
    let object = value
        .as_object()
        .ok_or_else(|| AppError::new("The project file is not a TONAL project."))?;
    if object.get("kind").and_then(Value::as_str) != Some("tonal.project") {
        return Err(AppError::new("The project file is not a TONAL project."));
    }
    let version = object
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| AppError::new("The project file is missing its schema version."))?;
    if version > 1 {
        return Err(AppError::new(format!(
            "This project uses schema version {version}, which this copy of TONAL does not understand. Update TONAL to open it."
        )));
    }
    Ok(value)
}

#[tauri::command]
pub fn save_project(path: String, json: String) -> Result<(), AppError> {
    validate_project_document(&json)?;
    let destination = PathBuf::from(&path);
    if !destination.is_absolute() {
        return Err(AppError::new("Choose an absolute project path."));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new("Choose a folder for the project."))?;
    if !parent.is_dir() {
        return Err(AppError::new(
            "That folder no longer exists. Choose another project location.",
        ));
    }
    atomic_write_bytes(&destination, json.as_bytes())
}

#[tauri::command]
pub fn load_project(path: String) -> Result<String, AppError> {
    let source = Path::new(&path);
    if !source.is_file() {
        return Err(AppError::new(
            "This project could not be found. It may have moved or been deleted.",
        ));
    }
    let metadata = fs::metadata(source)?;
    if metadata.len() > MAX_PROJECT_BYTES {
        return Err(AppError::new("This project file is too large to open."));
    }
    let json = fs::read_to_string(source)?;
    validate_project_document(&json)?;
    Ok(json)
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    path_is_present(&path)
}

#[tauri::command]
pub fn default_export_dir(app: AppHandle) -> String {
    resolve_export_dir(&app)
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), AppError> {
    reveal_path(&path)
}

#[tauri::command]
pub fn source_reference(project_path: String, source_path: String) -> SourceReference {
    build_reference(&project_path, &source_path)
}

#[tauri::command]
pub fn resolve_source_path(
    project_path: String,
    original_path: Option<String>,
    relative_path: Option<String>,
) -> Option<String> {
    resolve_path(
        &project_path,
        original_path.as_deref(),
        relative_path.as_deref(),
    )
}

#[tauri::command]
pub fn cancel_job(job_id: String, jobs: State<'_, JobRegistry>) -> bool {
    jobs.cancel(&job_id)
}

fn validate_export_geometry(
    columns: u32,
    rows: u32,
    grid: &crate::models::GridSettings,
) -> AppResult<()> {
    if columns == 0 || rows == 0 {
        return Err(AppError::new("Grid columns and rows must be positive."));
    }
    if grid.columns != columns || grid.rows != rows {
        return Err(AppError::new(
            "The grid settings do not match the requested export geometry.",
        ));
    }
    grid.validate()
}

fn validate_square_pixels(
    width: u32,
    height: u32,
    columns: u32,
    rows: u32,
    true_square: bool,
) -> AppResult<()> {
    if !true_square {
        return Ok(());
    }
    if columns == 0 || rows == 0 || width % columns != 0 || height % rows != 0 {
        return Err(AppError::new(
            "True-square export dimensions must be whole multiples of the grid.",
        ));
    }
    if width / columns != height / rows {
        return Err(AppError::new(
            "True-square export dimensions produce unequal cell sizes.",
        ));
    }
    Ok(())
}

fn execute_png_export(
    request: PngExportRequest,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(&str, f64, &str) -> AppResult<()>,
) -> AppResult<ExportResult> {
    let destination = validate_output_path(&request.output_path, "png")?;
    request.crop.validate()?;
    validate_export_geometry(request.columns, request.rows, &request.grid)?;
    validate_export_size(request.width, request.height)?;
    validate_square_pixels(
        request.width,
        request.height,
        request.columns,
        request.rows,
        request.grid.true_square_cells,
    )?;
    if request.mode.wants_photo() && !Path::new(&request.source_path).is_file() {
        return Err(AppError::new(
            "The source photo could not be found. Relink it before exporting.",
        ));
    }
    if request.mode.wants_grid() && !request.grid.visible {
        return Err(AppError::new(
            "The grid is hidden. Turn on the grid before exporting grid content.",
        ));
    }

    let temp = temporary_path_for(&destination);
    let result = (|| -> AppResult<ExportResult> {
        progress("render", 0.01, "Preparing full-resolution export")?;
        let spec = RenderSpec {
            source_path: PathBuf::from(&request.source_path),
            mode: request.mode,
            crop: request.crop,
            mirror: request.mirror,
            tone: request.tone.clone(),
            study: request.study.clone(),
            study_in_export: request.study_in_export,
            grid: request.grid.clone(),
            labels_in_export: request.labels_in_export,
            background: background_color(&request.background),
            width: request.width,
            height: request.height,
        };
        let mut render_progress = |stage: &str, fraction: f64, message: &str| -> AppResult<()> {
            if cancel.load(Ordering::SeqCst) {
                return Err(AppError::cancelled());
            }
            progress(stage, fraction, message)
        };
        let frame = render(&spec, &mut render_progress)?;
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::cancelled());
        }
        progress("encode", 0.93, "Encoding lossless PNG")?;
        let dpi = request.dpi.clamp(1, 1200);
        let bytes = encode_png(&temp, &frame, dpi)?;
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::cancelled());
        }
        progress("write", 0.98, "Writing file atomically")?;
        finalize_atomic(&temp, &destination)?;
        progress("write", 1.0, "Export complete")?;
        Ok(ExportResult {
            path: destination.to_string_lossy().to_string(),
            width: frame.width(),
            height: frame.height(),
            bytes,
            pages: None,
            warnings: Vec::new(),
        })
    })();

    if result.is_err() {
        cleanup_temp(&temp);
    }
    result
}

fn run_png_export(
    app: &AppHandle,
    request: PngExportRequest,
    cancel: &AtomicBool,
) -> AppResult<ExportResult> {
    let job_id = request.job_id.clone();
    let mut progress = |stage: &str, fraction: f64, message: &str| -> AppResult<()> {
        emit_progress(app, &job_id, stage, fraction, message);
        Ok(())
    };
    execute_png_export(request, cancel, &mut progress)
}

fn run_pdf_export(
    app: &AppHandle,
    request: PdfExportRequest,
    cancel: &AtomicBool,
) -> AppResult<ExportResult> {
    let destination = validate_output_path(&request.output_path, "pdf")?;
    request.crop.validate()?;
    validate_export_geometry(request.columns, request.rows, &request.grid)?;
    if !Path::new(&request.source_path).is_file() {
        return Err(AppError::new(
            "The source photo could not be found. Relink it before printing.",
        ));
    }

    let temp = temporary_path_for(&destination);
    let job_id = request.job_id.clone();
    let result = (|| -> AppResult<ExportResult> {
        emit_progress(
            app,
            &job_id,
            "layout",
            0.01,
            "Reading source for print layout",
        );
        let source = decode_source(Path::new(&request.source_path))?;
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::cancelled());
        }
        let layout = compute_print_layout(
            &request.paper,
            &request.print,
            &request.crop,
            source.image.width(),
            source.image.height(),
            request.columns,
            request.rows,
        );
        if layout.pages > MAX_PRINT_PAGES {
            return Err(AppError::new(format!(
                "This print would need {} pages. Reduce the drawing area, lower the print scale, or choose a larger page.",
                layout.pages
            )));
        }
        let image_width = layout.printed_pixel_width;
        let image_height =
            ((f64::from(image_width) * layout.frame_h_mm / layout.frame_w_mm).round() as u32)
                .max(1);
        validate_export_size(image_width, image_height)?;

        emit_progress(app, &job_id, "layout", 0.05, "Tiling print layout");
        let spec = RenderSpec {
            source_path: PathBuf::from(&request.source_path),
            mode: ExportMode::Combined,
            crop: request.crop,
            mirror: request.mirror,
            tone: request.tone.clone(),
            study: request.study.clone(),
            study_in_export: request.study_in_export,
            grid: request.grid.clone(),
            labels_in_export: request.labels_in_export,
            background: background_color(&request.background),
            width: image_width,
            height: image_height,
        };
        let mut progress = |stage: &str, fraction: f64, message: &str| -> AppResult<()> {
            if cancel.load(Ordering::SeqCst) {
                return Err(AppError::cancelled());
            }
            emit_progress(app, &job_id, stage, fraction, message);
            Ok(())
        };
        let frame = render_with_image(&spec, source.image, &mut progress, 0.08)?;
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::cancelled());
        }
        emit_progress(app, &job_id, "write", 0.92, "Writing print-ready PDF");
        let bytes = write_reference_pdf(
            &temp,
            &frame,
            &layout,
            request.columns,
            request.rows,
            request.grid.true_square_cells,
        )?;
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::cancelled());
        }
        finalize_atomic(&temp, &destination)?;
        emit_progress(app, &job_id, "write", 1.0, "Print PDF complete");
        let warnings = print_warnings(&layout, request.grid.true_square_cells);
        Ok(ExportResult {
            path: destination.to_string_lossy().to_string(),
            width: image_width,
            height: image_height,
            bytes,
            pages: Some(layout.pages),
            warnings,
        })
    })();

    if result.is_err() {
        cleanup_temp(&temp);
    }
    result
}

#[tauri::command]
pub async fn export_png(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    request: PngExportRequest,
) -> Result<ExportResult, AppError> {
    let registry = jobs.inner().clone();
    let cancel = registry.register(&request.job_id);
    let job_id = request.job_id.clone();
    let worker_app = app.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || run_png_export(&worker_app, request, &cancel))
            .await;
    registry.finish(&job_id);
    result.map_err(|error| AppError::new(format!("PNG export stopped unexpectedly: {error}")))?
}

#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    request: PdfExportRequest,
) -> Result<ExportResult, AppError> {
    let registry = jobs.inner().clone();
    let cancel = registry.register(&request.job_id);
    let job_id = request.job_id.clone();
    let worker_app = app.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || run_pdf_export(&worker_app, request, &cancel))
            .await;
    registry.finish(&job_id);
    result.map_err(|error| AppError::new(format!("PDF export stopped unexpectedly: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_project() -> String {
        serde_json::json!({
            "kind": "tonal.project",
            "schemaVersion": 1,
            "appVersion": "1.0.0",
            "title": "Test",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "updatedAt": "2026-01-01T00:00:00.000Z",
            "source": null,
            "grid": {},
            "composition": {},
            "tone": {},
            "study": {},
            "paper": {},
            "print": {},
            "exportDefaults": {}
        })
        .to_string()
    }

    #[test]
    fn project_documents_require_tonal_kind_and_supported_schema() {
        assert!(validate_project_document(&sample_project()).is_ok());
        let wrong_kind = sample_project().replace("tonal.project", "other.project");
        assert!(validate_project_document(&wrong_kind).is_err());
        let future = sample_project().replace("\"schemaVersion\":1", "\"schemaVersion\":9");
        assert!(validate_project_document(&future).is_err());
        assert!(validate_project_document("not json").is_err());
    }

    #[test]
    fn square_pixel_validation_rejects_unequal_cells() {
        assert!(validate_square_pixels(1000, 1000, 10, 10, true).is_ok());
        assert!(validate_square_pixels(1000, 1000, 8, 10, true).is_err());
        assert!(validate_square_pixels(1001, 1000, 10, 10, true).is_err());
        assert!(validate_square_pixels(1000, 1001, 10, 10, true).is_err());
        assert!(validate_square_pixels(1000, 700, 8, 10, false).is_ok());
    }

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "tonal-command-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            name
        ))
    }

    fn export_request(
        source: &std::path::Path,
        output: &std::path::Path,
        mode: ExportMode,
    ) -> PngExportRequest {
        PngExportRequest {
            job_id: "test-job".to_string(),
            source_path: source.to_string_lossy().to_string(),
            output_path: output.to_string_lossy().to_string(),
            mode,
            crop: crate::models::CropRect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            columns: 2,
            rows: 2,
            mirror: false,
            tone: crate::models::ToneSettings::default(),
            study: crate::models::StudySettings {
                enabled: false,
                levels: 5,
            },
            study_in_export: false,
            grid: crate::models::GridSettings {
                visible: true,
                columns: 2,
                rows: 2,
                true_square_cells: true,
                color: "#FF0000".to_string(),
                custom_color: "#FF0000".to_string(),
                opacity: 1.0,
                thickness: 1.0,
                major_every: 0,
                major_thickness: 1.8,
                labels_enabled: false,
                label_placement: "cells".to_string(),
                border: false,
            },
            labels_in_export: false,
            background: "#FFFFFF".to_string(),
            dpi: 300,
            width: 40,
            height: 40,
        }
    }

    #[test]
    fn full_png_export_writes_combined_and_transparent_files() {
        let source_path = temp_path("source.png");
        let mut source = image::RgbaImage::from_pixel(40, 40, image::Rgba([0, 0, 0, 255]));
        for (x, y, pixel) in source.enumerate_pixels_mut() {
            if x > 20 {
                *pixel = image::Rgba([255, 255, 255, 255]);
            }
            if y > 20 {
                *pixel = image::Rgba([80, 80, 80, 255]);
            }
        }
        encode_png(&source_path, &source, 72).unwrap();

        let combined_path = temp_path("combined.png");
        let mut stages = Vec::new();
        let result = execute_png_export(
            export_request(&source_path, &combined_path, ExportMode::Combined),
            &AtomicBool::new(false),
            &mut |stage, _, _| {
                stages.push(stage.to_string());
                Ok(())
            },
        )
        .unwrap();
        assert_eq!((result.width, result.height), (40, 40));
        assert!(result.bytes > 0);
        assert!(stages.iter().any(|stage| stage == "encode"));
        let combined = image::open(&combined_path).unwrap().to_rgba8();
        assert_eq!(combined.dimensions(), (40, 40));
        assert_eq!(combined.get_pixel(10, 10)[3], 255);
        assert!(combined.get_pixel(20, 10)[0] > 80);

        let photo_path = temp_path("photo.png");
        execute_png_export(
            export_request(&source_path, &photo_path, ExportMode::Photo),
            &AtomicBool::new(false),
            &mut |_, _, _| Ok(()),
        )
        .unwrap();
        let photo = image::open(&photo_path).unwrap().to_rgba8();
        assert_eq!(photo.dimensions(), (40, 40));
        let photo_pixel = photo.get_pixel(10, 10);
        assert_eq!(photo_pixel[0], photo_pixel[1]);
        assert_eq!(photo_pixel[1], photo_pixel[2]);

        let grid_path = temp_path("grid.png");
        execute_png_export(
            export_request(&source_path, &grid_path, ExportMode::Grid),
            &AtomicBool::new(false),
            &mut |_, _, _| Ok(()),
        )
        .unwrap();
        let only_grid = image::open(&grid_path).unwrap().to_rgba8();
        assert_eq!(only_grid.get_pixel(10, 10)[3], 0);
        assert!(only_grid.get_pixel(20, 10)[3] > 0);

        let _ = std::fs::remove_file(source_path);
        let _ = std::fs::remove_file(combined_path);
        let _ = std::fs::remove_file(photo_path);
        let _ = std::fs::remove_file(grid_path);
    }

    #[test]
    fn cancelled_export_writes_nothing() {
        let source_path = temp_path("cancel-source.png");
        encode_png(
            &source_path,
            &image::RgbaImage::from_pixel(20, 20, image::Rgba([0, 0, 0, 255])),
            72,
        )
        .unwrap();
        let output_path = temp_path("cancel-output.png");
        let result = execute_png_export(
            export_request(&source_path, &output_path, ExportMode::Grid),
            &AtomicBool::new(true),
            &mut |_, _, _| Ok(()),
        );
        assert!(result.is_err());
        assert!(!output_path.exists());
        let _ = std::fs::remove_file(source_path);
    }

    #[test]
    fn project_save_and_load_roundtrip_replaces_existing_file() {
        let path = temp_path("project.tonal");
        let project_path = path.to_string_lossy().to_string();
        let first = sample_project().replace("Test", "First title");
        save_project(project_path.clone(), first.clone()).unwrap();
        assert_eq!(load_project(project_path.clone()).unwrap(), first);

        let second = sample_project().replace("Test", "Second title");
        save_project(project_path.clone(), second.clone()).unwrap();
        assert_eq!(load_project(project_path).unwrap(), second);
        let _ = std::fs::remove_file(path);
    }
}
