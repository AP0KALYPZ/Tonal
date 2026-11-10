//! Physical print layout, mirrored from `src/lib/paper.ts`. The drawing area is
//! the artist's chosen rectangle; the PDF page is only the paper it is tiled onto.

use crate::models::{unit_to_mm, CropRect, PaperSettings, PrintSettings};

pub const MM_PER_INCH: f64 = 25.4;

#[derive(Debug, Clone)]
pub struct PrintLayout {
    pub area_w_mm: f64,
    pub area_h_mm: f64,
    pub fit_w_mm: f64,
    pub fit_h_mm: f64,
    pub scale: f64,
    pub frame_w_mm: f64,
    pub frame_h_mm: f64,
    pub cell_w_mm: f64,
    pub cell_h_mm: f64,
    pub square_cells: bool,
    pub area_ratio_mismatch: bool,
    pub page_w_mm: f64,
    pub page_h_mm: f64,
    pub margin_mm: f64,
    pub content_w_mm: f64,
    pub content_h_mm: f64,
    pub overlap_mm: f64,
    pub tiles_x: u32,
    pub tiles_y: u32,
    pub pages: u32,
    pub printed_pixel_width: u32,
    #[allow(dead_code)]
    pub printed_pixel_height: u32,
    pub page_label: String,
}

fn finite_clamp(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
}

pub fn fit_rect(area_w: f64, area_h: f64, aspect: f64) -> (f64, f64) {
    let mut width = area_w;
    let mut height = area_w / aspect;
    if height > area_h {
        height = area_h;
        width = area_h * aspect;
    }
    (width, height)
}

#[cfg(test)]
pub fn physical_cells(paper: &PaperSettings, columns: u32, rows: u32) -> (f64, f64, bool, f64) {
    let width_mm = unit_to_mm(paper.width, &paper.unit).max(10.0);
    let height_mm = unit_to_mm(paper.height, &paper.unit).max(10.0);
    let cell_w = width_mm / f64::from(columns.max(1));
    let cell_h = height_mm / f64::from(rows.max(1));
    let difference = (cell_w - cell_h).abs() / cell_w.max(cell_h).max(1e-9) * 100.0;
    (cell_w, cell_h, difference < 0.1, difference)
}

pub fn compute_print_layout(
    paper: &PaperSettings,
    print: &PrintSettings,
    crop: &CropRect,
    source_width: u32,
    source_height: u32,
    columns: u32,
    rows: u32,
) -> PrintLayout {
    let columns = columns.max(1);
    let rows = rows.max(1);
    let area_w = unit_to_mm(paper.width, &paper.unit).max(10.0);
    let area_h = unit_to_mm(paper.height, &paper.unit).max(10.0);
    let crop_w = (crop.width * f64::from(source_width)).max(1.0);
    let crop_h = (crop.height * f64::from(source_height)).max(1.0);
    let aspect = crop_w / crop_h;

    let (fit_w, fit_h) = fit_rect(area_w, area_h, aspect);
    let scale = print.scale();
    let frame_w = fit_w * scale;
    let frame_h = fit_h * scale;

    let (page_w, page_h) = print.page_mm();
    let margin = finite_clamp(print.margin_mm, 0.0, page_w.min(page_h) / 3.0, 10.0);
    let content_w = (page_w - margin * 2.0).max(20.0);
    let content_h = (page_h - margin * 2.0).max(20.0);
    let overlap = finite_clamp(print.overlap_mm, 0.0, content_w.min(content_h) / 2.0, 10.0);

    let advance_x = (content_w - overlap).max(10.0);
    let advance_y = (content_h - overlap).max(10.0);
    let tiles_x = (((frame_w - overlap) / advance_x).ceil() as i64).max(1) as u32;
    let tiles_y = (((frame_h - overlap) / advance_y).ceil() as i64).max(1) as u32;
    let pages = tiles_x.saturating_mul(tiles_y).max(1);

    let dpi = print.dpi();
    let printed_pixel_width = ((frame_w / MM_PER_INCH) * f64::from(dpi)).round().max(1.0) as u32;
    let printed_pixel_height = ((frame_h / MM_PER_INCH) * f64::from(dpi)).round().max(1.0) as u32;

    let cell_w = frame_w / f64::from(columns);
    let cell_h = frame_h / f64::from(rows);
    let square_cells = (cell_w - cell_h).abs() < 1e-6 * cell_w.max(cell_h);
    let target_aspect = f64::from(columns) / f64::from(rows);
    let area_aspect = area_w / area_h;
    let area_ratio_mismatch = (area_aspect - target_aspect).abs() / target_aspect > 0.001;

    let page_label = match print.page.as_str() {
        "letter" => "Letter",
        "a3" => "A3",
        "custom" => "Custom page",
        _ => "A4",
    }
    .to_string();

    PrintLayout {
        area_w_mm: area_w,
        area_h_mm: area_h,
        fit_w_mm: fit_w,
        fit_h_mm: fit_h,
        scale,
        frame_w_mm: frame_w,
        frame_h_mm: frame_h,
        cell_w_mm: cell_w,
        cell_h_mm: cell_h,
        square_cells,
        area_ratio_mismatch,
        page_w_mm: page_w,
        page_h_mm: page_h,
        margin_mm: margin,
        content_w_mm: content_w,
        content_h_mm: content_h,
        overlap_mm: overlap,
        tiles_x,
        tiles_y,
        pages,
        printed_pixel_width,
        printed_pixel_height,
        page_label,
    }
}

pub fn print_warnings(layout: &PrintLayout, true_square_cells: bool) -> Vec<String> {
    let mut warnings = Vec::new();
    if true_square_cells && layout.area_ratio_mismatch {
        warnings.push(format!(
            "Your drawing area is {:.1} × {:.1} mm, which does not match the grid ratio. The reference will print at {:.1} × {:.1} mm with square cells and unused space.",
            layout.area_w_mm, layout.area_h_mm, layout.fit_w_mm, layout.fit_h_mm
        ));
    }
    if !layout.square_cells {
        warnings.push(format!(
            "Printed cells would be {:.2} × {:.2} mm — rectangular, not square.",
            layout.cell_w_mm, layout.cell_h_mm
        ));
    }
    if (layout.scale - 1.0).abs() > 1e-9 {
        warnings.push(format!(
            "Printing at {}% changes the actual cell size. Use 100% for ruler-accurate squares.",
            (layout.scale * 100.0).round()
        ));
    }
    warnings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::PrintSettings;

    fn paper(width: f64, height: f64) -> PaperSettings {
        PaperSettings {
            unit: "mm".to_string(),
            width,
            height,
        }
    }

    fn print(margin: f64, overlap: f64, scale: f64) -> PrintSettings {
        PrintSettings {
            page: "a4".to_string(),
            custom_width_mm: 210.0,
            custom_height_mm: 297.0,
            orientation: "portrait".to_string(),
            margin_mm: margin,
            overlap_mm: overlap,
            scale_percent: scale,
            dpi: 300,
        }
    }

    fn crop() -> CropRect {
        CropRect {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        }
    }

    #[test]
    fn physical_cells_detect_square_and_rectangular_cells() {
        let (w, h, square, _) = physical_cells(&paper(200.0, 300.0), 4, 6);
        assert!((w - 50.0).abs() < 1e-9);
        assert!((h - 50.0).abs() < 1e-9);
        assert!(square);

        let (w, h, square, difference) = physical_cells(&paper(200.0, 300.0), 4, 5);
        assert!((w - 50.0).abs() < 1e-9);
        assert!((h - 60.0).abs() < 1e-9);
        assert!(!square);
        assert!(difference > 0.1);
    }

    #[test]
    fn a4_20cm_square_at_default_margin_needs_two_tiles() {
        let layout = compute_print_layout(
            &paper(200.0, 200.0),
            &print(10.0, 10.0, 100.0),
            &crop(),
            4000,
            4000,
            10,
            10,
        );
        assert_eq!(layout.tiles_x, 2);
        assert_eq!(layout.tiles_y, 1);
        assert_eq!(layout.pages, 2);
        assert!(layout.square_cells);
    }

    #[test]
    fn a4_20cm_square_with_5mm_margin_fits_one_page() {
        let layout = compute_print_layout(
            &paper(200.0, 200.0),
            &print(5.0, 10.0, 100.0),
            &crop(),
            4000,
            4000,
            10,
            10,
        );
        assert_eq!(layout.tiles_x, 1);
        assert_eq!(layout.tiles_y, 1);
        assert_eq!(layout.pages, 1);
    }

    #[test]
    fn a3_30_by_40_cm_tiles_to_two_pages() {
        let layout = compute_print_layout(
            &paper(300.0, 400.0),
            &PrintSettings {
                page: "a3".to_string(),
                ..print(10.0, 10.0, 100.0)
            },
            &crop(),
            3000,
            4000,
            6,
            8,
        );
        assert_eq!((layout.tiles_x, layout.tiles_y), (2, 1));
        assert_eq!(layout.pages, 2);
    }

    #[test]
    fn large_print_is_tiled_and_sized_at_requested_dpi() {
        let layout = compute_print_layout(
            &paper(512.0, 800.0),
            &print(10.0, 10.0, 100.0),
            &crop(),
            3200,
            5000,
            8,
            10,
        );
        assert!(layout.pages >= 6);
        assert_eq!(layout.printed_pixel_width, 6047);
        assert!(layout.printed_pixel_height > 9000);
    }

    #[test]
    fn non_matching_area_reports_square_cell_fit_and_unused_space() {
        let layout = compute_print_layout(
            &paper(210.0, 297.0),
            &print(10.0, 10.0, 100.0),
            &crop(),
            4000,
            4000,
            10,
            10,
        );
        assert!(layout.area_ratio_mismatch);
        assert!(layout.fit_w_mm < layout.area_w_mm || layout.fit_h_mm < layout.area_h_mm);
        let warnings = print_warnings(&layout, true);
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("unused space")));
    }

    #[test]
    fn scale_warning_is_explicit() {
        let layout = compute_print_layout(
            &paper(200.0, 300.0),
            &print(10.0, 10.0, 50.0),
            &crop(),
            4000,
            6000,
            4,
            6,
        );
        assert!((layout.frame_w_mm - 100.0).abs() < 1e-9);
        assert!(print_warnings(&layout, true)
            .iter()
            .any(|warning| warning.contains("50%")));
    }
}
