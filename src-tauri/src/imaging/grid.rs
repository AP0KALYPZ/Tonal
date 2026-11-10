//! Native grid and label rasteriser. Geometry mirrors `gridRenderer.ts` and
//! `geometry.ts`; labels use a small built-in 5x7 font so exports do not depend
//! on system fonts or licensed font files.

use image::RgbaImage;

use crate::models::{parse_hex_color, GridSettings, Rgb};

const DEFAULT_GRID: Rgb = Rgb {
    r: 216,
    g: 183,
    b: 145,
};

pub fn grid_color(grid: &GridSettings) -> Rgb {
    let custom_fallback = parse_hex_color(&grid.custom_color, DEFAULT_GRID);
    parse_hex_color(&grid.color, custom_fallback)
}

pub fn base_line_width(width: u32, height: u32, columns: u32, rows: u32, thickness: f64) -> f64 {
    let cell = f64::from(width / columns.max(1)).min(f64::from(height / rows.max(1)));
    (cell * 0.012 * thickness).max(0.75)
}

/// Draw the configured grid and optional labels directly into an RGBA frame.
/// All measurements are frame-relative, so a 4K export and the on-screen proxy
/// share the same cell proportions.
pub fn draw_grid(image: &mut RgbaImage, grid: &GridSettings, labels: bool) {
    if !grid.visible {
        return;
    }
    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 || grid.columns == 0 || grid.rows == 0 {
        return;
    }
    let opacity = grid.opacity();
    if opacity <= 0.0 {
        return;
    }

    let color = grid_color(grid);
    let base = base_line_width(width, height, grid.columns, grid.rows, grid.thickness());
    let major = base * grid.major_thickness();
    let edge = if grid.border { base * 1.45 } else { base };
    let cell_width = f64::from(width) / f64::from(grid.columns);
    let cell_height = f64::from(height) / f64::from(grid.rows);

    for column in 0..=grid.columns {
        let x = if column == grid.columns {
            f64::from(width)
        } else {
            f64::from(width) * f64::from(column) / f64::from(grid.columns)
        };
        let line_width = if column == 0 || column == grid.columns {
            edge
        } else if grid.major_every >= 2 && column % grid.major_every == 0 {
            major
        } else {
            base
        };
        draw_vertical(image, x, line_width, color, opacity);
    }
    for row in 0..=grid.rows {
        let y = if row == grid.rows {
            f64::from(height)
        } else {
            f64::from(height) * f64::from(row) / f64::from(grid.rows)
        };
        let line_width = if row == 0 || row == grid.rows {
            edge
        } else if grid.major_every >= 2 && row % grid.major_every == 0 {
            major
        } else {
            base
        };
        draw_horizontal(image, y, line_width, color, opacity);
    }

    if !labels || !grid.labels_enabled {
        return;
    }

    let cell = cell_width.min(cell_height);
    let font_px = (cell * 0.16).clamp(5.0, 48.0);
    let scale = ((font_px / 7.0).round() as u32).max(1);
    let pad_x = (cell * 0.07).max(2.0) as i32;
    let pad_y = (cell * 0.06).max(2.0) as i32;

    if grid.perimeter_labels() {
        for column in 0..grid.columns {
            let label = column_label(column + 1);
            let x = (f64::from(column) * cell_width) as i32 + pad_x;
            let y = pad_y;
            draw_text(image, x, y, &label, scale, color, opacity);
        }
        for row in 0..grid.rows {
            let label = (row + 1).to_string();
            let x = pad_x;
            let y = (f64::from(row) * cell_height) as i32 + pad_y;
            draw_text(image, x, y, &label, scale, color, opacity);
        }
    } else {
        for row in 0..grid.rows {
            for column in 0..grid.columns {
                let label = format!("{}{}", column_label(column + 1), row + 1);
                let x = (f64::from(column) * cell_width) as i32 + pad_x;
                let y = (f64::from(row) * cell_height) as i32 + pad_y;
                draw_text(image, x, y, &label, scale, color, opacity);
            }
        }
    }
}

/// Excel-style labels: 1=A, 26=Z, 27=AA, 100=CV.
pub fn column_label(one_based: u32) -> String {
    let mut value = one_based.max(1);
    let mut label = String::new();
    while value > 0 {
        value -= 1;
        let character = char::from(b'A' + (value % 26) as u8);
        label.insert(0, character);
        value /= 26;
    }
    label
}

fn draw_vertical(image: &mut RgbaImage, center: f64, width: f64, color: Rgb, opacity: f64) {
    let half = width / 2.0;
    let start = (center - half).floor().max(0.0) as u32;
    let end = ((center + half).ceil() as i64).min(i64::from(image.width())) as u32;
    for x in start..end {
        let coverage = ((center + half).min(f64::from(x + 1)) - (center - half).max(f64::from(x)))
            .clamp(0.0, 1.0);
        if coverage <= 0.0 {
            continue;
        }
        let alpha = opacity * coverage;
        for y in 0..image.height() {
            blend_pixel(image, x, y, color, alpha);
        }
    }
}

fn draw_horizontal(image: &mut RgbaImage, center: f64, width: f64, color: Rgb, opacity: f64) {
    let half = width / 2.0;
    let start = (center - half).floor().max(0.0) as u32;
    let end = ((center + half).ceil() as i64).min(i64::from(image.height())) as u32;
    for y in start..end {
        let coverage = ((center + half).min(f64::from(y + 1)) - (center - half).max(f64::from(y)))
            .clamp(0.0, 1.0);
        if coverage <= 0.0 {
            continue;
        }
        let alpha = opacity * coverage;
        for x in 0..image.width() {
            blend_pixel(image, x, y, color, alpha);
        }
    }
}

fn blend_pixel(image: &mut RgbaImage, x: u32, y: u32, color: Rgb, alpha: f64) {
    if x >= image.width() || y >= image.height() {
        return;
    }
    let pixel = image.get_pixel_mut(x, y);
    let (destination_r, destination_g, destination_b) = (pixel[0], pixel[1], pixel[2]);
    let destination_alpha = f64::from(pixel[3]) / 255.0;
    let source_alpha = alpha.clamp(0.0, 1.0);
    let out_alpha = source_alpha + destination_alpha * (1.0 - source_alpha);
    if out_alpha <= 0.0 {
        pixel[0] = 0;
        pixel[1] = 0;
        pixel[2] = 0;
        pixel[3] = 0;
        return;
    }
    let mix = |source: u8, destination: u8| -> u8 {
        ((f64::from(source) * source_alpha
            + f64::from(destination) * destination_alpha * (1.0 - source_alpha))
            / out_alpha)
            .round()
            .clamp(0.0, 255.0) as u8
    };
    pixel[0] = mix(color.r, destination_r);
    pixel[1] = mix(color.g, destination_g);
    pixel[2] = mix(color.b, destination_b);
    pixel[3] = (out_alpha * 255.0).round().clamp(0.0, 255.0) as u8;
}

fn draw_text(
    image: &mut RgbaImage,
    x: i32,
    y: i32,
    text: &str,
    scale: u32,
    color: Rgb,
    opacity: f64,
) {
    let halo_offset = (scale / 2).max(1) as i32;
    let halo = Rgb {
        r: 10,
        g: 11,
        b: 11,
    };
    let halo_alpha = opacity * 0.55;
    for (dx, dy) in [
        (-halo_offset, 0),
        (halo_offset, 0),
        (0, -halo_offset),
        (0, halo_offset),
    ] {
        draw_string(image, x + dx, y + dy, text, scale, halo, halo_alpha);
    }
    draw_string(image, x, y, text, scale, color, opacity);
}

fn draw_string(
    image: &mut RgbaImage,
    x: i32,
    y: i32,
    text: &str,
    scale: u32,
    color: Rgb,
    opacity: f64,
) {
    let mut cursor = x;
    for character in text.chars() {
        if let Some(glyph) = glyph(character) {
            for (row, bits) in glyph.iter().enumerate() {
                for column in 0..5u32 {
                    if (*bits) & (1 << (4 - column)) == 0 {
                        continue;
                    }
                    for sy in 0..scale {
                        for sx in 0..scale {
                            let px = cursor + (column * scale + sx) as i32;
                            let py = y + (row as u32 * scale + sy) as i32;
                            if px >= 0
                                && py >= 0
                                && px < image.width() as i32
                                && py < image.height() as i32
                            {
                                blend_pixel(image, px as u32, py as u32, color, opacity);
                            }
                        }
                    }
                }
            }
        }
        cursor += (6 * scale) as i32;
    }
}

/// 5x7 bitmap glyphs, rows as 5-bit masks.
fn glyph(character: char) -> Option<[u8; 7]> {
    let rows = match character.to_ascii_uppercase() {
        'A' => [
            0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
        'B' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110,
        ],
        'C' => [
            0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110,
        ],
        'D' => [
            0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110,
        ],
        'E' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111,
        ],
        'F' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
        'G' => [
            0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111,
        ],
        'H' => [
            0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
        'I' => [
            0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110,
        ],
        'J' => [
            0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100,
        ],
        'K' => [
            0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001,
        ],
        'L' => [
            0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111,
        ],
        'M' => [
            0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001,
        ],
        'N' => [
            0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001,
        ],
        'O' => [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
        'P' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
        'Q' => [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101,
        ],
        'R' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001,
        ],
        'S' => [
            0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110,
        ],
        'T' => [
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        'U' => [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
        'V' => [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100,
        ],
        'W' => [
            0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001,
        ],
        'X' => [
            0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001,
        ],
        'Y' => [
            0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        'Z' => [
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111,
        ],
        '0' => [
            0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110,
        ],
        '1' => [
            0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110,
        ],
        '2' => [
            0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111,
        ],
        '3' => [
            0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110,
        ],
        '4' => [
            0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010,
        ],
        '5' => [
            0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110,
        ],
        '6' => [
            0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110,
        ],
        '7' => [
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000,
        ],
        '8' => [
            0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110,
        ],
        '9' => [
            0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100,
        ],
        _ => return None,
    };
    Some(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(visible: bool, labels: bool) -> GridSettings {
        GridSettings {
            visible,
            columns: 2,
            rows: 2,
            true_square_cells: true,
            color: "#D8B791".to_string(),
            custom_color: "#B98F62".to_string(),
            opacity: 1.0,
            thickness: 1.0,
            major_every: 0,
            major_thickness: 1.8,
            labels_enabled: labels,
            label_placement: "cells".to_string(),
            border: false,
        }
    }

    #[test]
    fn hidden_grid_leaves_frame_untouched() {
        let mut image = RgbaImage::new(64, 64);
        draw_grid(&mut image, &grid(false, true), true);
        assert!(image.pixels().all(|pixel| pixel[3] == 0));
    }

    #[test]
    fn lines_are_drawn_on_cell_boundaries_and_transparent_cells_remain_clear() {
        let mut image = RgbaImage::new(100, 100);
        draw_grid(&mut image, &grid(true, false), false);
        assert!(image.get_pixel(50, 20)[3] > 0);
        assert!(image.get_pixel(20, 50)[3] > 0);
        assert_eq!(image.get_pixel(25, 25)[3], 0);
        assert!(image.get_pixel(0, 0)[3] > 0);
    }

    #[test]
    fn labels_are_rasterised_inside_cells() {
        let mut image = RgbaImage::new(200, 200);
        draw_grid(&mut image, &grid(true, true), true);
        let mut label_pixels = 0;
        for y in 2..24 {
            for x in 2..30 {
                if image.get_pixel(x, y)[3] > 0 {
                    label_pixels += 1;
                }
            }
        }
        assert!(
            label_pixels > 10,
            "expected A1 label pixels, got {label_pixels}"
        );
    }

    #[test]
    fn labels_match_spreadsheet_columns() {
        assert_eq!(column_label(1), "A");
        assert_eq!(column_label(26), "Z");
        assert_eq!(column_label(27), "AA");
        assert_eq!(column_label(52), "AZ");
        assert_eq!(column_label(53), "BA");
        assert_eq!(column_label(100), "CV");
    }
}
