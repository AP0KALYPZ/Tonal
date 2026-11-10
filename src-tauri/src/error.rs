use std::fmt::{Display, Formatter};

use serde::ser::{Serialize, Serializer};

#[derive(Debug, Clone)]
pub struct AppError {
    message: String,
}

impl AppError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(message)
    }

    pub fn cancelled() -> Self {
        Self::new("Export cancelled. No finished file was written.")
    }
}

impl Display for AppError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.message)
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        let message = match error.kind() {
            std::io::ErrorKind::PermissionDenied => {
                "TONAL couldn't save to this location. Choose another folder or check access."
                    .to_string()
            }
            std::io::ErrorKind::NotFound => {
                "The file or folder could not be found. It may have moved or been renamed."
                    .to_string()
            }
            _ => format!("File access failed: {error}"),
        };
        Self::new(message)
    }
}

impl From<image::ImageError> for AppError {
    fn from(error: image::ImageError) -> Self {
        let message = match error {
            image::ImageError::Unsupported(_) => {
                "We couldn't open this file. Choose a JPG, PNG or WebP image.".to_string()
            }
            image::ImageError::Decoding(_) => {
                "The photo appears damaged or unreadable. Your current project is unchanged."
                    .to_string()
            }
            image::ImageError::Limits(_) => {
                "This photo is too large for available memory. Try a smaller source image."
                    .to_string()
            }
            other => format!("The photo could not be read: {other}"),
        };
        Self::new(message)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::new(format!(
            "The project file is damaged or is not valid JSON: {error}"
        ))
    }
}

impl From<png::EncodingError> for AppError {
    fn from(error: png::EncodingError) -> Self {
        Self::new(format!("The PNG could not be encoded: {error}"))
    }
}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        Self::new(message)
    }
}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        Self::new(message)
    }
}

pub type AppResult<T> = Result<T, AppError>;
