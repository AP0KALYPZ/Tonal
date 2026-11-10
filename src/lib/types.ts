export const APP_VERSION = '1.0.0';
export const PROJECT_KIND = 'tonal.project';
export const SCHEMA_VERSION = 1;

export const MIN_GRID_DIMENSION = 1;
export const MAX_GRID_DIMENSION = 100;
export const MIN_VALUE_LEVELS = 3;
export const MAX_VALUE_LEVELS = 9;

export interface CropRect {
  /** Normalized to the oriented source, all values in [0, 1]. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ToneSettings {
  grayscale: boolean;
  /** -100..100 */
  brightness: number;
  /** -100..100 */
  contrast: number;
  /** -100..100, positive lifts dark detail */
  shadows: number;
  /** -100..100, positive lifts bright detail */
  highlights: number;
  /** 0.25..3.0, >1 lifts midtones */
  gamma: number;
  /** 0..254 */
  blackPoint: number;
  /** 1..255, must be greater than blackPoint */
  whitePoint: number;
}

export type LabelPlacement = 'cells' | 'perimeter';

export interface GridSettings {
  visible: boolean;
  columns: number;
  rows: number;
  trueSquareCells: boolean;
  /** #RRGGBB */
  color: string;
  /** #RRGGBB, retained when choosing a custom swatch */
  customColor: string;
  /** 0..1 */
  opacity: number;
  /** 0.5..3.0 UI units */
  thickness: number;
  /** 0 = off, otherwise every Nth internal boundary */
  majorEvery: number;
  /** 1..2.5 multiplier for major lines */
  majorThickness: number;
  labelsEnabled: boolean;
  labelPlacement: LabelPlacement;
  border: boolean;
}

export interface StudySettings {
  enabled: boolean;
  /** 3..9 */
  levels: number;
}

export type PaperUnit = 'mm' | 'cm' | 'in';

export interface PaperSettings {
  unit: PaperUnit;
  /** Drawing area, not the full sheet. */
  width: number;
  height: number;
}

export type PrintPagePreset = 'a4' | 'letter' | 'a3' | 'custom';
export type Orientation = 'portrait' | 'landscape';

export interface PrintSettings {
  page: PrintPagePreset;
  customWidthMm: number;
  customHeightMm: number;
  orientation: Orientation;
  marginMm: number;
  overlapMm: number;
  /** Print scale as a percentage of actual size. 100 = true size. */
  scalePercent: number;
  dpi: number;
}

export type ExportMode = 'combined' | 'photo' | 'grid';
export type ResolutionMode = 'native' | 'scale' | 'custom';

export interface ExportDefaults {
  mode: ExportMode;
  dpi: number;
  studyInExport: boolean;
  mirrorInExport: boolean;
  labelsInExport: boolean;
  resolution: ResolutionMode;
  /** Used with resolution === 'scale' */
  scale: number;
  /** Cell size in pixels with resolution === 'custom' (square mode). */
  cellSize: number;
  folder: string;
}

export interface SourceRef {
  originalPath?: string;
  relativePath?: string;
  filename: string;
  checksumSha256?: string;
  orientedWidth: number;
  orientedHeight: number;
  alphaBackground: string;
  format?: string;
  hasAlpha?: boolean;
}

export interface ProjectView {
  /** Optional view hint; never affects export geometry. */
  zoom: number | 'fit';
  panX: number;
  panY: number;
}

export interface TonalProject {
  kind: typeof PROJECT_KIND;
  schemaVersion: number;
  appVersion: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  source: SourceRef | null;
  grid: GridSettings;
  composition: {
    crop: CropRect;
    mirror: boolean;
  };
  tone: ToneSettings;
  study: StudySettings;
  paper: PaperSettings;
  print: PrintSettings;
  exportDefaults: ExportDefaults;
  view?: ProjectView;
}

/** Runtime metadata returned by the Rust importer, never saved in the project. */
export interface ImportedSource {
  path: string;
  filename: string;
  orientedWidth: number;
  orientedHeight: number;
  proxyWidth: number;
  proxyHeight: number;
  dataUrl: string;
  format: string;
  hasAlpha: boolean;
  checksumSha256: string;
  bytes: number;
  warnings: string[];
}

export interface PngExportRequest {
  jobId: string;
  sourcePath: string;
  outputPath: string;
  mode: ExportMode;
  crop: CropRect;
  columns: number;
  rows: number;
  mirror: boolean;
  tone: ToneSettings;
  study: StudySettings;
  studyInExport: boolean;
  grid: GridSettings;
  labelsInExport: boolean;
  background: string;
  dpi: number;
  width: number;
  height: number;
}

export interface PdfExportRequest {
  jobId: string;
  sourcePath: string;
  outputPath: string;
  crop: CropRect;
  columns: number;
  rows: number;
  mirror: boolean;
  tone: ToneSettings;
  study: StudySettings;
  studyInExport: boolean;
  grid: GridSettings;
  labelsInExport: boolean;
  background: string;
  dpi: number;
  paper: PaperSettings;
  print: PrintSettings;
}

export interface ExportProgress {
  jobId: string;
  stage: 'render' | 'grid' | 'encode' | 'layout' | 'write';
  progress: number;
  message: string;
}

export interface ExportResult {
  path: string;
  width: number;
  height: number;
  bytes: number;
  pages?: number;
  warnings: string[];
}

export interface JobCancelled {
  cancelled: true;
}

export type NativeResult<T> = T | JobCancelled;
