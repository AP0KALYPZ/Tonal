//! Minimal, dependency-free PDF 1.4 writer for tiled actual-size reference
//! printing. The frame is one Flate-compressed RGB image; page clipping and all
//! registration/text elements are vector operators, so tile seams stay sharp.

use std::fmt::Write as FmtWrite;
use std::io::Write as IoWrite;
use std::path::Path;

use flate2::write::ZlibEncoder;
use flate2::Compression;
use image::RgbaImage;

use crate::error::{AppError, AppResult};
use crate::paper::PrintLayout;
use crate::paths::atomic_write_bytes;

const PT_PER_MM: f64 = 72.0 / 25.4;

fn mm_to_pt(mm: f64) -> f64 {
    mm * PT_PER_MM
}

fn zlib(data: &[u8]) -> AppResult<Vec<u8>> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data)?;
    Ok(encoder.finish()?)
}

fn num(value: f64) -> String {
    let rounded = if value.abs() < 0.0005 { 0.0 } else { value };
    format!("{rounded:.3}")
}

fn escape_text(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '(' => escaped.push_str("\\("),
            ')' => escaped.push_str("\\)"),
            '\\' => escaped.push_str("\\\\"),
            '\n' | '\r' => escaped.push(' '),
            character if character.is_ascii() => escaped.push(character),
            _ => escaped.push('?'),
        }
    }
    escaped
}

fn text(content: &mut String, x: f64, y: f64, size: f64, value: &str) {
    let _ = write!(
        content,
        "BT /F1 {} Tf 0.28 g {} {} Td ({}) Tj ET\n",
        num(size),
        num(x),
        num(y),
        escape_text(value)
    );
}

fn line(content: &mut String, x1: f64, y1: f64, x2: f64, y2: f64) {
    let _ = write!(
        content,
        "{} {} m {} {} l S\n",
        num(x1),
        num(y1),
        num(x2),
        num(y2)
    );
}

fn registration_marks(content: &mut String, layout: &PrintLayout) {
    let margin = mm_to_pt(layout.margin_mm);
    let width = mm_to_pt(layout.content_w_mm);
    let height = mm_to_pt(layout.content_h_mm);
    let arm = mm_to_pt(3.0);
    let corners = [
        (margin, margin),
        (margin + width, margin),
        (margin, margin + height),
        (margin + width, margin + height),
    ];
    content.push_str("q\n0.4 G\n0.4 w\n");
    for (x, y) in corners {
        line(content, x - arm, y, x + arm, y);
        line(content, x, y - arm, x, y + arm);
        let _ = write!(
            content,
            "{} {} m {} {} l S\n",
            num(x - arm * 0.55),
            num(y - arm * 0.55),
            num(x + arm * 0.55),
            num(y + arm * 0.55)
        );
    }
    content.push_str("Q\n");
}

fn scale_check(content: &mut String, layout: &PrintLayout) {
    let page_width = mm_to_pt(layout.page_w_mm);
    let page_height = mm_to_pt(layout.page_h_mm);
    let margin = mm_to_pt(layout.margin_mm);
    let start = margin.max(mm_to_pt(6.0));
    let y = if margin >= mm_to_pt(8.0) {
        page_height - margin / 2.0
    } else {
        page_height - mm_to_pt(4.0)
    };
    let end = (start + mm_to_pt(20.0)).min(page_width - mm_to_pt(4.0));
    let tick = mm_to_pt(1.8);

    content.push_str("q\n0.15 G\n0.5 w\n");
    line(content, start, y, end, y);
    line(content, start, y - tick, start, y + tick);
    line(content, end, y - tick, end, y + tick);
    content.push_str("Q\n");
    text(content, start, y + tick + 2.0, 6.0, "20 mm ruler check");
}

fn footer(
    content: &mut String,
    layout: &PrintLayout,
    page_number: u32,
    column: u32,
    row: u32,
    columns: u32,
    rows: u32,
    true_square_cells: bool,
) {
    let page_width = mm_to_pt(layout.page_w_mm);
    let margin = mm_to_pt(layout.margin_mm);
    let footer_y = if layout.margin_mm >= 8.0 {
        margin * 0.35
    } else {
        6.0
    };
    let scale_label = if (layout.scale - 1.0).abs() < 1e-9 {
        "actual size 100%".to_string()
    } else {
        format!("print scale {}%", (layout.scale * 100.0).round())
    };
    let square = if true_square_cells && layout.square_cells {
        " square"
    } else {
        ""
    };
    let left = format!(
        "TONAL | {} | {scale_label} | {columns} x {rows} grid | {:.2} x {:.2} mm cells{square}",
        layout.page_label, layout.cell_w_mm, layout.cell_h_mm
    );
    let right = format!(
        "Page {page_number}/{} | row {}/{} col {}/{}",
        layout.pages,
        row + 1,
        layout.tiles_y,
        column + 1,
        layout.tiles_x
    );
    let left_width_guess = left.len() as f64 * 3.05;
    let right_width_guess = right.len() as f64 * 3.05;
    let right_x = (page_width - margin - right_width_guess).max(margin + left_width_guess + 6.0);
    text(content, margin.max(6.0), footer_y, 6.0, &left);
    text(content, right_x, footer_y, 6.0, &right);
}

fn page_content(
    layout: &PrintLayout,
    page_number: u32,
    column: u32,
    row: u32,
    columns: u32,
    rows: u32,
    true_square_cells: bool,
) -> String {
    let margin = mm_to_pt(layout.margin_mm);
    let content_width = mm_to_pt(layout.content_w_mm);
    let content_height = mm_to_pt(layout.content_h_mm);
    let frame_width = mm_to_pt(layout.frame_w_mm);
    let frame_height = mm_to_pt(layout.frame_h_mm);
    let advance_x = mm_to_pt((layout.content_w_mm - layout.overlap_mm).max(10.0));
    let advance_y = mm_to_pt((layout.content_h_mm - layout.overlap_mm).max(10.0));
    let image_x = margin - f64::from(column) * advance_x;
    let image_y = margin + content_height - frame_height + f64::from(row) * advance_y;

    let mut content = String::new();
    let _ = write!(
        content,
        "q\n{} {} {} {} re W n\n{} 0 0 {} {} {} cm\n/Im0 Do\nQ\n",
        num(margin),
        num(margin),
        num(content_width),
        num(content_height),
        num(frame_width),
        num(frame_height),
        num(image_x),
        num(image_y)
    );

    registration_marks(&mut content, layout);
    scale_check(&mut content, layout);
    footer(
        &mut content,
        layout,
        page_number,
        column,
        row,
        columns,
        rows,
        true_square_cells,
    );

    content
}

fn write_object(
    pdf: &mut Vec<u8>,
    offsets: &mut [usize],
    id: usize,
    dictionary: &str,
    stream: Option<&[u8]>,
) {
    offsets[id] = pdf.len();
    let _ = write!(pdf, "{id} 0 obj\n{dictionary}\n");
    if let Some(data) = stream {
        pdf.extend_from_slice(b"stream\n");
        pdf.extend_from_slice(data);
        pdf.extend_from_slice(b"\nendstream\n");
    }
    pdf.extend_from_slice(b"endobj\n");
}

pub fn write_reference_pdf(
    path: &Path,
    image: &RgbaImage,
    layout: &PrintLayout,
    columns: u32,
    rows: u32,
    true_square_cells: bool,
) -> AppResult<u64> {
    if image.width() == 0 || image.height() == 0 {
        return Err(AppError::new("The print image is empty."));
    }
    let pages = layout.pages.max(1);
    let (tiles_x, tiles_y) = (layout.tiles_x.max(1), layout.tiles_y.max(1));
    if pages != tiles_x.saturating_mul(tiles_y) {
        return Err(AppError::new("The print tile layout is inconsistent."));
    }

    let mut rgb = Vec::with_capacity((image.width() * image.height() * 3) as usize);
    for pixel in image.pixels() {
        rgb.push(pixel[0]);
        rgb.push(pixel[1]);
        rgb.push(pixel[2]);
    }
    let image_data = zlib(&rgb)?;

    let mut page_streams: Vec<Vec<u8>> = Vec::with_capacity(pages as usize);
    for row in 0..tiles_y {
        for column in 0..tiles_x {
            let page_number = row * tiles_x + column + 1;
            let content = page_content(
                layout,
                page_number,
                column,
                row,
                columns,
                rows,
                true_square_cells,
            );
            page_streams.push(zlib(content.as_bytes())?);
        }
    }

    let info_id = 5 + (pages as usize) * 2;
    let object_count = info_id + 1;
    let mut pdf = Vec::new();
    let mut offsets = vec![0usize; object_count];
    pdf.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    write_object(
        &mut pdf,
        &mut offsets,
        1,
        "<< /Type /Catalog /Pages 2 0 R >>",
        None,
    );

    let mut kids = String::new();
    for page in 0..pages {
        let _ = write!(kids, "{} 0 R ", 5 + page as usize * 2);
    }
    write_object(
        &mut pdf,
        &mut offsets,
        2,
        &format!(
            "<< /Type /Pages /Kids [{}] /Count {pages} >>",
            kids.trim_end()
        ),
        None,
    );

    write_object(
        &mut pdf,
        &mut offsets,
        3,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        None,
    );

    write_object(
        &mut pdf,
        &mut offsets,
        4,
        &format!(
            "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length {} >>",
            image.width(),
            image.height(),
            image_data.len()
        ),
        Some(&image_data),
    );

    let page_width = mm_to_pt(layout.page_w_mm);
    let page_height = mm_to_pt(layout.page_h_mm);

    for (index, stream) in page_streams.iter().enumerate() {
        let page_id = 5 + index * 2;
        let content_id = page_id + 1;
        write_object(
            &mut pdf,
            &mut offsets,
            page_id,
            &format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>",
                num(page_width),
                num(page_height)
            ),
            None,
        );
        write_object(
            &mut pdf,
            &mut offsets,
            content_id,
            &format!("<< /Filter /FlateDecode /Length {} >>", stream.len()),
            Some(stream),
        );
    }

    write_object(
        &mut pdf,
        &mut offsets,
        info_id,
        "<< /Title (TONAL reference) /Creator (TONAL) /Producer (TONAL 1.0.0) >>",
        None,
    );

    let xref_offset = pdf.len();
    let _ = write!(pdf, "xref\n0 {object_count}\n");
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        let _ = write!(pdf, "{offset:010} 00000 n \n");
    }
    let _ = write!(
        pdf,
        "trailer\n<< /Size {object_count} /Root 1 0 R /Info {info_id} 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
    );

    atomic_write_bytes(path, &pdf)?;
    Ok(std::fs::metadata(path)?.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CropRect, PaperSettings, PrintSettings};
    use crate::paper::compute_print_layout;
    use image::Rgba;

    fn temp_pdf(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "tonal-pdf-test-{}-{}-{}",
            std::process::id(),
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn settings(margin: f64) -> (PrintSettings, PaperSettings) {
        (
            PrintSettings {
                page: "a4".to_string(),
                custom_width_mm: 210.0,
                custom_height_mm: 297.0,
                orientation: "portrait".to_string(),
                margin_mm: margin,
                overlap_mm: 10.0,
                scale_percent: 100.0,
                dpi: 300,
            },
            PaperSettings {
                unit: "mm".to_string(),
                width: 200.0,
                height: 200.0,
            },
        )
    }

    fn layout(margin: f64) -> PrintLayout {
        let (print, paper) = settings(margin);
        compute_print_layout(
            &paper,
            &print,
            &CropRect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            2000,
            2000,
            10,
            10,
        )
    }

    #[test]
    fn pdf_has_valid_header_xref_and_trailer() {
        let path = temp_pdf("structure");
        let mut image = RgbaImage::new(64, 64);
        for pixel in image.pixels_mut() {
            *pixel = Rgba([40, 80, 120, 255]);
        }
        let layout = layout(10.0);
        assert_eq!(layout.pages, 2);
        write_reference_pdf(&path, &image, &layout, 10, 10, true).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        assert!(bytes.starts_with(b"%PDF-1.4"));
        assert!(bytes.ends_with(b"%%EOF\n"));
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("/Count 2"));
        assert!(text.contains("/Type /Page "));
        assert!(text.contains("/Width 64"));
        assert!(text.contains("Helvetica"));
        assert!(text.contains("/MediaBox [0 0 595.276 841.890]"));

        let startxref = text.rfind("startxref").unwrap();
        let offset: usize = text[startxref + "startxref".len()..]
            .trim()
            .split_whitespace()
            .next()
            .unwrap()
            .parse()
            .unwrap();
        assert!(bytes[offset..].starts_with(b"xref"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn pdf_object_count_matches_page_references() {
        let path = temp_pdf("objects");
        let image = RgbaImage::from_pixel(8, 8, Rgba([255, 255, 255, 255]));
        let layout = layout(5.0);
        assert_eq!(layout.pages, 1);
        write_reference_pdf(&path, &image, &layout, 10, 10, true).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("/Count 1"));
        assert!(text.contains("/Size 8"));
        assert!(text.contains("/Length"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn pdf_rejects_inconsistent_tile_counts() {
        let path = temp_pdf("bad-layout");
        let image = RgbaImage::from_pixel(8, 8, Rgba([255, 255, 255, 255]));
        let mut layout = layout(5.0);
        layout.pages = 9;
        assert!(write_reference_pdf(&path, &image, &layout, 10, 10, true).is_err());
        assert!(!path.exists());
    }
}
