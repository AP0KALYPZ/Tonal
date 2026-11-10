import {
  APP_VERSION,
  MAX_GRID_DIMENSION,
  MAX_VALUE_LEVELS,
  MIN_GRID_DIMENSION,
  MIN_VALUE_LEVELS,
  PROJECT_KIND,
  SCHEMA_VERSION,
  type CropRect,
  type ExportDefaults,
  type GridSettings,
  type PaperSettings,
  type PrintSettings,
  type ProjectView,
  type SourceRef,
  type StudySettings,
  type ToneSettings,
  type TonalProject,
} from './types';
import {
  DEFAULT_EXPORT,
  DEFAULT_GRID,
  DEFAULT_PAPER,
  DEFAULT_PRINT,
  NEUTRAL_TONE,
  createProject,
} from './defaults';
import { clamp, clampCrop, clampInteger, sanitizeGrid } from './geometry';
import { normalizeHex, sanitizeTone } from './tone';

const HEX = /^#[0-9A-Fa-f]{6}$/;

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function string(value: unknown, fallback: string, max = 400): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

export function normalizeCrop(value: unknown, fallback: CropRect): CropRect {
  const source = record(value);
  const width = clamp(number(source.width, fallback.width), 0.01, 1);
  const height = clamp(number(source.height, fallback.height), 0.01, 1);
  return clampCrop({
    x: clamp(number(source.x, fallback.x), 0, 1),
    y: clamp(number(source.y, fallback.y), 0, 1),
    width,
    height,
  });
}

export function normalizeTone(value: unknown): ToneSettings {
  const source = record(value);
  return sanitizeTone({
    grayscale: bool(source.grayscale, NEUTRAL_TONE.grayscale),
    brightness: number(source.brightness, 0),
    contrast: number(source.contrast, 0),
    shadows: number(source.shadows, 0),
    highlights: number(source.highlights, 0),
    gamma: number(source.gamma, 1),
    blackPoint: number(source.blackPoint, 0),
    whitePoint: number(source.whitePoint, 255),
  });
}

export function normalizeStudy(value: unknown): StudySettings {
  const source = record(value);
  return {
    enabled: bool(source.enabled, false),
    levels: clampInteger(number(source.levels, 5), MIN_VALUE_LEVELS, MAX_VALUE_LEVELS),
  };
}

export function normalizePaper(value: unknown): PaperSettings {
  const source = record(value);
  const unit = source.unit === 'mm' || source.unit === 'in' || source.unit === 'cm' ? source.unit : DEFAULT_PAPER.unit;
  let width = number(source.width, DEFAULT_PAPER.width);
  let height = number(source.height, DEFAULT_PAPER.height);
  if (source.widthCm !== undefined) {
    width = number(source.widthCm, 20);
    height = number(source.heightCm, 24);
  }
  return {
    unit,
    width: clamp(width, 0.1, 1000),
    height: clamp(height, 0.1, 1000),
  };
}

export function normalizePrint(value: unknown): PrintSettings {
  const source = record(value);
  const page =
    source.page === 'a4' || source.page === 'letter' || source.page === 'a3' || source.page === 'custom'
      ? source.page
      : DEFAULT_PRINT.page;
  const orientation = source.orientation === 'landscape' ? 'landscape' : 'portrait';
  return {
    page,
    customWidthMm: clamp(number(source.customWidthMm, 210), 50, 2000),
    customHeightMm: clamp(number(source.customHeightMm, 297), 50, 2000),
    orientation,
    marginMm: clamp(number(source.marginMm, 10), 0, 40),
    overlapMm: clamp(number(source.overlapMm, 10), 0, 50),
    scalePercent: clamp(number(source.scalePercent, 100), 10, 1000),
    dpi: clampInteger(number(source.dpi, 300), 72, 600),
  };
}

function normalizeExportDefaults(value: unknown): ExportDefaults {
  const source = record(value);
  const mode = source.mode === 'photo' || source.mode === 'grid' ? source.mode : 'combined';
  const resolution =
    source.resolution === 'scale' || source.resolution === 'custom' ? source.resolution : 'native';
  return {
    mode,
    dpi: clampInteger(number(source.dpi, 300), 72, 600),
    studyInExport: bool(source.studyInExport, false),
    mirrorInExport: bool(source.mirrorInExport, false),
    labelsInExport: bool(source.labelsInExport, false),
    resolution,
    scale: clamp(number(source.scale, 100), 1, 1000),
    cellSize: clampInteger(number(source.cellSize, 200), 1, 60_000),
    folder: string(source.folder, '', 2000),
  };
}

export function normalizeSource(value: unknown): SourceRef | null {
  if (!value || typeof value !== 'object') return null;
  const source = record(value);
  const width = clampInteger(number(source.orientedWidth, 0), 0, 200_000);
  const height = clampInteger(number(source.orientedHeight, 0), 0, 200_000);
  if (!width || !height) return null;
  const filename = string(source.filename, 'reference');
  const originalPath =
    typeof source.originalPath === 'string' && source.originalPath.length > 0
      ? source.originalPath
      : undefined;
  const relativePath =
    typeof source.relativePath === 'string' && source.relativePath.length > 0
      ? source.relativePath
      : undefined;
  return {
    ...(originalPath ? { originalPath } : {}),
    ...(relativePath ? { relativePath } : {}),
    filename,
    checksumSha256:
      typeof source.checksumSha256 === 'string' && /^[0-9a-f]{64}$/i.test(source.checksumSha256)
        ? source.checksumSha256.toLowerCase()
        : undefined,
    orientedWidth: width,
    orientedHeight: height,
    alphaBackground: normalizeHex(string(source.alphaBackground, '#FFFFFF'), '#FFFFFF'),
    format: string(source.format, 'image', 20),
    hasAlpha: bool(source.hasAlpha, false),
  };
}

export function normalizeGrid(value: unknown): GridSettings {
  const source = record(value);
  const color = typeof source.color === 'string' && HEX.test(source.color) ? source.color : DEFAULT_GRID.color;
  const customColor =
    typeof source.customColor === 'string' && HEX.test(source.customColor)
      ? source.customColor
      : DEFAULT_GRID.customColor;
  return sanitizeGrid({
    visible: bool(source.visible, DEFAULT_GRID.visible),
    columns: clampInteger(number(source.columns, DEFAULT_GRID.columns), MIN_GRID_DIMENSION, MAX_GRID_DIMENSION),
    rows: clampInteger(number(source.rows, DEFAULT_GRID.rows), MIN_GRID_DIMENSION, MAX_GRID_DIMENSION),
    trueSquareCells: bool(source.trueSquareCells, DEFAULT_GRID.trueSquareCells),
    color,
    customColor,
    opacity: clamp(number(source.opacity, DEFAULT_GRID.opacity), 0, 1),
    thickness: number(source.thickness, DEFAULT_GRID.thickness),
    majorEvery: number(source.majorEvery, DEFAULT_GRID.majorEvery),
    majorThickness: number(source.majorThickness, DEFAULT_GRID.majorThickness),
    labelsEnabled: bool(source.labelsEnabled, DEFAULT_GRID.labelsEnabled),
    labelPlacement: source.labelPlacement === 'perimeter' ? 'perimeter' : 'cells',
    border: bool(source.border, DEFAULT_GRID.border),
  });
}

function upgradeLegacy(raw: Record<string, unknown>): Record<string, unknown> {
  // Schema 0 was the browser prototype: flat controls and cm-only paper.
  const grid = record(raw.grid);
  const composition = record(raw.composition);
  const extra = record(raw.controls);
  const tone = record(raw.tone);
  const columns = number(grid.columns ?? extra.columns ?? raw.cols, 10);
  const rows = number(grid.rows ?? extra.rows ?? raw.rows, 12);
  const gridSource = {
    ...grid,
    visible: grid.visible ?? raw.gridEnabled ?? true,
    columns,
    rows,
    trueSquareCells: grid.trueSquareCells ?? raw.square ?? true,
    color: grid.color ?? raw.gridColor ?? DEFAULT_GRID.color,
    opacity:
      grid.opacity ??
      (typeof raw.gridOpacity === 'number' ? raw.gridOpacity / 100 : DEFAULT_GRID.opacity),
    thickness: grid.thickness ?? raw.gridWeight ?? DEFAULT_GRID.thickness,
    labelsEnabled: grid.labelsEnabled ?? raw.labels ?? false,
    majorEvery: grid.majorEvery ?? (raw.majors ? 5 : 0),
  };
  const toneSource = {
    ...tone,
    grayscale: tone.grayscale ?? extra.grayscale ?? true,
    brightness: tone.brightness ?? extra.brightness ?? 0,
    contrast: tone.contrast ?? extra.contrast ?? 0,
    shadows: tone.shadows ?? extra.shadows ?? 0,
    highlights: tone.highlights ?? extra.highlights ?? 0,
    gamma: tone.gamma ?? extra.gamma ?? 1,
  };
  return {
    ...raw,
    grid: gridSource,
    tone: toneSource,
    composition: {
      ...composition,
      crop: composition.crop ?? raw.crop,
      mirror: composition.mirror ?? raw.mirror ?? false,
    },
    study: raw.study ?? { enabled: extra.posterize ?? false, levels: extra.levels ?? 5 },
    paper: raw.paper ?? { unit: 'cm', widthCm: 20, heightCm: 24 },
    print: raw.print ?? DEFAULT_PRINT,
    exportDefaults: raw.exportDefaults ?? raw.export ?? DEFAULT_EXPORT,
  };
}

/** Validate, clamp and migrate any parsed .tonal JSON. */
export function migrateProject(raw: unknown, now = new Date()): TonalProject {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProjectFormatError('This is not a TONAL project file.');
  }
  let data = record(raw);
  if (data.kind !== PROJECT_KIND) {
    throw new ProjectFormatError('This file is not a TONAL project (missing "tonal.project" kind).');
  }
  const version = number(data.schemaVersion, 0);
  if (version > SCHEMA_VERSION) {
    throw new ProjectFormatError(
      `This project was created with a newer version of TONAL (schema ${version}). Update the app to open it.`,
    );
  }
  if (version < 1) {
    data = upgradeLegacy(data);
  }

  const base = createProject(now);
  const source = normalizeSource(data.source);
  const createdAt = typeof data.createdAt === 'string' ? data.createdAt : base.createdAt;
  const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : createdAt;
  const view = record(data.view);
  const hasView = typeof view.zoom === 'number' || view.zoom === 'fit';

  const project: TonalProject = {
    kind: PROJECT_KIND,
    schemaVersion: SCHEMA_VERSION,
    appVersion: string(data.appVersion, APP_VERSION, 40),
    title: string(data.title, 'Untitled reference', 160).trim() || 'Untitled reference',
    createdAt,
    updatedAt,
    source,
    grid: normalizeGrid(data.grid),
    composition: {
      crop: normalizeCrop(record(data.composition).crop, { x: 0, y: 0, width: 1, height: 1 }),
      mirror: bool(record(data.composition).mirror, false),
    },
    tone: normalizeTone(data.tone),
    study: normalizeStudy(data.study),
    paper: normalizePaper(data.paper),
    print: normalizePrint(data.print),
    exportDefaults: normalizeExportDefaults(data.exportDefaults),
  };

  if (hasView) {
    const projectView: ProjectView = {
      zoom: view.zoom === 'fit' ? 'fit' : clamp(number(view.zoom, 1), 0.05, 32),
      panX: clamp(number(view.panX, 0), -100_000, 100_000),
      panY: clamp(number(view.panY, 0), -100_000, 100_000),
    };
    project.view = projectView;
  }

  return project;
}

export function parseProject(json: string, now = new Date()): TonalProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ProjectFormatError('The project file is damaged or is not valid JSON.');
  }
  return migrateProject(parsed, now);
}

export function serializeProject(project: TonalProject): string {
  return JSON.stringify(project, null, 2);
}

export function fingerprintProject(project: TonalProject): string {
  const stable = Object.fromEntries(
    Object.entries(project).filter(([key]) => key !== 'updatedAt' && key !== 'view'),
  );
  return JSON.stringify(stable);
}

export function withUpdatedAt(project: TonalProject, now = new Date()): TonalProject {
  return { ...project, updatedAt: now.toISOString() };
}

export function displayProjectName(project: TonalProject | null, projectPath: string | null): string {
  if (projectPath) {
    const name = projectPath.split(/[\\/]/).pop() ?? '';
    return name.replace(/\.tonal$/i, '');
  }
  return project?.title || 'Untitled reference';
}

export function projectFolder(projectPath: string | null): string | null {
  if (!projectPath) return null;
  const index = Math.max(projectPath.lastIndexOf('\\'), projectPath.lastIndexOf('/'));
  return index > 0 ? projectPath.slice(0, index) : null;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function sourceStem(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') || 'reference';
}
