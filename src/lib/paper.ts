import { clamp } from './geometry';
import type { CropRect, PaperSettings, PaperUnit, PrintSettings } from './types';

export const MM_PER_INCH = 25.4;

export function unitToMm(value: number, unit: PaperUnit): number {
  if (unit === 'cm') return value * 10;
  if (unit === 'in') return value * MM_PER_INCH;
  return value;
}

export function mmToUnit(value: number, unit: PaperUnit): number {
  if (unit === 'cm') return value / 10;
  if (unit === 'in') return value / MM_PER_INCH;
  return value;
}

export function formatLength(mm: number, unit: PaperUnit, digits = 2): string {
  const value = mmToUnit(mm, unit);
  const rounded = Math.abs(value - Math.round(value)) < 0.005 ? Math.round(value).toString() : value.toFixed(digits);
  return `${rounded} ${unit}`;
}

export interface PhysicalCells {
  cellWidthMm: number;
  cellHeightMm: number;
  cellWidth: number;
  cellHeight: number;
  square: boolean;
  differencePercent: number;
}

export function physicalCells(
  paper: PaperSettings,
  columns: number,
  rows: number,
): PhysicalCells {
  const widthMm = unitToMm(paper.width, paper.unit);
  const heightMm = unitToMm(paper.height, paper.unit);
  const cellWidthMm = widthMm / columns;
  const cellHeightMm = heightMm / rows;
  const differencePercent =
    (Math.abs(cellWidthMm - cellHeightMm) / Math.max(1e-9, Math.max(cellWidthMm, cellHeightMm))) * 100;
  return {
    cellWidthMm,
    cellHeightMm,
    cellWidth: mmToUnit(cellWidthMm, paper.unit),
    cellHeight: mmToUnit(cellHeightMm, paper.unit),
    square: differencePercent < 0.1,
    differencePercent,
  };
}

export function paperAspect(paper: PaperSettings): number {
  return unitToMm(paper.width, paper.unit) / unitToMm(paper.height, paper.unit);
}

export function drawingAreaFitsGridRatio(
  paper: PaperSettings,
  columns: number,
  rows: number,
  tolerance = 0.001,
): boolean {
  const target = columns / rows;
  return Math.abs(paperAspect(paper) - target) / target <= tolerance;
}

/** Suggest the largest drawing area with the grid's exact ratio inside the current area. */
export function suggestDrawingArea(
  paper: PaperSettings,
  columns: number,
  rows: number,
): PaperSettings {
  const widthMm = unitToMm(paper.width, paper.unit);
  const heightMm = unitToMm(paper.height, paper.unit);
  const target = columns / rows;
  let suggestedW = widthMm;
  let suggestedH = widthMm / target;
  if (suggestedH > heightMm) {
    suggestedH = heightMm;
    suggestedW = heightMm * target;
  }
  return {
    ...paper,
    width: Number(mmToUnit(suggestedW, paper.unit).toFixed(2)),
    height: Number(mmToUnit(suggestedH, paper.unit).toFixed(2)),
  };
}

export interface PageSizeMm {
  width: number;
  height: number;
}

export const PAGE_PRESETS: Record<'a4' | 'letter' | 'a3', PageSizeMm> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
  a3: { width: 297, height: 420 },
};

export function pageSizeMm(print: PrintSettings): PageSizeMm {
  let base: PageSizeMm;
  if (print.page === 'custom') {
    base = {
      width: Math.max(50, print.customWidthMm || 210),
      height: Math.max(50, print.customHeightMm || 297),
    };
  } else {
    base = PAGE_PRESETS[print.page];
  }
  return print.orientation === 'landscape'
    ? { width: Math.max(base.width, base.height), height: Math.min(base.width, base.height) }
    : { width: Math.min(base.width, base.height), height: Math.max(base.width, base.height) };
}

export interface PdfLayout {
  areaWmm: number;
  areaHmm: number;
  /** Frame size at 100%, aspect-preserved and fitted inside the drawing area. */
  fitWmm: number;
  fitHmm: number;
  unusedWmm: number;
  unusedHmm: number;
  scale: number;
  frameWmm: number;
  frameHmm: number;
  cellWmm: number;
  cellHmm: number;
  squareCells: boolean;
  areaRatioMismatch: boolean;
  suggestedPaper: PaperSettings;
  pageWmm: number;
  pageHmm: number;
  marginMm: number;
  contentWmm: number;
  contentHmm: number;
  overlapMm: number;
  tilesX: number;
  tilesY: number;
  pages: number;
  printedPixelWidth: number;
  printedPixelHeight: number;
  pagePresetLabel: string;
}

export function fitRect(areaW: number, areaH: number, aspect: number): { width: number; height: number } {
  let width = areaW;
  let height = areaW / aspect;
  if (height > areaH) {
    height = areaH;
    width = areaH * aspect;
  }
  return { width, height };
}

export function computePrintLayout(input: {
  paper: PaperSettings;
  print: PrintSettings;
  crop: CropRect;
  sourceWidth: number;
  sourceHeight: number;
  columns: number;
  rows: number;
}): PdfLayout {
  const { paper, print, crop, sourceWidth, sourceHeight, columns, rows } = input;
  const areaWmm = Math.max(10, unitToMm(paper.width, paper.unit));
  const areaHmm = Math.max(10, unitToMm(paper.height, paper.unit));
  const cropW = Math.max(1, crop.width * sourceWidth);
  const cropH = Math.max(1, crop.height * sourceHeight);
  const aspect = cropW / cropH;

  const fitted = fitRect(areaWmm, areaHmm, aspect);
  const scale = clamp(print.scalePercent / 100, 0.1, 10);
  const frameWmm = fitted.width * scale;
  const frameHmm = fitted.height * scale;

  const page = pageSizeMm(print);
  const margin = clamp(print.marginMm, 0, Math.min(page.width, page.height) / 3);
  const contentW = Math.max(20, page.width - margin * 2);
  const contentH = Math.max(20, page.height - margin * 2);
  const overlap = clamp(print.overlapMm, 0, Math.min(contentW, contentH) / 2);

  const advanceX = Math.max(10, contentW - overlap);
  const advanceY = Math.max(10, contentH - overlap);
  const tilesX = Math.max(1, Math.ceil((frameWmm - overlap) / advanceX));
  const tilesY = Math.max(1, Math.ceil((frameHmm - overlap) / advanceY));
  const pages = tilesX * tilesY;

  const dpi = clamp(print.dpi || 300, 72, 600);
  const printedPixelWidth = Math.max(1, Math.round((frameWmm / MM_PER_INCH) * dpi));
  const printedPixelHeight = Math.max(1, Math.round((frameHmm / MM_PER_INCH) * dpi));

  const cellWmm = frameWmm / columns;
  const cellHmm = frameHmm / rows;
  const squareCells = Math.abs(cellWmm - cellHmm) < 1e-6 * Math.max(cellWmm, cellHmm);
  const targetAspect = columns / rows;
  const areaAspect = areaWmm / areaHmm;
  const areaRatioMismatch = Math.abs(areaAspect - targetAspect) / targetAspect > 0.001;

  const presetLabel =
    print.page === 'custom'
      ? 'Custom page'
      : print.page === 'a4'
        ? 'A4'
        : print.page === 'letter'
          ? 'Letter'
          : 'A3';

  return {
    areaWmm,
    areaHmm,
    fitWmm: fitted.width,
    fitHmm: fitted.height,
    unusedWmm: Math.max(0, areaWmm - fitted.width),
    unusedHmm: Math.max(0, areaHmm - fitted.height),
    scale,
    frameWmm,
    frameHmm,
    cellWmm,
    cellHmm,
    squareCells,
    areaRatioMismatch,
    suggestedPaper: suggestDrawingArea(paper, columns, rows),
    pageWmm: page.width,
    pageHmm: page.height,
    marginMm: margin,
    contentWmm: contentW,
    contentHmm: contentH,
    overlapMm: overlap,
    tilesX,
    tilesY,
    pages,
    printedPixelWidth,
    printedPixelHeight,
    pagePresetLabel: presetLabel,
  };
}

export function printWarnings(layout: PdfLayout, trueSquareCells: boolean): string[] {
  const warnings: string[] = [];
  if (trueSquareCells && layout.areaRatioMismatch) {
    warnings.push(
      `Your drawing area is ${layout.areaWmm.toFixed(1)} × ${layout.areaHmm.toFixed(1)} mm, which does not match the ${layout.areaWmm > 0 ? '' : ''}grid ratio. The reference will print at ${layout.fitWmm.toFixed(1)} × ${layout.fitHmm.toFixed(1)} mm with square cells and unused space.`,
    );
  }
  if (!layout.squareCells) {
    warnings.push(
      `Printed cells would be ${layout.cellWmm.toFixed(2)} × ${layout.cellHmm.toFixed(2)} mm — rectangular, not square.`,
    );
  }
  if (layout.scale !== 1) {
    warnings.push(
      `Printing at ${Math.round(layout.scale * 100)}% changes the actual cell size. Use 100% for ruler-accurate squares.`,
    );
  }
  return warnings;
}
