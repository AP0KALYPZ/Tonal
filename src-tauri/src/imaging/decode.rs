use std::fs;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use image::codecs::jpeg::JpegEncoder;
use image::metadata::Orientation;
use image::{DynamicImage, GenericImageView, ImageDecoder, ImageFormat, ImageReader};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

pub struct DecodedSource {
    pub image: DynamicImage,
    pub format: String,
    pub has_alpha: bool,
    pub warnings: Vec<String>,
}

const PROXY_MAX_EDGE: u32 = 2048;
/// Decoding allocates an RGBA image plus decoder working memory. Refuse source
/// dimensions that cannot fit the same documented 1 GiB export budget.
const MAX_SOURCE_PIXELS: u64 = 268_435_456;

pub fn decode_source(path: &Path) -> AppResult<DecodedSource> {
    if !path.is_file() {
        return Err(AppError::new(
            "The source photo could not be found. It may have moved or been renamed.",
        ));
    }

    let mut reader = ImageReader::open(path)?
        .with_guessed_format()
        .map_err(|_| AppError::new("The selected file could not be read."))?;

    let format = reader.format().ok_or_else(|| {
        AppError::new("We couldn't identify this file. Choose a JPG, PNG or WebP image.")
    })?;
    let format_name = match format {
        ImageFormat::Png => "PNG",
        ImageFormat::Jpeg => "JPEG",
        ImageFormat::WebP => "WebP",
        _ => {
            return Err(AppError::new(
                "Unsupported format. Choose a JPG, PNG or WebP image.",
            ))
        }
    }
    .to_string();

    reader.no_limits();
    let mut decoder = reader.into_decoder()?;
    let (source_width, source_height) = decoder.dimensions();
    if u64::from(source_width) * u64::from(source_height) > MAX_SOURCE_PIXELS {
        return Err(AppError::new(
            "This photo is too large for available memory. TONAL supports up to 268 megapixels per source.",
        ));
    }
    let mut warnings = Vec::new();
    let orientation = decoder.orientation().unwrap_or_else(|_| {
        warnings.push(
            "The photo's EXIF orientation could not be read; it was opened as stored.".to_string(),
        );
        Orientation::NoTransforms
    });

    let mut image = DynamicImage::from_decoder(decoder)?;
    let has_alpha = image.color().has_alpha();
    image.apply_orientation(orientation);

    if image.width() == 0 || image.height() == 0 {
        return Err(AppError::new("The photo has no readable pixels."));
    }

    Ok(DecodedSource {
        image,
        format: format_name,
        has_alpha,
        warnings,
    })
}

pub fn decode_oriented(path: &Path) -> AppResult<DynamicImage> {
    Ok(decode_source(path)?.image)
}

pub fn proxy_data_url(image: &DynamicImage, has_alpha: bool) -> AppResult<(u32, u32, String)> {
    let (width, height) = image.dimensions();
    let scale = (PROXY_MAX_EDGE as f64 / width.max(height) as f64).min(1.0);
    let proxy_width = ((width as f64 * scale).round() as u32).max(1);
    let proxy_height = ((height as f64 * scale).round() as u32).max(1);
    let proxy = if proxy_width == width && proxy_height == height {
        image.clone()
    } else {
        image.resize(
            proxy_width,
            proxy_height,
            image::imageops::FilterType::Triangle,
        )
    };

    let mut bytes = Vec::new();
    let mime = if has_alpha {
        let rgba = proxy.to_rgba8();
        {
            let mut encoder = png::Encoder::new(&mut bytes, rgba.width(), rgba.height());
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header()?;
            writer.write_image_data(rgba.as_raw())?;
        }
        "image/png"
    } else {
        let rgb = proxy.to_rgb8();
        let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 88);
        encoder.encode_image(&DynamicImage::ImageRgb8(rgb))?;
        "image/jpeg"
    };

    let encoded = BASE64.encode(&bytes);
    Ok((
        proxy_width,
        proxy_height,
        format!("data:{mime};base64,{encoded}"),
    ))
}

pub fn file_checksum(path: &Path) -> AppResult<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let digest = hasher.finalize();
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub fn file_size(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::codecs::jpeg::JpegEncoder;
    use image::{DynamicImage, Rgb, RgbImage};

    fn temp_jpeg(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "tonal-exif-{}-{}-{}",
            std::process::id(),
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn exif_orientation_six_is_applied_before_dimensions_are_reported() {
        let mut source = RgbImage::new(12, 6);
        for (x, _y, pixel) in source.enumerate_pixels_mut() {
            *pixel = if x < 6 {
                Rgb([240, 20, 20])
            } else {
                Rgb([20, 20, 240])
            };
        }
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, 95)
            .encode_image(&DynamicImage::ImageRgb8(source))
            .unwrap();

        let mut payload = b"Exif\0\0".to_vec();
        payload.extend_from_slice(b"II*\0");
        payload.extend_from_slice(&8u32.to_le_bytes());
        payload.extend_from_slice(&1u16.to_le_bytes());
        payload.extend_from_slice(&0x0112u16.to_le_bytes());
        payload.extend_from_slice(&3u16.to_le_bytes());
        payload.extend_from_slice(&1u32.to_le_bytes());
        payload.extend_from_slice(&6u16.to_le_bytes());
        payload.extend_from_slice(&0u16.to_le_bytes());
        payload.extend_from_slice(&0u32.to_le_bytes());

        let mut with_exif = Vec::new();
        with_exif.extend_from_slice(&jpeg[0..2]);
        with_exif.extend_from_slice(&[0xFF, 0xE1]);
        with_exif.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
        with_exif.extend_from_slice(&payload);
        with_exif.extend_from_slice(&jpeg[2..]);

        let path = temp_jpeg("orientation");
        std::fs::write(&path, &with_exif).unwrap();
        let decoded = decode_source(&path).unwrap();
        assert_eq!(decoded.format, "JPEG");
        assert_eq!((decoded.image.width(), decoded.image.height()), (6, 12));
        let _ = std::fs::remove_file(path);
    }
}
