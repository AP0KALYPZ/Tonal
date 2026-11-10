use std::path::PathBuf;

use image::imageops::FilterType;
use image::{DynamicImage, RgbaImage};

use crate::error::{AppError, AppResult};
use crate::imaging::decode::decode_oriented;
use crate::imaging::grid::draw_grid;
use crate::imaging::tones::apply_tone_rgba;
use crate::models::{CropRect, ExportMode, GridSettings, Rgb, StudySettings, ToneSettings};

pub const MAX_EXPORT_PIXELS: u64 = 268_435_456;
pub const MAX_EXPORT_EDGE: u32 = 60_000;

pub type ProgressCallback<'a> = &'a mut dyn FnMut(&str, f64, &str) -> AppResult<()>;

pub struct RenderSpec {
    pub source_path: PathBuf,
    pub mode: ExportMode,
    pub crop: CropRect,
    pub mirror: bool,
    pub tone: ToneSettings,
    pub study: StudySettings,
    pub study_in_export: bool,
    pub grid: GridSettings,
    pub labels_in_export: bool,
    pub background: Rgb,
    pub width: u32,
    pub height: u32,
}

pub fn validate_export_size(width: u32, height: u32) -> AppResult<()> {
    if width == 0 || height == 0 {
        return Err(AppError::new("The export dimensions must be positive."));
    }
    if width > MAX_EXPORT_EDGE || height > MAX_EXPORT_EDGE {
        return Err(AppError::new(format!(
            "Output must be at most {MAX_EXPORT_EDGE} px on either side."
        )));
    }
    if u64::from(width) * u64::from(height) > MAX_EXPORT_PIXELS {
        return Err(AppError::new(
            "This output is too large for available memory. Reduce the cell size or choose a native resolution.",
        ));
    }
    Ok(())
}

/// Crop rectangle in oriented-source pixels. The rect keeps the requested
/// aspect ratio; any remainder is sub-pixel rounding, never a stretch of the
/// source into a different shape.
pub fn crop_rect_pixels(
    source_width: u32,
    source_height: u32,
    crop: &CropRect,
    target_aspect: f64,
) -> (u32, u32, u32, u32) {
    if source_width == 0 || source_height == 0 {
        return (0, 0, 0, 0);
    }
    let mut width = crop.width * f64::from(source_width);
    let mut height = crop.height * f64::from(source_height);
    if width / height > target_aspect {
        width = height * target_aspect;
    } else {
        height = width / target_aspect;
    }
    width = width.clamp(1.0, f64::from(source_width));
    height = height.clamp(1.0, f64::from(source_height));

    let crop_width = width.round().clamp(1.0, f64::from(source_width)) as u32;
    let crop_height = height.round().clamp(1.0, f64::from(source_height)) as u32;
    let center_x = crop.center_x() * f64::from(source_width);
    let center_y = crop.center_y() * f64::from(source_height);
    let x = (center_x - f64::from(crop_width) / 2.0)
        .round()
        .clamp(0.0, f64::from(source_width - crop_width)) as u32;
    let y = (center_y - f64::from(crop_height) / 2.0)
        .round()
        .clamp(0.0, f64::from(source_height - crop_height)) as u32;
    (x, y, crop_width, crop_height)
}

pub fn render(spec: &RenderSpec, progress: ProgressCallback) -> AppResult<RgbaImage> {
    validate_export_size(spec.width, spec.height)?;
    if !spec.mode.wants_photo() {
        progress("grid", 0.2, "Rasterising grid")?;
        let mut frame = RgbaImage::new(spec.width, spec.height);
        draw_grid(&mut frame, &spec.grid, spec.labels_in_export);
        progress("grid", 1.0, "Grid ready")?;
        return Ok(frame);
    }

    progress("render", 0.02, "Decoding full-resolution photo")?;
    let source = decode_oriented(&spec.source_path)?;
    render_with_image(spec, source, progress, 0.02)
}

/// Render from an already decoded source, letting PDF export reuse the decode it
/// needed for the physical page layout.
pub fn render_with_image(
    spec: &RenderSpec,
    source: DynamicImage,
    progress: ProgressCallback,
    start_fraction: f64,
) -> AppResult<RgbaImage> {
    validate_export_size(spec.width, spec.height)?;
    if !spec.mode.wants_photo() {
        progress("grid", 0.2, "Rasterising grid")?;
        let mut frame = RgbaImage::new(spec.width, spec.height);
        draw_grid(&mut frame, &spec.grid, spec.labels_in_export);
        progress("grid", 1.0, "Grid ready")?;
        return Ok(frame);
    }

    let (source_width, source_height) = (source.width(), source.height());
    // Crop to the requested output aspect, not blindly to columns:rows. In free
    // rectangular mode the artist's crop ratio is authoritative; in true-square
    // mode the computed output is already exactly columns*cell by rows*cell.
    let target_aspect = f64::from(spec.width) / f64::from(spec.height.max(1));
    let (x, y, width, height) =
        crop_rect_pixels(source_width, source_height, &spec.crop, target_aspect);
    if width == 0 || height == 0 {
        return Err(AppError::new("The crop is empty. Enlarge the crop frame."));
    }

    progress("render", start_fraction + 0.16, "Cropping")?;
    let cropped = source.crop_imm(x, y, width, height);

    progress("render", start_fraction + 0.30, "Resampling")?;
    let resized = image::imageops::resize(
        &cropped.to_rgba8(),
        spec.width,
        spec.height,
        FilterType::Lanczos3,
    );
    drop(source);

    let mut frame = resized;
    progress("render", 0.62, "Applying tonal adjustments")?;
    let tone = spec.tone.sanitized();
    let study = StudySettings {
        enabled: spec.study.enabled && spec.study_in_export,
        levels: spec.study.levels(),
    };
    apply_tone_rgba(
        frame.as_mut(),
        &tone,
        &study,
        spec.background,
        &mut |fraction| {
            progress(
                "render",
                0.62 + fraction * 0.22,
                "Applying tonal adjustments",
            )
        },
    )?;

    if spec.mirror {
        progress("render", 0.86, "Mirroring")?;
        image::imageops::flip_horizontal_in_place(&mut frame);
    }

    if spec.mode.wants_grid() {
        progress("grid", 0.9, "Drawing grid and labels")?;
        draw_grid(&mut frame, &spec.grid, spec.labels_in_export);
    }
    progress("render", 1.0, "Frame ready")?;
    Ok(frame)
}

/// Kept separate so the crop aspect can be tested without a filesystem.
#[cfg(test)]
pub fn crop_aspect_test_helper(
    source_width: u32,
    source_height: u32,
    crop: &CropRect,
    columns: u32,
    rows: u32,
) -> (u32, u32, u32, u32) {
    crop_rect_pixels(
        source_width,
        source_height,
        crop,
        f64::from(columns) / f64::from(rows),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crop() -> CropRect {
        CropRect {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        }
    }

    #[test]
    fn full_landscape_crop_is_centered_and_keeps_grid_aspect() {
        let (x, y, width, height) = crop_aspect_test_helper(4000, 3000, &crop(), 4, 3);
        assert_eq!((width, height), (4000, 3000));
        assert_eq!((x, y), (0, 0));
    }

    #[test]
    fn wide_source_crops_horizontally_around_center() {
        let (x, y, width, height) = crop_aspect_test_helper(6000, 3000, &crop(), 2, 3);
        let ratio = f64::from(width) / f64::from(height);
        assert!((ratio - 2.0 / 3.0).abs() < 0.001);
        assert_eq!(height, 3000);
        assert!(x > 0);
        assert_eq!(y, 0);
        assert!((f64::from(x) + f64::from(width) / 2.0 - 3000.0).abs() < 2.0);
    }

    #[test]
    fn tall_source_crops_vertically_around_center() {
        let (x, y, width, height) = crop_aspect_test_helper(3000, 6000, &crop(), 3, 2);
        let ratio = f64::from(width) / f64::from(height);
        assert!((ratio - 1.5).abs() < 0.001);
        assert_eq!(width, 3000);
        assert!(y > 0);
        assert_eq!(x, 0);
    }

    #[test]
    fn crop_never_leaves_the_source() {
        let rect = CropRect {
            x: 0.73,
            y: 0.11,
            width: 0.26,
            height: 0.84,
        };
        let (x, y, width, height) = crop_aspect_test_helper(1234, 987, &rect, 7, 5);
        assert!(x + width <= 1234);
        assert!(y + height <= 987);
        assert!(width >= 1 && height >= 1);
    }

    #[test]
    fn oversized_output_is_rejected() {
        assert!(validate_export_size(0, 10).is_err());
        assert!(validate_export_size(MAX_EXPORT_EDGE + 1, 10).is_err());
        assert!(validate_export_size(30_000, 30_000).is_err());
        assert!(validate_export_size(4000, 3000).is_ok());
    }

    fn grid() -> GridSettings {
        GridSettings {
            visible: true,
            columns: 4,
            rows: 3,
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
        }
    }

    fn spec(
        source: &std::path::Path,
        mode: ExportMode,
        width: u32,
        height: u32,
        mirror: bool,
    ) -> RenderSpec {
        RenderSpec {
            source_path: source.to_path_buf(),
            mode,
            crop: crop(),
            mirror,
            tone: ToneSettings::default(),
            study: StudySettings {
                enabled: false,
                levels: 5,
            },
            study_in_export: false,
            grid: grid(),
            labels_in_export: false,
            background: Rgb {
                r: 255,
                g: 255,
                b: 255,
            },
            width,
            height,
        }
    }

    #[test]
    fn full_render_produces_grid_photo_and_transparent_modes() {
        let path = std::env::temp_dir().join(format!(
            "tonal-render-{}-{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut source = RgbaImage::new(400, 300);
        for (x, _y, pixel) in source.enumerate_pixels_mut() {
            *pixel = if x < 200 {
                image::Rgba([0, 0, 0, 255])
            } else {
                image::Rgba([255, 255, 255, 255])
            };
        }
        crate::imaging::png::encode_png(&path, &source, 72).unwrap();

        let combined = render(
            &spec(&path, ExportMode::Combined, 400, 300, false),
            &mut |_, _, _| Ok(()),
        )
        .unwrap();
        assert_eq!(combined.dimensions(), (400, 300));
        assert_eq!(combined.get_pixel(50, 50)[3], 255);
        assert_eq!(combined.get_pixel(50, 50)[0], 0);
        let line = combined.get_pixel(100, 50);
        assert!(line[0] > 100, "grid line should be red, got {line:?}");
        assert!(
            line[1] < 40,
            "grid line should not be grayscale, got {line:?}"
        );

        let photo = render(
            &spec(&path, ExportMode::Photo, 200, 150, false),
            &mut |_, _, _| Ok(()),
        )
        .unwrap();
        assert_eq!(photo.dimensions(), (200, 150));
        let photo_pixel = photo.get_pixel(50, 50);
        assert_eq!(photo_pixel[0], photo_pixel[1]);
        assert_eq!(photo_pixel[1], photo_pixel[2]);

        let only_grid = render(
            &spec(&path, ExportMode::Grid, 400, 300, false),
            &mut |_, _, _| Ok(()),
        )
        .unwrap();
        assert_eq!(only_grid.get_pixel(50, 50)[3], 0);
        assert!(only_grid.get_pixel(100, 50)[3] > 0);

        let mirrored = render(
            &spec(&path, ExportMode::Photo, 400, 300, true),
            &mut |_, _, _| Ok(()),
        )
        .unwrap();
        assert_eq!(mirrored.get_pixel(50, 150)[0], 255);
        assert_eq!(mirrored.get_pixel(350, 150)[0], 0);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn free_rectangular_export_preserves_the_artists_crop_ratio() {
        let path = std::env::temp_dir().join(format!(
            "tonal-free-crop-{}-{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut source = RgbaImage::from_pixel(400, 300, image::Rgba([128, 128, 128, 255]));
        for x in 0..400 {
            source.put_pixel(x, 0, image::Rgba([20, 220, 20, 255]));
            source.put_pixel(x, 299, image::Rgba([220, 220, 20, 255]));
        }
        crate::imaging::png::encode_png(&path, &source, 72).unwrap();
        let mut options = spec(&path, ExportMode::Photo, 400, 300, false);
        options.grid.columns = 3;
        options.grid.rows = 2;
        options.grid.true_square_cells = false;
        options.tone.grayscale = false;
        let rendered = render(&options, &mut |_, _, _| Ok(())).unwrap();
        assert_eq!(rendered.dimensions(), (400, 300));
        let top = rendered.get_pixel(20, 0);
        let bottom = rendered.get_pixel(20, 299);
        assert!(top[1] > top[0] + 60, "top edge was cropped away: {top:?}");
        assert!(
            bottom[0] > 120 && bottom[1] > 120,
            "bottom edge was cropped away: {bottom:?}"
        );
        let _ = std::fs::remove_file(path);
    }
}
