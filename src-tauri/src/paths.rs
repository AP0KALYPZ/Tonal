use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::models::SourceReference;

pub fn path_exists(path: &str) -> bool {
    Path::new(path).exists()
}

pub fn default_export_dir(app: &AppHandle) -> String {
    let resolver = app.path();
    resolver
        .picture_dir()
        .or_else(|_| resolver.document_dir())
        .or_else(|_| resolver.home_dir())
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

pub fn reveal_in_folder(path: &str) -> AppResult<()> {
    let target = Path::new(path);
    if !target.exists() {
        return Err(AppError::new(
            "That file is no longer in this location. It may have been moved or deleted.",
        ));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", target.display()))
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg("-R").arg(target).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = target.parent().unwrap_or(target);
        Command::new("xdg-open").arg(parent).spawn()?;
    }
    Ok(())
}

fn unique_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{}-{}", std::process::id(), nanos)
}

pub fn temporary_path_for(destination: &Path) -> PathBuf {
    let filename = destination
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".to_string());
    let temp_name = format!(".{}.tonal-tmp-{}", filename, unique_suffix());
    destination.with_file_name(temp_name)
}

pub fn finalize_atomic(temp: &Path, destination: &Path) -> AppResult<()> {
    // `std::fs::rename` replaces an existing destination on Windows and Unix.
    // The finished temp file is renamed in one step, so an interrupted export
    // never leaves a truncated destination or deletes the previous file early.
    fs::rename(temp, destination)?;
    Ok(())
}

pub fn cleanup_temp(temp: &Path) {
    if temp.exists() {
        let _ = fs::remove_file(temp);
    }
}

pub fn atomic_write_bytes(destination: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = destination.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(AppError::new(
                "That folder no longer exists. Choose another export location.",
            ));
        }
    }
    let temp = temporary_path_for(destination);
    let result = (|| -> AppResult<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_all()?;
        finalize_atomic(&temp, destination)
    })();
    if result.is_err() {
        cleanup_temp(&temp);
    }
    result
}

pub fn validate_output_path(path: &str, extension: &str) -> AppResult<PathBuf> {
    if path.trim().is_empty() {
        return Err(AppError::new(
            "Choose a file name and folder for the export.",
        ));
    }
    let destination = PathBuf::from(path);
    if !destination.is_absolute() {
        return Err(AppError::new(
            "Choose an absolute export path with the native file dialog.",
        ));
    }
    let expected = extension.to_ascii_lowercase();
    let actual = destination
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if actual != expected {
        return Err(AppError::new(format!(
            "The export file must use the .{extension} extension."
        )));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new("Choose a folder for the export."))?;
    if !parent.is_dir() {
        return Err(AppError::new(
            "That folder no longer exists. Choose another export location.",
        ));
    }
    Ok(destination)
}

/// Store a path relative to the project when the source sits inside the project
/// folder; keep the absolute path as a recovery hint.
pub fn source_reference(project_path: &str, source_path: &str) -> SourceReference {
    let project = PathBuf::from(project_path);
    let project_dir = project.parent().unwrap_or(Path::new("."));
    let source = PathBuf::from(source_path);
    let canonical_project_dir = project_dir
        .canonicalize()
        .unwrap_or_else(|_| project_dir.to_path_buf());
    let canonical_source = source.canonicalize().unwrap_or(source.clone());

    let relative_path = canonical_source
        .strip_prefix(&canonical_project_dir)
        .ok()
        .filter(|relative| !relative.as_os_str().is_empty())
        .map(|relative| relative.to_string_lossy().replace('\\', "/"));

    SourceReference {
        original_path: canonical_source.to_string_lossy().to_string(),
        relative_path,
    }
}

pub fn resolve_source_path(
    project_path: &str,
    original_path: Option<&str>,
    relative_path: Option<&str>,
) -> Option<String> {
    let project = PathBuf::from(project_path);
    let project_dir = project.parent().unwrap_or(Path::new("."));
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(relative) = relative_path {
        if !relative.trim().is_empty() {
            candidates.push(project_dir.join(relative));
        }
    }
    if let Some(original) = original_path {
        if !original.trim().is_empty() {
            let original_path = PathBuf::from(original);
            candidates.push(original_path.clone());
            if let Some(name) = original_path.file_name() {
                candidates.push(project_dir.join(name));
            }
        }
    }

    for candidate in candidates {
        if candidate.is_file() {
            return Some(
                candidate
                    .canonicalize()
                    .unwrap_or(candidate)
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    None
}

pub fn application_sources_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| AppError::new("TONAL could not resolve its local data folder."))?
        .join("sources");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn safe_clipboard_filename(filename: &str, extension: &str) -> String {
    let stem: String = filename
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect();
    let stem = stem.trim_matches('-');
    let stem = if stem.is_empty() {
        "pasted-reference"
    } else {
        stem
    };
    format!("{}-{}.{}", stem, unique_suffix(), extension)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tonal-paths-{}-{}-{}",
            std::process::id(),
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(dir.join("references")).unwrap();
        dir
    }

    #[test]
    fn project_relative_source_recovers_after_move() {
        let dir = temp_dir("relative");
        let source = dir.join("references").join("portrait.png");
        fs::write(&source, b"source").unwrap();
        let project = dir.join("drawing.tonal");
        let reference = source_reference(&project.to_string_lossy(), &source.to_string_lossy());
        assert_eq!(
            reference.relative_path.as_deref(),
            Some("references/portrait.png")
        );

        let resolved = resolve_source_path(
            &project.to_string_lossy(),
            None,
            reference.relative_path.as_deref(),
        );
        let canonical_source = source.canonicalize().unwrap().to_string_lossy().to_string();
        assert_eq!(resolved.as_deref(), Some(canonical_source.as_str()));

        fs::remove_file(&source).unwrap();
        assert!(resolve_source_path(
            &project.to_string_lossy(),
            Some(reference.original_path.as_str()),
            None,
        )
        .is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn atomic_write_replaces_without_leaving_temp_files() {
        let dir = temp_dir("atomic");
        let destination = dir.join("reference.tonal");
        atomic_write_bytes(&destination, b"first").unwrap();
        atomic_write_bytes(&destination, b"second").unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"second");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().contains("tonal-tmp"))
            .collect();
        assert!(leftovers.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn output_path_must_use_the_requested_extension() {
        let dir = temp_dir("extension");
        let png = dir.join("image.png");
        assert!(validate_output_path(&png.to_string_lossy(), "png").is_ok());
        assert!(validate_output_path(&png.to_string_lossy(), "pdf").is_err());
        let _ = fs::remove_dir_all(dir);
    }
}
