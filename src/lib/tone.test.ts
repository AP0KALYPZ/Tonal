import { describe, expect, it } from 'vitest';
import { NEUTRAL_TONE } from './defaults';
import {
  applyToneToImageData,
  applyToneTransfer,
  buildToneLuts,
  compositeOnBackground,
  computeHistogram,
  isTransferMonotonic,
  linearToSrgb,
  luminance8,
  relativeLuminance8,
  sanitizeTone,
  srgbToLinear,
  valueSwatches,
} from './tone';
import type { ToneSettings } from './types';

const neutral: ToneSettings = { ...NEUTRAL_TONE };

function transferSamples(tone: ToneSettings, levels?: number): number[] {
  return Array.from({ length: 256 }, (_, i) => applyToneTransfer(i / 255, tone, levels));
}

describe('grayscale conversion', () => {
  it('round-trips sRGB to linear and back', () => {
    for (const value of [0, 64, 128, 192, 255]) {
      expect(linearToSrgb(srgbToLinear(value / 255)) * 255).toBeCloseTo(value, 4);
    }
  });

  it('maps black to 0 and white to 255 using Rec.709 luminance', () => {
    expect(relativeLuminance8(0, 0, 0)).toBe(0);
    expect(relativeLuminance8(255, 255, 255)).toBeCloseTo(1, 12);
    expect(luminance8(255, 255, 255)).toBe(255);
    expect(luminance8(0, 0, 0)).toBe(0);
    // Pure green is perceptually brighter than pure red, which is brighter than blue.
    expect(relativeLuminance8(0, 255, 0)).toBeGreaterThan(relativeLuminance8(255, 0, 0));
    expect(relativeLuminance8(255, 0, 0)).toBeGreaterThan(relativeLuminance8(0, 0, 255));
  });

  it('converts colour pixels to grayscale when enabled', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const tone: ToneSettings = { ...neutral, grayscale: true };
    applyToneToImageData(data, tone, { enabled: false, levels: 5 });
    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
    expect(data[4]).toBe(data[5]);
    expect(data[5]).toBe(data[6]);
    expect(data[0]!).toBeGreaterThan(data[4]!);
  });

  it('preserves chroma in colour mode while shifting luminance', () => {
    const data = new Uint8ClampedArray([200, 120, 60, 255]);
    applyToneToImageData(data, { ...neutral, grayscale: false, brightness: 30 }, { enabled: false, levels: 5 });
    expect(data[0]!).toBeGreaterThan(200);
    expect(data[0]! - data[1]!).toBeCloseTo(80, 0);
  });
});

describe('tonal transfer', () => {
  it('is identity when neutral', () => {
    for (const value of [0, 64, 128, 192, 255]) {
      expect(applyToneTransfer(value / 255, neutral)).toBeCloseTo(value / 255, 12);
    }
  });

  it('lifts midtones with gamma above 1 and darkens below 1', () => {
    const mid = 128 / 255;
    expect(applyToneTransfer(mid, { ...neutral, gamma: 1.5 })).toBeGreaterThan(mid);
    expect(applyToneTransfer(mid, { ...neutral, gamma: 0.6 })).toBeLessThan(mid);
    expect(applyToneTransfer(0, { ...neutral, gamma: 2 })).toBe(0);
    expect(applyToneTransfer(1, { ...neutral, gamma: 2 })).toBe(1);
  });

  it('moves black and white points', () => {
    expect(applyToneTransfer(0.1, { ...neutral, blackPoint: 26 })).toBeCloseTo(0, 12);
    expect(applyToneTransfer(0.95, { ...neutral, whitePoint: 230 })).toBeCloseTo(1, 12);
    expect(applyToneTransfer(0.5, { ...neutral, blackPoint: 20, whitePoint: 235 })).toBeGreaterThan(0.5);
  });

  it('never darkens with positive brightness', () => {
    const lifted = { ...neutral, brightness: 25 };
    for (let i = 0; i <= 255; i += 1) {
      expect(applyToneTransfer(i / 255, lifted)).toBeGreaterThanOrEqual(i / 255 - 1e-12);
    }
  });

  it('spreads values with positive contrast around midgray', () => {
    const contrasty = { ...neutral, contrast: 40 };
    expect(applyToneTransfer(0.25, contrasty)).toBeLessThan(0.25);
    expect(applyToneTransfer(0.75, contrasty)).toBeGreaterThan(0.75);
    expect(applyToneTransfer(0.5, contrasty)).toBeCloseTo(0.5, 12);
  });

  it('applies shadows mostly to darks and highlights to lights', () => {
    const shadows = { ...neutral, shadows: 40 };
    const highlights = { ...neutral, highlights: 40 };
    expect(applyToneTransfer(0.15, shadows) - 0.15).toBeGreaterThan(
      applyToneTransfer(0.85, shadows) - 0.85,
    );
    expect(applyToneTransfer(0.85, highlights) - 0.85).toBeGreaterThan(
      applyToneTransfer(0.15, highlights) - 0.15,
    );
  });

  it('keeps extremes and clamps at the limits', () => {
    const extreme: ToneSettings = {
      grayscale: true,
      brightness: 100,
      contrast: 100,
      shadows: 100,
      highlights: 100,
      gamma: 3,
      blackPoint: 0,
      whitePoint: 255,
    };
    for (let i = 0; i <= 255; i += 1) {
      const value = applyToneTransfer(i / 255, extreme);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('quantizes to exactly N values for the value study', () => {
    for (const levels of [3, 4, 5, 7, 9]) {
      const allowed = new Set(
        Array.from({ length: levels }, (_, i) => Math.round((i / (levels - 1)) * 1e9) / 1e9),
      );
      for (let i = 0; i <= 255; i += 1) {
        const value = Math.round(applyToneTransfer(i / 255, neutral, levels) * 1e9) / 1e9;
        expect(allowed.has(value)).toBe(true);
      }
    }
  });

  it('stays monotonic across randomized settings', () => {
    for (let i = 0; i < 250; i += 1) {
      const tone: ToneSettings = {
        grayscale: true,
        brightness: Math.round(Math.random() * 200 - 100),
        contrast: Math.round(Math.random() * 200 - 100),
        shadows: Math.round(Math.random() * 200 - 100),
        highlights: Math.round(Math.random() * 200 - 100),
        gamma: 0.25 + Math.random() * 2.75,
        blackPoint: Math.round(Math.random() * 254),
        whitePoint: 255,
      };
      expect(isTransferMonotonic(tone)).toBe(true);
      expect(transferSamples(tone)).toHaveLength(256);
    }
  });

  it('keeps black below white when sanitizing', () => {
    const sanitized = sanitizeTone({ ...neutral, blackPoint: 240, whitePoint: 100 });
    expect(sanitized.blackPoint).toBeLessThan(sanitized.whitePoint);
  });

  it('builds a 256-entry tone LUT matching the transfer function', () => {
    const tone = { ...neutral, gamma: 1.4, shadows: 15 };
    const luts = buildToneLuts(tone, { enabled: false, levels: 5 });
    for (const value of [0, 51, 128, 204, 255]) {
      expect(luts.tone[value]).toBeCloseTo(applyToneTransfer(value / 255, tone), 6);
    }
  });

  it('provides value swatches with exact endpoints', () => {
    const swatches = valueSwatches(5);
    expect(swatches.map((swatch) => swatch.value)).toEqual([0, 64, 128, 191, 255]);
    expect(swatches[0]?.hex).toBe('#000000');
    expect(swatches[4]?.hex).toBe('#FFFFFF');
  });
});

describe('histogram and alpha', () => {
  it('bins 256 luminance values and reports clipping', () => {
    const data = new Uint8ClampedArray(4 * 4);
    for (let i = 0; i < 4; i += 1) {
      data[i * 4] = i < 2 ? 0 : 255;
      data[i * 4 + 1] = i < 2 ? 0 : 255;
      data[i * 4 + 2] = i < 2 ? 0 : 255;
      data[i * 4 + 3] = 255;
    }
    const histogram = computeHistogram(data);
    expect(histogram.total).toBe(4);
    expect(histogram.bins[0]).toBe(2);
    expect(histogram.bins[255]).toBe(2);
    expect(histogram.shadowPercent).toBeCloseTo(50, 6);
    expect(histogram.highlightPercent).toBeCloseTo(50, 6);
    expect(histogram.min).toBe(0);
    expect(histogram.max).toBe(255);
  });

  it('ignores fully transparent pixels', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 255]);
    const histogram = computeHistogram(data);
    expect(histogram.total).toBe(1);
    expect(histogram.bins[0]).toBe(0);
    expect(histogram.bins[255]).toBe(1);
  });

  it('composites alpha onto the reference background', () => {
    expect(compositeOnBackground(0, 0, 0, 0, { r: 255, g: 255, b: 255 })).toEqual([255, 255, 255]);
    expect(compositeOnBackground(0, 0, 0, 255, { r: 255, g: 255, b: 255 })).toEqual([0, 0, 0]);
    expect(compositeOnBackground(0, 0, 0, 128, { r: 255, g: 255, b: 255 })).toEqual([127, 127, 127]);
  });
});
