import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './store';
import type { ImportedSource } from '../lib/types';
import { cropAspect } from '../lib/geometry';

const imported: ImportedSource = {
  path: 'C:\\photos\\portrait.png',
  filename: 'portrait.png',
  orientedWidth: 1200,
  orientedHeight: 1500,
  proxyWidth: 1200,
  proxyHeight: 1500,
  dataUrl: 'data:image/png;base64,AAAA',
  format: 'image/png',
  hasAlpha: false,
  checksumSha256: 'a'.repeat(64),
  bytes: 1000,
  warnings: [],
};

function preview() {
  return { dataUrl: imported.dataUrl, proxyWidth: 1200, proxyHeight: 1500, warning: [] };
}

beforeEach(() => {
  useAppStore.getState().newProject();
});

describe('source and true-square crop', () => {
  it('initializes a centered 10x12 square crop on import', () => {
    useAppStore.getState().setSource(imported, preview(), true);
    const project = useAppStore.getState().project;
    expect(project.source?.orientedWidth).toBe(1200);
    expect(project.composition.crop.width).toBeCloseTo(1, 9);
    expect(project.composition.crop.height).toBeCloseTo(0.96, 9);
    expect(project.composition.crop.y).toBeCloseTo(0.02, 9);
    expect(useAppStore.getState().sourceStatus).toBe('ready');
    expect(useAppStore.getState().dirty).toBe(true);
  });

  it('recomputes the crop for independent row/column changes without moving its centre', () => {
    useAppStore.getState().setSource(imported, preview(), true);
    useAppStore.getState().setGrid({ columns: 20 });
    let project = useAppStore.getState().project;
    expect(project.grid.columns).toBe(20);
    expect(project.composition.crop.height).toBeCloseTo(0.48, 9);
    expect(project.composition.crop.y + project.composition.crop.height / 2).toBeCloseTo(0.5, 9);

    useAppStore.getState().setGrid({ rows: 24 });
    project = useAppStore.getState().project;
    expect(project.grid.rows).toBe(24);
    expect(cropAspect(project.composition.crop, 1200, 1500)).toBeCloseTo(20 / 24, 9);
  });

  it('supports free rectangular framing and returns to square framing', () => {
    useAppStore.getState().setSource(imported, preview(), true);
    useAppStore.getState().setGrid({ trueSquareCells: false });
    useAppStore.getState().setCrop({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    const free = useAppStore.getState().project.composition.crop;
    expect(free).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });

    useAppStore.getState().setGrid({ trueSquareCells: true });
    const square = useAppStore.getState().project.composition.crop;
    expect(cropAspect(square, 1200, 1500)).toBeCloseTo(10 / 12, 8);
    expect(square.x).toBeCloseTo(0, 9);
    expect(square.y).toBeCloseTo(0, 9);
    expect(square.x + square.width / 2).toBeCloseTo(0.5, 9);
    expect(square.y + square.height / 2).toBeCloseTo(0.48, 9);
  });

  it('does not accumulate crop drift across repeated grid changes and undo', () => {
    useAppStore.getState().setSource(imported, preview(), true);
    const original = useAppStore.getState().project.composition.crop;
    useAppStore.getState().setGrid({ columns: 14 });
    useAppStore.getState().setGrid({ rows: 17 });
    useAppStore.getState().setGrid({ columns: 10 });
    useAppStore.getState().setGrid({ rows: 12 });
    const current = useAppStore.getState().project.composition.crop;
    expect(current.width).toBeCloseTo(original.width, 9);
    expect(current.height).toBeCloseTo(original.height, 9);
    expect(current.x).toBeCloseTo(original.x, 9);
    expect(current.y).toBeCloseTo(original.y, 9);
    expect(current.x + current.width / 2).toBeCloseTo(0.5, 9);
    expect(current.y + current.height / 2).toBeCloseTo(0.5, 9);
  });

  it('centers and fits the crop on demand', () => {
    useAppStore.getState().setSource(imported, preview(), true);
    useAppStore.getState().setGrid({ trueSquareCells: false });
    useAppStore.getState().setCrop({ x: 0.6, y: 0.6, width: 0.3, height: 0.3 });
    useAppStore.getState().centerCrop();
    const centered = useAppStore.getState().project.composition.crop;
    expect(centered.x + centered.width / 2).toBeCloseTo(0.5, 9);
    useAppStore.getState().fitSource();
    expect(useAppStore.getState().project.composition.crop).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('relinks a missing source while preserving the focal centre', () => {
    useAppStore.getState().setSource(imported, preview(), true);
    useAppStore.getState().setGrid({ trueSquareCells: false });
    useAppStore.getState().setCrop({ x: 0.2, y: 0.1, width: 0.6, height: 0.6 });
    useAppStore.getState().setGrid({ trueSquareCells: true });
    useAppStore.getState().relinkSource({
      ...imported,
      path: 'C:\\photos\\moved.png',
      orientedWidth: 2400,
      orientedHeight: 2400,
    });
    const project = useAppStore.getState().project;
    expect(project.source?.originalPath).toBe('C:\\photos\\moved.png');
    expect(project.source?.orientedWidth).toBe(2400);
    expect(cropAspect(project.composition.crop, 2400, 2400)).toBeCloseTo(10 / 12, 9);
    expect(project.composition.crop.x + project.composition.crop.width / 2).toBeCloseTo(0.5, 9);
    expect(project.composition.crop.y + project.composition.crop.height / 2).toBeCloseTo(0.5, 9);
  });
});

describe('history', () => {
  it('coalesces a slider gesture into one undo step', () => {
    useAppStore.getState().setSource(imported, preview(), true);
    const before = useAppStore.getState().past.length;
    useAppStore.getState().beginGesture();
    useAppStore.getState().setTone({ brightness: 5 });
    useAppStore.getState().setTone({ brightness: 11 });
    useAppStore.getState().setTone({ brightness: 23 });
    useAppStore.getState().endGesture();
    expect(useAppStore.getState().past.length).toBe(before + 1);
    expect(useAppStore.getState().project.tone.brightness).toBe(23);
    useAppStore.getState().undo();
    expect(useAppStore.getState().project.tone.brightness).toBe(0);
    useAppStore.getState().redo();
    expect(useAppStore.getState().project.tone.brightness).toBe(23);
  });

  it('applies presets as one undoable action', () => {
    useAppStore.getState().setSource(imported, preview(), true);
    const past = useAppStore.getState().past.length;
    useAppStore.getState().applyPreset({
      id: 'soft',
      name: 'Soft Portrait',
      description: '',
      tone: {
        grayscale: true,
        brightness: 3,
        contrast: -8,
        shadows: 18,
        highlights: -4,
        gamma: 1.08,
        blackPoint: 0,
        whitePoint: 255,
      },
      study: { enabled: false, levels: 5 },
      swatch: '',
    });
    expect(useAppStore.getState().past.length).toBe(past + 1);
    expect(useAppStore.getState().project.tone.shadows).toBe(18);
    useAppStore.getState().undo();
    expect(useAppStore.getState().project.tone.shadows).toBe(0);
  });

  it('clears dirty when undo returns to the saved state', () => {
    useAppStore.getState().setSource(imported, preview(), true);
    useAppStore.getState().markSaved('C:\\projects\\test.tonal');
    expect(useAppStore.getState().dirty).toBe(false);
    useAppStore.getState().setTone({ contrast: 12 });
    expect(useAppStore.getState().dirty).toBe(true);
    useAppStore.getState().undo();
    expect(useAppStore.getState().dirty).toBe(false);
  });
});
