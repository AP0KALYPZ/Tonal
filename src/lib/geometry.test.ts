import { describe, expect, it } from 'vitest';
import {
  MAX_EXPORT_EDGE,
  calculateSquareCrop,
  cellLabel,
  clampCrop,
  columnLabel,
  computePngSize,
  cropAspect,
  gridLinePositions,
  isCropWithinBounds,
  moveCrop,
  percentOfSourceKept,
  resizeCrop,
} from './geometry';

describe('calculateSquareCrop', () => {
  it('crops 1200x1500 for 10x12 to 1200x1440 without stretching', () => {
    const crop = calculateSquareCrop(1200, 1500, 10, 12);
    expect(crop.width).toBeCloseTo(1, 12);
    expect(crop.height).toBeCloseTo(0.96, 12);
    expect(crop.x).toBeCloseTo(0, 12);
    expect(crop.y).toBeCloseTo(0.02, 12);
    expect(crop.width * 1200).toBeCloseTo(1200, 6);
    expect(crop.height * 1500).toBeCloseTo(1440, 6);
  });

  it('crops 3000x2000 for 8x10 to target aspect 0.8', () => {
    const crop = calculateSquareCrop(3000, 2000, 8, 10);
    expect(crop.height).toBeCloseTo(1, 12);
    expect(crop.width).toBeCloseTo(0.8 / 1.5, 12);
    expect(cropAspect(crop, 3000, 2000)).toBeCloseTo(0.8, 12);
    expect(crop.width * 3000).toBeCloseTo(1600, 6);
  });

  it('handles 1x1 and 100x100 grids', () => {
    const single = calculateSquareCrop(1200, 900, 1, 1);
    expect(cropAspect(single, 1200, 900)).toBeCloseTo(1, 12);
    const dense = calculateSquareCrop(1200, 900, 100, 100);
    expect(cropAspect(dense, 1200, 900)).toBeCloseTo(1, 12);
  });

  it('retains a focal point while clamping into the image', () => {
    const crop = calculateSquareCrop(3000, 2000, 1, 1, { x: 0.9, y: 0.1 });
    expect(crop.x + crop.width).toBeLessThanOrEqual(1 + 1e-12);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width / 2).toBeGreaterThan(0.5);
  });

  it('is valid and proportional over 1000 random source/grid combinations', () => {
    for (let i = 0; i < 1000; i += 1) {
      const width = 1 + Math.floor(Math.random() * 12000);
      const height = 1 + Math.floor(Math.random() * 12000);
      const columns = 1 + Math.floor(Math.random() * 100);
      const rows = 1 + Math.floor(Math.random() * 100);
      const crop = calculateSquareCrop(width, height, columns, rows, {
        x: Math.random(),
        y: Math.random(),
      });
      expect(isCropWithinBounds(crop, 1e-9)).toBe(true);
      expect(cropAspect(crop, width, height)).toBeCloseTo(columns / rows, 9);
      expect(crop.width * width).toBeLessThanOrEqual(width + 1e-6);
      expect(crop.height * height).toBeLessThanOrEqual(height + 1e-6);
    }
  });
});

describe('labels', () => {
  it('uses Excel-style column names', () => {
    expect(columnLabel(1)).toBe('A');
    expect(columnLabel(26)).toBe('Z');
    expect(columnLabel(27)).toBe('AA');
    expect(columnLabel(52)).toBe('AZ');
    expect(columnLabel(53)).toBe('BA');
    expect(columnLabel(100)).toBe('CV');
  });

  it('builds 1-based cell coordinates', () => {
    expect(cellLabel(0, 0)).toBe('A1');
    expect(cellLabel(9, 11)).toBe('J12');
    expect(cellLabel(99, 99)).toBe('CV100');
  });

  it('produces continuous boundaries with exact endpoints', () => {
    const positions = gridLinePositions(1200, 10);
    expect(positions).toHaveLength(11);
    expect(positions[0]).toBe(0);
    expect(positions[10]).toBe(1200);
    for (let i = 1; i < positions.length; i += 1) {
      expect((positions[i] ?? 0) - (positions[i - 1] ?? 0)).toBeCloseTo(120, 9);
    }
  });
});

describe('crop operations', () => {
  it('clamps moved crops into normalized bounds', () => {
    const moved = moveCrop({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, 0.9, -0.9);
    expect(moved.x).toBeCloseTo(0.5, 12);
    expect(moved.y).toBeCloseTo(0, 12);
    expect(clampCrop(moved)).toEqual(moved);
  });

  it('resizes from a corner with a minimum size', () => {
    const resized = resizeCrop({ x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, 'nw', 0.1, 0.1);
    expect(resized.x).toBeCloseTo(0.3, 12);
    expect(resized.y).toBeCloseTo(0.3, 12);
    expect(resized.width).toBeCloseTo(0.5, 12);
    expect(resized.height).toBeCloseTo(0.5, 12);
  });

  it('reports kept source percentage', () => {
    expect(percentOfSourceKept({ x: 0, y: 0, width: 1, height: 0.96 })).toBeCloseTo(96, 12);
  });
});

describe('computePngSize', () => {
  const base = {
    crop: { x: 0, y: 0.02, width: 1, height: 0.96 },
    sourceWidth: 1200,
    sourceHeight: 1500,
    columns: 10,
    rows: 12,
    trueSquareCells: true,
    resolution: 'native' as const,
    scalePercent: 100,
    customCellSize: 200,
  };

  it('produces exact integer square cells at native resolution', () => {
    const result = computePngSize(base);
    expect(result.width).toBe(1200);
    expect(result.height).toBe(1440);
    expect(result.cellSize).toBe(120);
    expect(result.width / base.columns).toBe(result.height / base.rows);
    expect(result.squareCells).toBe(true);
  });

  it('honours custom integer cell sizes exactly', () => {
    const result = computePngSize({ ...base, resolution: 'custom', customCellSize: 137 });
    expect(result.width).toBe(1370);
    expect(result.height).toBe(1644);
    expect(result.width / base.columns).toBe(137);
    expect(result.height / base.rows).toBe(137);
  });

  it('honours a percentage scale with integer cells', () => {
    const result = computePngSize({ ...base, resolution: 'scale', scalePercent: 50 });
    expect(result.width).toBe(600);
    expect(result.height).toBe(720);
    expect(result.cellSize).toBe(60);
  });

  it('keeps free-mode dimensions aspect-correct and reports rectangular cells', () => {
    const result = computePngSize({
      ...base,
      crop: { x: 0, y: 0, width: 1, height: 2 / 3 },
      trueSquareCells: false,
    });
    expect(result.width).toBe(1200);
    expect(result.height).toBe(1000);
    expect(result.squareCells).toBe(false);
    expect(result.cellWidth).toBe(120);
    expect(result.cellHeight).toBeCloseTo(83.333, 2);
  });

  it('detects upscaling rather than silently claiming native detail', () => {
    const result = computePngSize({ ...base, resolution: 'custom', customCellSize: 400 });
    expect(result.upscaled).toBe(true);
  });

  it('rejects sizes beyond safe memory/edge limits', () => {
    const result = computePngSize({ ...base, resolution: 'custom', customCellSize: MAX_EXPORT_EDGE + 5 });
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('always gives exact C×k and R×k dimensions for 500 random square combinations', () => {
    for (let i = 0; i < 500; i += 1) {
      const columns = 1 + Math.floor(Math.random() * 100);
      const rows = 1 + Math.floor(Math.random() * 100);
      const crop = calculateSquareCrop(800, 1600, columns, rows);
      const result = computePngSize({
        crop,
        sourceWidth: 800,
        sourceHeight: 1600,
        columns,
        rows,
        trueSquareCells: true,
        resolution: 'native',
        scalePercent: 100,
        customCellSize: 100,
      });
      expect(result.width % columns).toBe(0);
      expect(result.height % rows).toBe(0);
      expect(result.width / columns).toBe(result.height / rows);
    }
  });
});
