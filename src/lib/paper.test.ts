import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER, DEFAULT_PRINT } from './defaults';
import {
  computePrintLayout,
  drawingAreaFitsGridRatio,
  formatLength,
  mmToUnit,
  pageSizeMm,
  physicalCells,
  printWarnings,
  suggestDrawingArea,
  unitToMm,
} from './paper';
import type { PrintSettings } from './types';

function layout(overrides: Partial<PrintSettings> = {}) {
  return computePrintLayout({
    paper: { unit: 'cm', width: 20, height: 24 },
    print: { ...DEFAULT_PRINT, marginMm: 5, ...overrides },
    crop: { x: 0, y: 0.02, width: 1, height: 0.96 },
    sourceWidth: 1200,
    sourceHeight: 1500,
    columns: 10,
    rows: 12,
  });
}

describe('physical paper calibration', () => {
  it('computes 2 x 2 cm cells for 20 x 24 cm at 10 x 12', () => {
    const cells = physicalCells({ unit: 'cm', width: 20, height: 24 }, 10, 12);
    expect(cells.cellWidth).toBeCloseTo(2, 10);
    expect(cells.cellHeight).toBeCloseTo(2, 10);
    expect(cells.square).toBe(true);
    expect(cells.differencePercent).toBeCloseTo(0, 10);
  });

  it('warns honestly when a 20 x 25 cm area yields rectangular cells', () => {
    const cells = physicalCells({ unit: 'cm', width: 20, height: 25 }, 10, 12);
    expect(cells.square).toBe(false);
    expect(cells.cellWidth).toBeCloseTo(2, 10);
    expect(cells.cellHeight).toBeCloseTo(25 / 12, 10);
    expect(drawingAreaFitsGridRatio({ unit: 'cm', width: 20, height: 25 }, 10, 12)).toBe(false);
  });

  it('suggests a ratio-correct area inside the current box', () => {
    const suggestion = suggestDrawingArea({ unit: 'cm', width: 20, height: 25 }, 10, 12);
    expect(suggestion.height).toBeCloseTo(24, 2);
    expect(suggestion.width).toBeCloseTo(20, 2);
    expect(drawingAreaFitsGridRatio(suggestion, 10, 12)).toBe(true);
  });

  it('converts units both ways', () => {
    expect(unitToMm(2, 'cm')).toBe(20);
    expect(unitToMm(1, 'in')).toBeCloseTo(25.4, 10);
    expect(mmToUnit(25.4, 'in')).toBeCloseTo(1, 10);
    expect(formatLength(20, 'cm')).toBe('2 cm');
    expect(formatLength(25.4, 'in', 2)).toBe('1 in');
  });

  it('handles page presets and orientation', () => {
    const portrait = pageSizeMm({ ...DEFAULT_PRINT, page: 'letter', orientation: 'portrait' });
    expect(portrait.width).toBeCloseTo(215.9, 2);
    expect(portrait.height).toBeCloseTo(279.4, 2);
    const landscape = pageSizeMm({ ...DEFAULT_PRINT, page: 'letter', orientation: 'landscape' });
    expect(landscape.width).toBeCloseTo(279.4, 2);
    expect(landscape.height).toBeCloseTo(215.9, 2);
  });
});

describe('print layout', () => {
  it('prints 20 x 24 cm at actual size with square cells and one A4 page', () => {
    const result = layout();
    expect(result.frameWmm).toBeCloseTo(200, 6);
    expect(result.frameHmm).toBeCloseTo(240, 6);
    expect(result.cellWmm).toBeCloseTo(20, 6);
    expect(result.cellHmm).toBeCloseTo(20, 6);
    expect(result.squareCells).toBe(true);
    expect(result.scale).toBe(1);
    expect(result.pages).toBe(1);
    expect(result.tilesX).toBe(1);
    expect(result.tilesY).toBe(1);
    expect(result.printedPixelWidth).toBe(Math.round((200 / 25.4) * 300));
  });

  it('tiles a large print across pages with overlap', () => {
    const result = computePrintLayout({
      paper: { unit: 'cm', width: 60, height: 80 },
      print: { ...DEFAULT_PRINT, page: 'a4', marginMm: 5, overlapMm: 10 },
      crop: { x: 0, y: 0, width: 0.8, height: 1 },
      sourceWidth: 3000,
      sourceHeight: 3750,
      columns: 12,
      rows: 15,
    });
    expect(result.frameWmm).toBeCloseTo(512, 6);
    expect(result.frameHmm).toBeCloseTo(800, 6);
    expect(result.tilesX).toBeGreaterThan(1);
    expect(result.tilesY).toBeGreaterThan(1);
    expect(result.pages).toBe(result.tilesX * result.tilesY);
  });

  it('fits into the drawing area without stretching when the area ratio differs', () => {
    const result = computePrintLayout({
      paper: { unit: 'cm', width: 20, height: 25 },
      print: DEFAULT_PRINT,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      sourceWidth: 1200,
      sourceHeight: 1440,
      columns: 10,
      rows: 12,
    });
    expect(result.fitWmm).toBeCloseTo(200, 6);
    expect(result.fitHmm).toBeCloseTo(240, 6);
    expect(result.unusedHmm).toBeCloseTo(10, 6);
    expect(result.areaRatioMismatch).toBe(true);
    expect(result.squareCells).toBe(true);
    expect(printWarnings(result, true).some((warning) => /does not match/i.test(warning))).toBe(true);
  });

  it('explicitly reports rectangular printed cells in free mode', () => {
    const result = computePrintLayout({
      paper: { unit: 'cm', width: 20, height: 24 },
      print: DEFAULT_PRINT,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      sourceWidth: 1200,
      sourceHeight: 1000,
      columns: 10,
      rows: 12,
    });
    expect(result.squareCells).toBe(false);
    expect(printWarnings(result, false).some((warning) => /rectangular/i.test(warning))).toBe(true);
  });

  it('scales the printed frame and cell sizes by an explicit percentage', () => {
    const result = layout({ scalePercent: 50 });
    expect(result.frameWmm).toBeCloseTo(100, 6);
    expect(result.frameHmm).toBeCloseTo(120, 6);
    expect(result.cellWmm).toBeCloseTo(10, 6);
    expect(result.scale).toBe(0.5);
    expect(printWarnings(result, true).some((warning) => /50%/.test(warning))).toBe(true);
  });

  it('keeps page content positive for extreme margins and overlaps', () => {
    const result = layout({ marginMm: 40, overlapMm: 50, page: 'letter', orientation: 'landscape' });
    expect(result.contentWmm).toBeGreaterThan(0);
    expect(result.contentHmm).toBeGreaterThan(0);
    expect(Number.isFinite(result.pages)).toBe(true);
    expect(result.pages).toBeGreaterThanOrEqual(1);
  });

  it('uses default paper 20 x 24 cm', () => {
    expect(DEFAULT_PAPER).toEqual({ unit: 'cm', width: 20, height: 24 });
  });
});
