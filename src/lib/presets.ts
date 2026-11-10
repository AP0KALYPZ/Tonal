import { NEUTRAL_TONE } from './defaults';
import type { StudySettings, ToneSettings } from './types';

export interface TonePreset {
  id: 'natural' | 'soft' | 'deep' | 'bright' | 'blocking';
  name: string;
  description: string;
  tone: ToneSettings;
  study: StudySettings;
  swatch: string;
}

export const TONE_PRESETS: TonePreset[] = [
  {
    id: 'natural',
    name: 'Natural Graphite',
    description: 'Neutral grayscale with no tonal shifts. A faithful photographic base.',
    tone: { ...NEUTRAL_TONE, grayscale: true },
    study: { enabled: false, levels: 5 },
    swatch: 'linear-gradient(90deg,#1b1d1d,#d8d6d0)',
  },
  {
    id: 'soft',
    name: 'Soft Portrait',
    description: 'Lifted shadows, gentle contrast and brighter midtones for skin.',
    tone: {
      ...NEUTRAL_TONE,
      brightness: 3,
      contrast: -8,
      shadows: 18,
      highlights: -4,
      gamma: 1.08,
    },
    study: { enabled: false, levels: 5 },
    swatch: 'linear-gradient(90deg,#2c2e2d,#e8e2d8)',
  },
  {
    id: 'deep',
    name: 'Deep Contrast',
    description: 'More separation between values with substantial graphite darks.',
    tone: {
      ...NEUTRAL_TONE,
      brightness: -4,
      contrast: 22,
      shadows: -10,
      highlights: 8,
      gamma: 0.94,
    },
    study: { enabled: false, levels: 5 },
    swatch: 'linear-gradient(90deg,#0d0e0e,#f2eee6)',
  },
  {
    id: 'bright',
    name: 'Bright Reference',
    description: 'Opens the midtones so structure remains visible in working light.',
    tone: {
      ...NEUTRAL_TONE,
      brightness: 8,
      contrast: -6,
      shadows: 20,
      highlights: -12,
      gamma: 1.18,
    },
    study: { enabled: false, levels: 5 },
    swatch: 'linear-gradient(90deg,#454644,#faf6ee)',
  },
  {
    id: 'blocking',
    name: 'Value Blocking',
    description: 'Five flat graphite values for planning the drawing before detail.',
    tone: {
      ...NEUTRAL_TONE,
      contrast: 10,
      shadows: 8,
    },
    study: { enabled: true, levels: 5 },
    swatch: 'linear-gradient(90deg,#1b1d1d 0 20%,#585a58 20% 40%,#8f918d 40% 60%,#c2c1bb 60% 80%,#f0ede5 80%)',
  },
];

export function presetMatchesTone(
  preset: TonePreset,
  tone: ToneSettings,
  study: StudySettings,
): boolean {
  return (
    preset.tone.grayscale === tone.grayscale &&
    preset.tone.brightness === tone.brightness &&
    preset.tone.contrast === tone.contrast &&
    preset.tone.shadows === tone.shadows &&
    preset.tone.highlights === tone.highlights &&
    Math.abs(preset.tone.gamma - tone.gamma) < 1e-9 &&
    preset.tone.blackPoint === tone.blackPoint &&
    preset.tone.whitePoint === tone.whitePoint &&
    preset.study.enabled === study.enabled &&
    (!study.enabled || preset.study.levels === study.levels)
  );
}
