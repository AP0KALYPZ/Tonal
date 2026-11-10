import type { CropRect, ExportMode, GridSettings, ResolutionMode } from './types';

export const EPSILON = 1e-9;
/** RGBA at this size is ~1 GiB. It is a memory guard, not a product megapixel cap. */
export const MAX_EXPORT_PIXELS = 268_435_456;
export const MAX_EXPORT_EDGE = 60_000;
export const MIN_CROP_FRACTION = 0.01;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clamp(Number.isFinite(value) ? value : min, min, max));
}

export function clampCrop(crop: CropRect): CropRect {
  const width = clamp(crop.width, MIN_CROP_FRACTION, 1);
  const height = clamp(crop.height, MIN_CROP_FRACTION, 1);
  const x = clamp(crop.x, 0, 1 - width);
  const y = clamp(crop.y, 0, 1 - height);
  return { x, y, width, height };
}

export function isCropWithinBounds(crop: CropRect, epsilon = 1e-6): boolean {
  return (
    Number.isFinite(crop.x) &&
    Number.isFinite(crop.y) &&
    Number.isFinite(crop.width) &&
    Number.isFinite(crop.height) &&
    crop.x >= -epsilon &&
    crop.y >= -epsilon &&
    crop.width > epsilon &&
    crop.height > epsilon &&
    crop.x + crop.width <= 1 + epsilon &&
    crop.y + crop.height <= 1 + epsilon
  );
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Canonical true-square crop. The longest crop with the grid's aspect ratio is
 * centered on `focal` (a point in normalized source coordinates).
 *
 * This never stretches the source: only the crop rectangle changes.
 */
export function calculateSquareCrop(
  sourceWidth: number,
  sourceHeight: number,
  columns: number,
  rows: number,
  focal: Point = { x: 0.5, y: 0.5 },
): CropRect {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const targetAspect = columns / rows;
  const sourceAspect = sourceWidth / sourceHeight;

  let width: number;
  let height: number;
  if (sourceAspect > targetAspect) {
    height = 1;
    width = targetAspect / sourceAspect;
  } else {
    width = 1;
    height = sourceAspect / targetAspect;
  }

  // Guard against float noise at extreme ratios.
  width = clamp(width, EPSILON, 1);
  height = clamp(height, EPSILON, 1);

  const x = clamp(focal.x - width / 2, 0, 1 - width);
  const y = clamp(focal.y - height / 2, 0, 1 - height);
  return { x, y, width, height };
}

export function cropCenter(crop: CropRect): Point {
  return { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 };
}

export function centerCropOn(crop: CropRect, focal: Point): CropRect {
  return clampCrop({
    x: focal.x - crop.width / 2,
    y: focal.y - crop.height / 2,
    width: crop.width,
    height: crop.height,
  });
}

/** Recompute a square crop after rows/columns change, retaining the current focal point. */
export function recomputeSquareCrop(
  crop: CropRect,
  sourceWidth: number,
  sourceHeight: number,
  columns: number,
  rows: number,
): CropRect {
  return calculateSquareCrop(sourceWidth, sourceHeight, columns, rows, cropCenter(crop));
}

export function fullCrop(): CropRect {
  return { x: 0, y: 0, width: 1, height: 1 };
}

/** The largest source-preserving crop at the current free crop's aspect, centered. */
export function centeredFreeCrop(sourceWidth: number, sourceHeight: number): CropRect {
  void sourceWidth;
  void sourceHeight;
  return fullCrop();
}

export function cropPixelSize(
  crop: CropRect,
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  return {
    width: crop.width * sourceWidth,
    height: crop.height * sourceHeight,
  };
}

export function cropAspect(crop: CropRect, sourceWidth: number, sourceHeight: number): number {
  const size = cropPixelSize(crop, sourceWidth, sourceHeight);
  return size.width / size.height;
}

export function percentOfSourceKept(crop: CropRect): number {
  return clamp(crop.width * crop.height * 100, 0, 100);
}

export function isSquareCrop(
  crop: CropRect,
  sourceWidth: number,
  sourceHeight: number,
  columns: number,
  rows: number,
  tolerance = 1e-6,
): boolean {
  const target = columns / rows;
  return Math.abs(cropAspect(crop, sourceWidth, sourceHeight) - target) <= tolerance * target;
}

export type CropHandle = 'nw' | 'ne' | 'sw' | 'se';

/**
 * Resize a free crop by one corner. The dragged corner moves; the opposite one
 * stays fixed. Values are normalized deltas from the pointer movement.
 */
export function resizeCrop(
  crop: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  minSize = 0.02,
): CropRect {
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.width;
  let bottom = crop.y + crop.height;

  if (handle === 'nw' || handle === 'sw') left = clamp(left + dx, 0, right - minSize);
  if (handle === 'ne' || handle === 'se') right = clamp(right + dx, left + minSize, 1);
  if (handle === 'nw' || handle === 'ne') top = clamp(top + dy, 0, bottom - minSize);
  if (handle === 'sw' || handle === 'se') bottom = clamp(bottom + dy, top + minSize, 1);

  return clampCrop({ x: left, y: top, width: right - left, height: bottom - top });
}

export function moveCrop(crop: CropRect, dx: number, dy: number): CropRect {
  return clampCrop({ ...crop, x: crop.x + dx, y: crop.y + dy });
}

/** Excel-style column names: 1=A, 26=Z, 27=AA, 52=AZ, 53=BA, 100=CV. */
export function columnLabel(oneBasedIndex: number): string {
  let n = Math.max(1, Math.round(oneBasedIndex));
  let label = '';
  while (n > 0) {
    n -= 1;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label;
}

export function cellLabel(columnIndex: number, rowIndex: number): string {
  return `${columnLabel(columnIndex + 1)}${rowIndex + 1}`;
}

/** Continuous boundary positions, including both outer edges exactly. */
export function gridLinePositions(frameLength: number, count: number): number[] {
  const positions: number[] = [];
  for (let i = 0; i <= count; i += 1) {
    positions.push(i === count ? frameLength : (frameLength * i) / count);
  }
  return positions;
}

export function isMajorLine(index: number, count: number, majorEvery: number): boolean {
  if (majorEvery < 2) return false;
  if (index <= 0 || index >= count) return false;
  return index % majorEvery === 0;
}

/** Grid stroke width in frame pixels. Cell-relative so previews and large exports agree. */
export function gridLineWidth(
  frameWidth: number,
  frameHeight: number,
  columns: number,
  rows: number,
  thickness: number,
): number {
  const cell = Math.min(frameWidth / columns, frameHeight / rows);
  return Math.max(0.75, cell * 0.012 * thickness);
}

export function majorLineWidth(
  frameWidth: number,
  frameHeight: number,
  columns: number,
  rows: number,
  thickness: number,
  majorThickness: number,
): number {
  return gridLineWidth(frameWidth, frameHeight, columns, rows, thickness) * majorThickness;
}

export function borderLineWidth(
  frameWidth: number,
  frameHeight: number,
  columns: number,
  rows: number,
  thickness: number,
): number {
  return gridLineWidth(frameWidth, frameHeight, columns, rows, thickness) * 1.45;
}

export function labelFontSize(
  frameWidth: number,
  frameHeight: number,
  columns: number,
  rows: number,
): number {
  const cell = Math.min(frameWidth / columns, frameHeight / rows);
  return Math.max(6, cell * 0.15);
}

export function labelsAreTight(
  frameWidth: number,
  frameHeight: number,
  columns: number,
  rows: number,
  placement: 'cells' | 'perimeter',
): boolean {
  const cell = Math.min(frameWidth / columns, frameHeight / rows);
  return placement === 'cells' ? cell < 36 : cell < 16;
}

export interface PngSizeInput {
  crop: CropRect;
  sourceWidth: number;
  sourceHeight: number;
  columns: number;
  rows: number;
  trueSquareCells: boolean;
  resolution: ResolutionMode;
  scalePercent: number;
  customCellSize: number;
}

export interface PngSizeResult {
  width: number;
  height: number;
  /** Integer square-cell size; 0 when free/rectangular mode is active. */
  cellSize: number;
  nativeCellSize: number;
  cellWidth: number;
  cellHeight: number;
  squareCells: boolean;
  upscaled: boolean;
  valid: boolean;
  error?: string;
  nativeWidth: number;
  nativeHeight: number;
}

/**
 * Output dimensions for all three PNG modes. In square mode the output is
 * exactly C*k by R*k so cells are square to the pixel.
 */
export function computePngSize(input: PngSizeInput): PngSizeResult {
  const { crop, sourceWidth, sourceHeight, columns, rows } = input;
  const cropPxW = Math.max(1, crop.width * sourceWidth);
  const cropPxH = Math.max(1, crop.height * sourceHeight);
  const nativeWidth = Math.max(1, Math.round(cropPxW));
  const nativeHeight = Math.max(1, Math.round(cropPxH));

  let width: number;
  let height: number;
  let cellSize = 0;
  let nativeCellSize = 0;

  if (input.trueSquareCells) {
    nativeCellSize = Math.max(1, Math.floor(Math.min(cropPxW / columns, cropPxH / rows)));
    if (input.resolution === 'custom') {
      cellSize = clampInteger(input.customCellSize, 1, MAX_EXPORT_EDGE);
    } else {
      const factor = input.resolution === 'scale' ? input.scalePercent / 100 : 1;
      cellSize = Math.max(1, Math.round(nativeCellSize * factor));
    }
    width = columns * cellSize;
    height = rows * cellSize;
  } else {
    const factor = input.resolution === 'scale' ? input.scalePercent / 100 : 1;
    if (input.resolution === 'custom') {
      width = clampInteger(input.customCellSize, 1, MAX_EXPORT_EDGE);
      height = Math.max(1, Math.round((width * cropPxH) / cropPxW));
    } else {
      width = Math.max(1, Math.round(cropPxW * factor));
      height = Math.max(1, Math.round(cropPxH * factor));
    }
  }

  const upscaled = width > cropPxW + 0.5 || height > cropPxH + 0.5;
  let valid = true;
  let error: string | undefined;

  if (width > MAX_EXPORT_EDGE || height > MAX_EXPORT_EDGE) {
    valid = false;
    error = `Output must be at most ${MAX_EXPORT_EDGE.toLocaleString()} px on either side.`;
  } else if (width * height > MAX_EXPORT_PIXELS) {
    valid = false;
    error =
      'This output is too large for available memory. Reduce the cell size or choose a native resolution.';
  }

  return {
    width,
    height,
    cellSize,
    nativeCellSize,
    cellWidth: width / columns,
    cellHeight: height / rows,
    squareCells: Math.abs(width / columns - height / rows) < 1e-6,
    upscaled,
    valid,
    error,
    nativeWidth,
    nativeHeight,
  };
}

export function suggestedExportFilename(sourceName: string, mode: ExportMode): string {
  const stem = (sourceName || 'reference')
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim();
  const suffix = mode === 'combined' ? 'grid' : mode === 'photo' ? 'clean' : 'overlay';
  return `${stem || 'reference'}_TONAL_${suffix}.png`;
}

export function describeCells(width: number, columns: number, height: number, rows: number): string {
  const cellW = width / columns;
  const cellH = height / rows;
  if (Math.abs(cellW - cellH) < 1e-6) {
    return `square cells · ${cellW.toFixed(cellW < 10 ? 1 : 0)} px each`;
  }
  return `rectangular cells · ${cellW.toFixed(1)} × ${cellH.toFixed(1)} px`;
}

/** Clamp all grid values read from disk or user input. */
export function sanitizeGrid(grid: GridSettings): GridSettings {
  return {
    ...grid,
    columns: clampInteger(grid.columns, 1, 100),
    rows: clampInteger(grid.rows, 1, 100),
    opacity: clamp(grid.opacity, 0, 1),
    thickness: clamp(grid.thickness, 0.5, 3),
    majorEvery: [0, 2, 3, 4, 5, 10].includes(Math.round(grid.majorEvery))
      ? Math.round(grid.majorEvery)
      : 5,
    majorThickness: clamp(grid.majorThickness, 1, 2.5),
    color: /^#[0-9a-fA-F]{6}$/.test(grid.color) ? grid.color.toUpperCase() : '#D8B791',
    customColor: /^#[0-9a-fA-F]{6}$/.test(grid.customColor) ? grid.customColor.toUpperCase() : '#B98F62',
  };
}
