//! The canonical tone pipeline. Keep this in lockstep with `src/lib/tone.ts`:
//! sRGB luminance -> black/white points -> gamma -> brightness/contrast ->
//! shadows/highlights -> optional value posterisation. Alpha is composited
//! before tone processing because exports are flattened references.

use crate::error::AppResult;
use crate::models::{Rgb, StudySettings, ToneSettings};

pub const SHADOW_HIGHLIGHT_STRENGTH: f64 = 0.3;
pub const LIN_LOOKUP_SIZE: usize = 4096;

pub struct ToneLuts {
    pub tone: [u8; 256],
    pub linear: [f32; 256],
    pub encode: [u8; LIN_LOOKUP_SIZE],
}

pub fn srgb_to_linear(value: f64) -> f64 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

pub fn linear_to_srgb(value: f64) -> f64 {
    let value = value.clamp(0.0, 1.0);
    if value <= 0.003_130_8 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    }
}

pub fn tone_transfer(input: f64, tone: &ToneSettings, levels: u32) -> f64 {
    let tone = tone.sanitized();
    let black = tone.black_point / 255.0;
    let white = tone.white_point / 255.0;
    let mut value = ((input - black) / (white - black).max(1.0 / 255.0)).clamp(0.0, 1.0);
    value = value.powf(1.0 / tone.gamma.clamp(0.25, 3.0));
    let contrast = 1.0 + tone.contrast / 100.0;
    value = ((value - 0.5) * contrast + 0.5 + tone.brightness / 200.0).clamp(0.0, 1.0);
    let shadow_weight = (1.0 - value) * (1.0 - value);
    let highlight_weight = value * value;
    value = (value
        + (tone.shadows / 100.0) * SHADOW_HIGHLIGHT_STRENGTH * shadow_weight
        + (tone.highlights / 100.0) * SHADOW_HIGHLIGHT_STRENGTH * highlight_weight)
        .clamp(0.0, 1.0);
    if levels >= 2 {
        value = (value * f64::from(levels - 1)).round() / f64::from(levels - 1);
    }
    value.clamp(0.0, 1.0)
}

pub fn build_tone_luts(tone: &ToneSettings, study: &StudySettings) -> ToneLuts {
    let sanitized = tone.sanitized();
    let levels = if study.enabled { study.levels() } else { 0 };
    let mut tone_lut = [0u8; 256];
    let mut linear = [0f32; 256];
    let mut encode = [0u8; LIN_LOOKUP_SIZE];

    for index in 0..256 {
        linear[index] = srgb_to_linear(index as f64 / 255.0) as f32;
        tone_lut[index] =
            (tone_transfer(index as f64 / 255.0, &sanitized, levels) * 255.0).round() as u8;
    }
    for index in 0..LIN_LOOKUP_SIZE {
        encode[index] = (linear_to_srgb(index as f64 / (LIN_LOOKUP_SIZE - 1) as f64) * 255.0)
            .round()
            .clamp(0.0, 255.0) as u8;
    }

    ToneLuts {
        tone: tone_lut,
        linear,
        encode,
    }
}

fn gray_index(r: u8, g: u8, b: u8, luts: &ToneLuts) -> u8 {
    let linear = 0.2126 * f64::from(luts.linear[r as usize])
        + 0.7152 * f64::from(luts.linear[g as usize])
        + 0.0722 * f64::from(luts.linear[b as usize]);
    let index = (linear.clamp(0.0, 1.0) * (LIN_LOOKUP_SIZE - 1) as f64).round() as usize;
    luts.encode[index.min(LIN_LOOKUP_SIZE - 1)]
}

/// Process RGBA pixels in place. The callback receives a 0..1 fraction and may
/// return an error to cancel (it is invoked roughly once per million pixels).
pub fn apply_tone_rgba(
    buffer: &mut [u8],
    tone: &ToneSettings,
    study: &StudySettings,
    background: Rgb,
    progress: &mut dyn FnMut(f64) -> AppResult<()>,
) -> AppResult<()> {
    let luts = build_tone_luts(tone, study);
    let pixel_count = buffer.len() / 4;
    if pixel_count == 0 {
        return Ok(());
    }
    let report_every = 1_048_576usize;
    let grayscale = tone.grayscale;

    for (index, pixel) in buffer.chunks_exact_mut(4).enumerate() {
        if index > 0 && index % report_every == 0 {
            progress(index as f64 / pixel_count as f64)?;
        }

        let alpha = pixel[3];
        let (mut r, mut g, mut b) = (pixel[0], pixel[1], pixel[2]);
        if alpha != 255 {
            let a = u32::from(alpha);
            let inverse = 255 - a;
            r = ((u32::from(r) * a + u32::from(background.r) * inverse + 127) / 255) as u8;
            g = ((u32::from(g) * a + u32::from(background.g) * inverse + 127) / 255) as u8;
            b = ((u32::from(b) * a + u32::from(background.b) * inverse + 127) / 255) as u8;
        }

        let gray = gray_index(r, g, b, &luts);
        let adjusted = luts.tone[gray as usize];
        if grayscale {
            pixel[0] = adjusted;
            pixel[1] = adjusted;
            pixel[2] = adjusted;
        } else {
            let delta = i16::from(adjusted) - i16::from(gray);
            pixel[0] = (i16::from(r) + delta).clamp(0, 255) as u8;
            pixel[1] = (i16::from(g) + delta).clamp(0, 255) as u8;
            pixel[2] = (i16::from(b) + delta).clamp(0, 255) as u8;
        }
        pixel[3] = 255;
    }
    progress(1.0)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn neutral() -> ToneSettings {
        ToneSettings::default()
    }

    fn study(enabled: bool, levels: u32) -> StudySettings {
        StudySettings { enabled, levels }
    }

    fn pixel(r: u8, g: u8, b: u8, a: u8) -> Vec<u8> {
        vec![r, g, b, a]
    }

    fn run(data: &mut [u8], tone: &ToneSettings, settings: &StudySettings, bg: Rgb) {
        apply_tone_rgba(data, tone, settings, bg, &mut |_| Ok(())).unwrap();
    }

    #[test]
    fn neutral_transfer_is_identity_at_endpoints() {
        let tone = neutral();
        assert!((tone_transfer(0.0, &tone, 0) - 0.0).abs() < 1e-9);
        assert!((tone_transfer(1.0, &tone, 0) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn transfer_is_monotonic_for_extreme_settings() {
        let tones = [
            ToneSettings {
                brightness: 100.0,
                contrast: 100.0,
                shadows: 100.0,
                highlights: 100.0,
                gamma: 3.0,
                black_point: 40.0,
                white_point: 220.0,
                ..ToneSettings::default()
            },
            ToneSettings {
                brightness: -100.0,
                contrast: -100.0,
                shadows: -100.0,
                highlights: -100.0,
                gamma: 0.25,
                black_point: 0.0,
                white_point: 255.0,
                ..ToneSettings::default()
            },
        ];
        for tone in tones {
            let mut previous = f64::NEG_INFINITY;
            for index in 0..=255 {
                let value = tone_transfer(index as f64 / 255.0, &tone, 0);
                assert!(value.is_finite());
                assert!((0.0..=1.0).contains(&value));
                assert!(value + 1e-9 >= previous);
                previous = value;
            }
        }
    }

    #[test]
    fn brightness_raises_midtones_and_white_stays_white() {
        let tone = ToneSettings {
            brightness: 25.0,
            ..ToneSettings::default()
        };
        assert!(tone_transfer(0.5, &tone, 0) > 0.5);
        assert!((tone_transfer(1.0, &tone, 0) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn study_quantises_to_requested_levels() {
        let tone = neutral();
        let settings = study(true, 5);
        for index in 0..=255 {
            let value = tone_transfer(index as f64 / 255.0, &tone, settings.levels());
            let scaled = value * 4.0;
            assert!((scaled - scaled.round()).abs() < 1e-9);
        }
    }

    #[test]
    fn grayscale_pixels_are_neutral_and_opaque() {
        let mut data = pixel(30, 120, 220, 128);
        run(
            &mut data,
            &neutral(),
            &study(false, 5),
            Rgb {
                r: 255,
                g: 255,
                b: 255,
            },
        );
        assert_eq!(data[0], data[1]);
        assert_eq!(data[1], data[2]);
        assert_eq!(data[3], 255);
    }

    #[test]
    fn transparent_pixel_composites_to_background() {
        let mut data = pixel(0, 0, 0, 0);
        run(
            &mut data,
            &neutral(),
            &study(false, 5),
            Rgb {
                r: 255,
                g: 255,
                b: 255,
            },
        );
        assert_eq!(&data[0..3], &[255, 255, 255]);
        assert_eq!(data[3], 255);
    }

    #[test]
    fn colour_mode_preserves_channel_differences_when_unclipped() {
        let mut data = pixel(100, 120, 140, 255);
        let tone = ToneSettings {
            grayscale: false,
            brightness: 10.0,
            ..ToneSettings::default()
        };
        run(
            &mut data,
            &tone,
            &study(false, 5),
            Rgb {
                r: 255,
                g: 255,
                b: 255,
            },
        );
        assert_eq!(i16::from(data[1]) - i16::from(data[0]), 20);
        assert_eq!(i16::from(data[2]) - i16::from(data[1]), 20);
        assert_eq!(data[3], 255);
    }

    #[test]
    fn tone_lut_matches_typescript_reference_values() {
        let tone = ToneSettings {
            brightness: 18.0,
            contrast: 24.0,
            shadows: 35.0,
            highlights: -22.0,
            gamma: 1.35,
            black_point: 12.0,
            white_point: 238.0,
            ..ToneSettings::default()
        };
        let luts = build_tone_luts(&tone, &study(true, 6));
        let expected = [
            (0usize, 51u8),
            (32, 51),
            (64, 102),
            (96, 153),
            (128, 153),
            (160, 204),
            (192, 255),
            (224, 255),
            (255, 255),
        ];
        for (input, output) in expected {
            assert_eq!(luts.tone[input], output, "tone LUT mismatch at {input}");
        }
        let gray_samples = [
            ((30u8, 60u8, 120u8), 62u8),
            ((100, 120, 140), 118),
            ((200, 180, 150), 183),
            ((0, 0, 0), 0),
            ((255, 255, 255), 255),
        ];
        for ((r, g, b), expected_gray) in gray_samples {
            assert_eq!(
                gray_index(r, g, b, &luts),
                expected_gray,
                "gray mismatch at {r},{g},{b}"
            );
        }
    }

    #[test]
    fn alpha_compositing_uses_rounded_mix() {
        let mut data = pixel(0, 0, 0, 128);
        run(
            &mut data,
            &neutral(),
            &study(false, 5),
            Rgb {
                r: 255,
                g: 255,
                b: 255,
            },
        );
        assert_eq!(&data[0..3], &[127, 127, 127]);
    }
}
