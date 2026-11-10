import { describe, expect, it } from 'vitest';
import { createProject, DEFAULT_GRID } from './defaults';
import {
  ProjectFormatError,
  fingerprintProject,
  migrateProject,
  parseProject,
  serializeProject,
  withUpdatedAt,
} from './project';
import type { TonalProject } from './types';

function sampleProject(): TonalProject {
  const project = createProject(new Date('2026-01-02T03:04:05.000Z'));
  project.source = {
    originalPath: 'C:\\Photos\\portrait.jpg',
    filename: 'portrait.jpg',
    orientedWidth: 1200,
    orientedHeight: 1500,
    alphaBackground: '#FFFFFF',
    format: 'image/jpeg',
    hasAlpha: false,
  };
  project.title = 'Portrait study';
  project.grid = { ...DEFAULT_GRID, columns: 15, rows: 18, labelsEnabled: true };
  project.composition.crop = { x: 0.1, y: 0.05, width: 0.7, height: 0.8 };
  project.tone = { ...project.tone, brightness: 12, shadows: 25, gamma: 1.2 };
  project.study = { enabled: true, levels: 7 };
  project.paper = { unit: 'cm', width: 20, height: 24 };
  return project;
}

describe('project format', () => {
  it('round-trips all settings without loss', () => {
    const project = sampleProject();
    const parsed = parseProject(serializeProject(project));
    expect(parsed.grid.columns).toBe(15);
    expect(parsed.grid.rows).toBe(18);
    expect(parsed.grid.labelsEnabled).toBe(true);
    expect(parsed.composition.crop).toEqual(project.composition.crop);
    expect(parsed.tone.brightness).toBe(12);
    expect(parsed.tone.shadows).toBe(25);
    expect(parsed.study).toEqual({ enabled: true, levels: 7 });
    expect(parsed.paper).toEqual({ unit: 'cm', width: 20, height: 24 });
    expect(parsed.source?.orientedWidth).toBe(1200);
  });

  it('clamps hostile or corrupted numeric values instead of trusting JSON', () => {
    const base = sampleProject();
    const raw = {
      ...base,
      grid: { ...base.grid, columns: 240, rows: -10, opacity: 5, thickness: 99, majorEvery: 17, color: 'not-a-colour' },
      tone: { ...base.tone, gamma: 900, brightness: 400, blackPoint: 250, whitePoint: 12 },
      composition: { ...base.composition, crop: { x: -2, y: 4, width: 4, height: 0 } },
    };
    const parsed = migrateProject(raw);
    expect(parsed.grid.columns).toBe(100);
    expect(parsed.grid.rows).toBe(1);
    expect(parsed.grid.opacity).toBe(1);
    expect(parsed.grid.thickness).toBe(3);
    expect(parsed.grid.majorEvery).toBe(5);
    expect(parsed.grid.color).toBe('#D8B791');
    expect(parsed.tone.gamma).toBe(3);
    expect(parsed.tone.brightness).toBe(100);
    expect(parsed.tone.blackPoint).toBeLessThan(parsed.tone.whitePoint);
    expect(parsed.composition.crop.x).toBeGreaterThanOrEqual(0);
    expect(parsed.composition.crop.y + parsed.composition.crop.height).toBeLessThanOrEqual(1);
    expect(parsed.composition.crop.width).toBeGreaterThan(0);
  });

  it('migrates the legacy schema-0 prototype shape to schema 1', () => {
    const legacy = {
      kind: 'tonal.project',
      schemaVersion: 0,
      title: 'Old project',
      source: { originalPath: '/photos/old.png', filename: 'old.png', orientedWidth: 1000, orientedHeight: 1200 },
      grid: { columns: 8, rows: 9, trueSquareCells: true, opacity: 0.5 },
      composition: { crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.7 } },
      tone: { grayscale: true, brightness: 4 },
      paper: { unit: 'cm', widthCm: 20, heightCm: 25 },
      export: { mode: 'photo', dpi: 150 },
    };
    const parsed = migrateProject(legacy);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.title).toBe('Old project');
    expect(parsed.grid.columns).toBe(8);
    expect(parsed.grid.rows).toBe(9);
    expect(parsed.tone.brightness).toBe(4);
    expect(parsed.paper).toEqual({ unit: 'cm', width: 20, height: 25 });
    expect(parsed.exportDefaults.mode).toBe('photo');
    expect(parsed.exportDefaults.dpi).toBe(150);
    expect(parsed.print.page).toBe('a4');
  });

  it('rejects files that are not TONAL projects', () => {
    expect(() => migrateProject({ hello: 'world' })).toThrow(ProjectFormatError);
    expect(() => parseProject('{ not json')).toThrow(ProjectFormatError);
    expect(() => parseProject('[]')).toThrow(ProjectFormatError);
  });

  it('refuses projects from a newer schema', () => {
    expect(() => migrateProject({ kind: 'tonal.project', schemaVersion: 99 })).toThrow(/newer version/i);
  });

  it('handles projects without a source', () => {
    const parsed = parseProject(serializeProject(createProject()));
    expect(parsed.source).toBeNull();
    expect(parsed.grid.columns).toBe(10);
    expect(parsed.grid.rows).toBe(12);
    expect(parsed.tone.grayscale).toBe(true);
  });

  it('fingerprints ignore timestamps and view-only state so undo can clear dirty', () => {
    const project = sampleProject();
    const fingerprint = fingerprintProject(project);
    const later = withUpdatedAt(project, new Date('2030-01-01T00:00:00.000Z'));
    later.view = { zoom: 2, panX: 30, panY: -10 };
    expect(fingerprintProject(later)).toBe(fingerprint);
    later.tone.contrast = 5;
    expect(fingerprintProject(later)).not.toBe(fingerprint);
  });

  it('rejects unsafe source dimensions rather than creating unusable projects', () => {
    const project = sampleProject();
    project.source = { ...project.source!, orientedWidth: 0 };
    const parsed = parseProject(serializeProject(project));
    expect(parsed.source).toBeNull();
  });
});
