import { clamp } from './geometry';
import type { StudySettings, ToneSettings } from './types';

/**
 * Canonical pipeline (mirrored in src-tauri/src/imaging/tones.rs):
 *   1. Composite alpha onto the reference background.
 *   2. sRGB -> linear Rec.709 luminance (+ encode back to sRGB) for grayscale.
 *   3. Black/white points: t = (v - black) / (white - black).
 *   4. Gamma: t = t^(1/gamma).
 *   5. Brightness/contrast: t = (t - .5) * (1 + contrast/100) + .5 + brightness/200.
 *   6. Shadows/highlights: t += shadows/100 * .30 * (1-t)^2 + highlights/100 * .30 * t^2.
 *   7. Value study: t = round(t * (N-1)) / (N-1).
 * All stages clamp to [0, 1]. Colour mode applies the grayscale curve's
 * difference to each sRGB channel, preserving relative colour as far as the
 * gamut allows.
 */
export const SHADOW_HIGHLIGHT_STRENGTH = 0.3;

export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(value: number): number {
  const v = clamp(value, 0, 1);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function relativeLuminance8(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
}

export function luminance8(r: number, g: number, b: number): number {
  return Math.round(linearToSrgb(relativeLuminance8(r, g, b)) * 255);
}

export function sanitizeTone(tone: ToneSettings): ToneSettings {
  const blackPoint = Math.round(clamp(tone.blackPoint, 0, 254));
  let whitePoint = Math.round(clamp(tone.whitePoint, 1, 255));
  if (whitePoint <= blackPoint) whitePoint = Math.min(255, blackPoint + 1);
  return {
    grayscale: Boolean(tone.grayscale),
    brightness: clamp(tone.brightness, -100, 100),
    contrast: clamp(tone.contrast, -100, 100),
    shadows: clamp(tone.shadows, -100, 100),
    highlights: clamp(tone.highlights, -100, 100),
    gamma: clamp(tone.gamma, 0.25, 3),
    blackPoint,
    whitePoint,
  };
}

export function applyToneTransfer(t: number, tone: ToneSettings, levels?: number): number {
  const black = tone.blackPoint / 255;
  const white = tone.whitePoint / 255;
  let v = clamp((t - black) / Math.max(1 / 255, white - black), 0, 1);
  v = Math.pow(v, 1 / clamp(tone.gamma, 0.25, 3));
  const contrastFactor = 1 + tone.contrast / 100;
  v = clamp((v - 0.5) * contrastFactor + 0.5 + tone.brightness / 200, 0, 1);
  const shadowWeight = (1 - v) * (1 - v);
  const highlightWeight = v * v;
  v = clamp(
    v +
      (tone.shadows / 100) * SHADOW_HIGHLIGHT_STRENGTH * shadowWeight +
      (tone.highlights / 100) * SHADOW_HIGHLIGHT_STRENGTH * highlightWeight,
    0,
    1,
  );
  if (levels && levels >= 2) {
    v = Math.round(v * (levels - 1)) / (levels - 1);
  }
  return clamp(v, 0, 1);
}

export interface ToneLuts {
  /** 256-entry output for 8-bit sRGB gray input. */
  tone: Float32Array;
  /** 256-entry sRGB -> linear. */
  linear: Float32Array;
  /** linear luminance (0..1) -> 8-bit sRGB gray index. */
  encode: Uint8Array;
  levels: number;
}

export const LIN_LOOKUP_SIZE = 4096;

export function buildToneLuts(toneInput: ToneSettings, study: StudySettings): ToneLuts {
  const tone = sanitizeTone(toneInput);
  const levels = study.enabled ? Math.round(clamp(study.levels, 3, 9)) : 0;
  const toneLut = new Float32Array(256);
  const linear = new Float32Array(256);
  const encode = new Uint8Array(LIN_LOOKUP_SIZE);

  for (let i = 0; i < 256; i += 1) {
    linear[i] = srgbToLinear(i / 255);
    toneLut[i] = applyToneTransfer(i / 255, tone, levels);
  }
  for (let i = 0; i < LIN_LOOKUP_SIZE; i += 1) {
    encode[i] = Math.round(linearToSrgb(i / (LIN_LOOKUP_SIZE - 1)) * 255);
  }
  return { tone: toneLut, linear, encode, levels };
}

export function grayIndexFromRgb8(
  r: number,
  g: number,
  b: number,
  luts: ToneLuts,
): number {
  const lin = 0.2126 * (luts.linear[r] ?? 0) + 0.7152 * (luts.linear[g] ?? 0) + 0.0722 * (luts.linear[b] ?? 0);
  return luts.encode[Math.round(clamp(lin, 0, 1) * (LIN_LOOKUP_SIZE - 1))] ?? 0;
}

/** Process RGBA pixels in place. `grayscale` false preserves chroma via a luma delta. */
export function applyToneToImageData(
  data: Uint8ClampedArray,
  tone: ToneSettings,
  study: StudySettings,
  luts: ToneLuts = buildToneLuts(tone, study),
): void {
  const grayscale = tone.grayscale;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const grayIndex = grayIndexFromRgb8(r, g, b, luts);
    const adjusted = Math.round((luts.tone[grayIndex] ?? 0) * 255);
    if (grayscale) {
      data[i] = adjusted;
      data[i + 1] = adjusted;
      data[i + 2] = adjusted;
    } else {
      const delta = adjusted - grayIndex;
      data[i] = clamp(r + delta, 0, 255);
      data[i + 1] = clamp(g + delta, 0, 255);
      data[i + 2] = clamp(b + delta, 0, 255);
    }
  }
}

export interface Histogram {
  bins: Uint32Array;
  total: number;
  min: number;
  max: number;
  shadowClipped: number;
  highlightClipped: number;
  shadowPercent: number;
  highlightPercent: number;
}

export function computeHistogram(
  data: Uint8ClampedArray,
  shadowThreshold = 4,
  highlightThreshold = 251,
): Histogram {
  const bins = new Uint32Array(256);
  let total = 0;
  let min = 255;
  let max = 0;
  let shadows = 0;
  let highlights = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 255;
    if (a === 0) continue;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const v = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    bins[v] = (bins[v] ?? 0) + 1;
    total += 1;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v <= shadowThreshold) shadows += 1;
    if (v >= highlightThreshold) highlights += 1;
  }
  const shadowPercent = total ? (shadows / total) * 100 : 0;
  const highlightPercent = total ? (highlights / total) * 100 : 0;
  return {
    bins,
    total,
    min: total ? min : 0,
    max: total ? max : 0,
    shadowClipped: shadows,
    highlightClipped: highlights,
    shadowPercent,
    highlightPercent,
  };
}

export function valueSwatches(levels: number): Array<{ value: number; hex: string }> {
  const n = Math.round(clamp(levels, 3, 9));
  const result: Array<{ value: number; hex: string }> = [];
  for (let i = 0; i < n; i += 1) {
    const value = Math.round((i / (n - 1)) * 255);
    const hex = `#${value.toString(16).padStart(2, '0').repeat(3).toUpperCase()}`;
    result.push({ value, hex });
  }
  return result;
}

/** True when the grayscale transfer is non-decreasing across 0..255. */
export function isTransferMonotonic(tone: ToneSettings, levels?: number): boolean {
  let previous = -Infinity;
  for (let i = 0; i <= 255; i += 1) {
    const v = applyToneTransfer(i / 255, sanitizeTone(tone), levels);
    if (v < previous - 1e-9) return false;
    previous = v;
  }
  return true;
}

export function isToneNeutral(tone: ToneSettings): boolean {
  const t = sanitizeTone(tone);
  return (
    t.brightness === 0 &&
    t.contrast === 0 &&
    t.shadows === 0 &&
    t.highlights === 0 &&
    t.gamma === 1 &&
    t.blackPoint === 0 &&
    t.whitePoint === 255
  );
}

export function toneSummary(tone: ToneSettings): string {
  const bits: string[] = [];
  if (tone.grayscale) bits.push('grayscale');
  if (tone.brightness !== 0) bits.push(`brightness ${tone.brightness > 0 ? '+' : ''}${tone.brightness}`);
  if (tone.contrast !== 0) bits.push(`contrast ${tone.contrast > 0 ? '+' : ''}${tone.contrast}`);
  if (tone.shadows !== 0) bits.push(`shadows ${tone.shadows > 0 ? '+' : ''}${tone.shadows}`);
  if (tone.highlights !== 0) bits.push(`highlights ${tone.highlights > 0 ? '+' : ''}${tone.highlights}`);
  if (tone.gamma !== 1) bits.push(`gamma ${tone.gamma.toFixed(2)}`);
  if (tone.blackPoint !== 0) bits.push(`black ${tone.blackPoint}`);
  if (tone.whitePoint !== 255) bits.push(`white ${tone.whitePoint}`);
  return bits.length ? bits.join(' · ') : 'neutral';
}

const HEX_PATTERN = /^#?([0-9a-f]{6})$/i;

export function parseHexColor(hex: string, fallback = { r: 255, g: 255, b: 255 }): {
  r: number;
  g: number;
  b: number;
} {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) return fallback;
  const value = match[1] ?? 'FFFFFF';
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function normalizeHex(hex: string, fallback = '#FFFFFF'): string {
  return HEX_PATTERN.test(hex.trim()) ? `#${(HEX_PATTERN.exec(hex.trim())?.[1] ?? 'FFFFFF').toUpperCase()}` : fallback;
}

export function compositeOnBackground(
  r: number,
  g: number,
  b: number,
  a: number,
  background: { r: number; g: number; b: number },
): [number, number, number] {
  const alpha = a / 255;
  return [
    Math.round(r * alpha + background.r * (1 - alpha)),
    Math.round(g * alpha + background.g * (1 - alpha)),
    Math.round(b * alpha + background.b * (1 - alpha)),
  ];
}
