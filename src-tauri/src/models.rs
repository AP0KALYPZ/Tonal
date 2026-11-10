use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct CropRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl CropRect {
    pub fn validate(&self) -> Result<(), AppError> {
        if ![self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
        {
            return Err(AppError::invalid("The crop contains an invalid number."));
        }
        if self.width <= 0.0
            || self.height <= 0.0
            || self.x < -1e-6
            || self.y < -1e-6
            || self.x + self.width > 1.0 + 1e-6
            || self.y + self.height > 1.0 + 1e-6
        {
            return Err(AppError::invalid(
                "The crop must stay inside the original photo.",
            ));
        }
        Ok(())
    }

    pub fn center_x(&self) -> f64 {
        self.x + self.width / 2.0
    }

    pub fn center_y(&self) -> f64 {
        self.y + self.height / 2.0
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToneSettings {
    pub grayscale: bool,
    pub brightness: f64,
    pub contrast: f64,
    pub shadows: f64,
    pub highlights: f64,
    pub gamma: f64,
    pub black_point: f64,
    pub white_point: f64,
}

impl Default for ToneSettings {
    fn default() -> Self {
        Self {
            grayscale: true,
            brightness: 0.0,
            contrast: 0.0,
            shadows: 0.0,
            highlights: 0.0,
            gamma: 1.0,
            black_point: 0.0,
            white_point: 255.0,
        }
    }
}

impl ToneSettings {
    pub fn sanitized(&self) -> Self {
        let black = self.black_point.clamp(0.0, 254.0).round();
        let mut white = self.white_point.clamp(1.0, 255.0).round();
        if white <= black {
            white = (black + 1.0).min(255.0);
        }
        Self {
            grayscale: self.grayscale,
            brightness: clamp_finite(self.brightness, -100.0, 100.0, 0.0),
            contrast: clamp_finite(self.contrast, -100.0, 100.0, 0.0),
            shadows: clamp_finite(self.shadows, -100.0, 100.0, 0.0),
            highlights: clamp_finite(self.highlights, -100.0, 100.0, 0.0),
            gamma: clamp_finite(self.gamma, 0.25, 3.0, 1.0),
            black_point: black,
            white_point: white,
        }
    }
}

fn clamp_finite(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
}

fn finite_max(value: f64, min: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.max(min)
    } else {
        fallback
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudySettings {
    pub enabled: bool,
    pub levels: u32,
}

impl StudySettings {
    pub fn levels(&self) -> u32 {
        self.levels.clamp(3, 9)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridSettings {
    pub visible: bool,
    pub columns: u32,
    pub rows: u32,
    pub true_square_cells: bool,
    pub color: String,
    pub custom_color: String,
    pub opacity: f64,
    pub thickness: f64,
    pub major_every: u32,
    pub major_thickness: f64,
    pub labels_enabled: bool,
    pub label_placement: String,
    pub border: bool,
}

impl GridSettings {
    pub fn validate(&self) -> Result<(), AppError> {
        if !(1..=100).contains(&self.columns) || !(1..=100).contains(&self.rows) {
            return Err(AppError::invalid(
                "Grid columns and rows must be between 1 and 100.",
            ));
        }
        if self.opacity.is_nan() || self.thickness.is_nan() {
            return Err(AppError::invalid("The grid contains an invalid number."));
        }
        Ok(())
    }

    pub fn opacity(&self) -> f64 {
        if self.opacity.is_finite() {
            self.opacity.clamp(0.0, 1.0)
        } else {
            1.0
        }
    }

    pub fn thickness(&self) -> f64 {
        if self.thickness.is_finite() {
            self.thickness.clamp(0.5, 3.0)
        } else {
            1.0
        }
    }

    pub fn major_thickness(&self) -> f64 {
        if self.major_thickness.is_finite() {
            self.major_thickness.clamp(1.0, 2.5)
        } else {
            1.8
        }
    }

    pub fn perimeter_labels(&self) -> bool {
        self.label_placement == "perimeter"
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportMode {
    Combined,
    Photo,
    Grid,
}

impl ExportMode {
    pub fn wants_photo(self) -> bool {
        matches!(self, ExportMode::Combined | ExportMode::Photo)
    }

    pub fn wants_grid(self) -> bool {
        matches!(self, ExportMode::Combined | ExportMode::Grid)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PngExportRequest {
    pub job_id: String,
    pub source_path: String,
    pub output_path: String,
    pub mode: ExportMode,
    pub crop: CropRect,
    pub columns: u32,
    pub rows: u32,
    pub mirror: bool,
    pub tone: ToneSettings,
    pub study: StudySettings,
    pub study_in_export: bool,
    pub grid: GridSettings,
    pub labels_in_export: bool,
    pub background: String,
    pub dpi: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperSettings {
    pub unit: String,
    pub width: f64,
    pub height: f64,
}

pub fn unit_to_mm(value: f64, unit: &str) -> f64 {
    match unit {
        "cm" => value * 10.0,
        "in" => value * 25.4,
        _ => value,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintSettings {
    pub page: String,
    pub custom_width_mm: f64,
    pub custom_height_mm: f64,
    pub orientation: String,
    pub margin_mm: f64,
    pub overlap_mm: f64,
    pub scale_percent: f64,
    pub dpi: u32,
}

impl PrintSettings {
    pub fn dpi(&self) -> u32 {
        self.dpi.clamp(72, 600)
    }

    pub fn scale(&self) -> f64 {
        if self.scale_percent.is_finite() {
            (self.scale_percent / 100.0).clamp(0.1, 10.0)
        } else {
            1.0
        }
    }

    pub fn landscape(&self) -> bool {
        self.orientation == "landscape"
    }

    pub fn page_mm(&self) -> (f64, f64) {
        let (mut width, mut height) = match self.page.as_str() {
            "letter" => (215.9, 279.4),
            "a3" => (297.0, 420.0),
            "custom" => (
                finite_max(self.custom_width_mm, 50.0, 210.0),
                finite_max(self.custom_height_mm, 50.0, 297.0),
            ),
            _ => (210.0, 297.0),
        };
        if self.landscape() {
            std::mem::swap(&mut width, &mut height);
            (width.max(height), width.min(height))
        } else {
            (width.min(height), width.max(height))
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportRequest {
    pub job_id: String,
    pub source_path: String,
    pub output_path: String,
    pub crop: CropRect,
    pub columns: u32,
    pub rows: u32,
    pub mirror: bool,
    pub tone: ToneSettings,
    pub study: StudySettings,
    pub study_in_export: bool,
    pub grid: GridSettings,
    pub labels_in_export: bool,
    pub background: String,
    pub paper: PaperSettings,
    pub print: PrintSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSource {
    pub path: String,
    pub filename: String,
    pub oriented_width: u32,
    pub oriented_height: u32,
    pub proxy_width: u32,
    pub proxy_height: u32,
    pub data_url: String,
    pub format: String,
    pub has_alpha: bool,
    pub checksum_sha256: String,
    pub bytes: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub job_id: String,
    pub stage: String,
    pub progress: f64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<u32>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReference {
    pub original_path: String,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

pub fn parse_hex_color(value: &str, fallback: Rgb) -> Rgb {
    let trimmed = value.trim().trim_start_matches('#');
    if trimmed.len() != 6 {
        return fallback;
    }
    let parsed = u32::from_str_radix(trimmed, 16);
    match parsed {
        Ok(number) => Rgb {
            r: ((number >> 16) & 0xFF) as u8,
            g: ((number >> 8) & 0xFF) as u8,
            b: (number & 0xFF) as u8,
        },
        Err(_) => fallback,
    }
}

pub fn background_color(value: &str) -> Rgb {
    parse_hex_color(
        value,
        Rgb {
            r: 255,
            g: 255,
            b: 255,
        },
    )
}
