use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

use image::RgbaImage;
use png::{BitDepth, ColorType, PixelDimensions, Unit};

use crate::error::AppResult;

pub fn dpi_to_pixels_per_metre(dpi: u32) -> u32 {
    ((f64::from(dpi.max(1))) / 0.0254).round() as u32
}

/// Encode an RGBA PNG with an explicit pHYs chunk so the print size is
/// embedded (300 DPI is recorded as 11811 pixels/metre).
pub fn encode_png(path: &Path, image: &RgbaImage, dpi: u32) -> AppResult<u64> {
    let file = File::create(path)?;
    {
        let buffered = BufWriter::with_capacity(1024 * 1024, &file);
        let mut encoder = png::Encoder::new(buffered, image.width(), image.height());
        encoder.set_color(ColorType::Rgba);
        encoder.set_depth(BitDepth::Eight);
        let ppm = dpi_to_pixels_per_metre(dpi);
        encoder.set_pixel_dims(Some(PixelDimensions {
            xppu: ppm,
            yppu: ppm,
            unit: Unit::Meter,
        }));
        let mut writer = encoder.write_header()?;
        writer.write_image_data(image.as_raw())?;
        writer.finish()?;
    }
    file.sync_all()?;
    Ok(std::fs::metadata(path)?.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn temp_png(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "tonal-test-{}-{}-{}",
            std::process::id(),
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn dpi_metadata_matches_300_dpi() {
        assert_eq!(dpi_to_pixels_per_metre(300), 11811);
        assert_eq!(dpi_to_pixels_per_metre(150), 5906);
    }

    #[test]
    fn encoded_png_keeps_rgba_alpha_and_phys_chunk() {
        let path = temp_png("alpha");
        let mut image = RgbaImage::new(4, 3);
        image.put_pixel(0, 0, Rgba([10, 20, 30, 0]));
        image.put_pixel(1, 0, Rgba([40, 50, 60, 128]));
        image.put_pixel(2, 0, Rgba([70, 80, 90, 255]));
        encode_png(&path, &image, 300).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[0..8], b"\x89PNG\r\n\x1a\n");
        assert!(bytes.windows(4).any(|window| window == b"pHYs"));
        assert!(bytes.windows(4).any(|window| window == b"IDAT"));

        let decoded = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(decoded.dimensions(), (4, 3));
        assert_eq!(decoded.get_pixel(0, 0)[3], 0);
        assert_eq!(decoded.get_pixel(1, 0)[3], 128);
        assert_eq!(decoded.get_pixel(2, 0)[3], 255);
        let _ = std::fs::remove_file(path);
    }
}
