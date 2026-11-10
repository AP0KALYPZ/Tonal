import {
  APP_VERSION,
  PROJECT_KIND,
  SCHEMA_VERSION,
  type ExportDefaults,
  type GridSettings,
  type PaperSettings,
  type PrintSettings,
  type StudySettings,
  type ToneSettings,
  type TonalProject,
} from './types';

export const GRID_SWATCHES: ReadonlyArray<{ name: string; value: string }> = [
  { name: 'Warm paper', value: '#D8B791' },
  { name: 'White', value: '#F7F5F0' },
  { name: 'Graphite', value: '#1B1D1D' },
  { name: 'Cyan', value: '#70B9CB' },
];

export const NEUTRAL_TONE: ToneSettings = {
  grayscale: true,
  brightness: 0,
  contrast: 0,
  shadows: 0,
  highlights: 0,
  gamma: 1,
  blackPoint: 0,
  whitePoint: 255,
};

export const DEFAULT_GRID: GridSettings = {
  visible: true,
  columns: 10,
  rows: 12,
  trueSquareCells: true,
  color: '#D8B791',
  customColor: '#B98F62',
  opacity: 0.68,
  thickness: 1,
  majorEvery: 5,
  majorThickness: 1.8,
  labelsEnabled: false,
  labelPlacement: 'cells',
  border: true,
};

export const DEFAULT_STUDY: StudySettings = {
  enabled: false,
  levels: 5,
};

export const DEFAULT_PAPER: PaperSettings = {
  unit: 'cm',
  width: 20,
  height: 24,
};

export const DEFAULT_PRINT: PrintSettings = {
  page: 'a4',
  customWidthMm: 210,
  customHeightMm: 297,
  orientation: 'portrait',
  marginMm: 10,
  overlapMm: 10,
  scalePercent: 100,
  dpi: 300,
};

export const DEFAULT_EXPORT: ExportDefaults = {
  mode: 'combined',
  dpi: 300,
  studyInExport: false,
  mirrorInExport: false,
  labelsInExport: false,
  resolution: 'native',
  scale: 100,
  cellSize: 200,
  folder: '',
};

export function createProject(now = new Date()): TonalProject {
  const iso = now.toISOString();
  return {
    kind: PROJECT_KIND,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    title: 'Untitled reference',
    createdAt: iso,
    updatedAt: iso,
    source: null,
    grid: { ...DEFAULT_GRID },
    composition: {
      crop: { x: 0, y: 0, width: 1, height: 1 },
      mirror: false,
    },
    tone: { ...NEUTRAL_TONE },
    study: { ...DEFAULT_STUDY },
    paper: { ...DEFAULT_PAPER },
    print: { ...DEFAULT_PRINT },
    exportDefaults: { ...DEFAULT_EXPORT },
  };
}
