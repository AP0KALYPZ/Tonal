import { create } from 'zustand';
import {
  createProject,
  NEUTRAL_TONE,
} from '../lib/defaults';
import {
  calculateSquareCrop,
  centerCropOn,
  clamp,
  clampCrop,
  cropCenter,
  fullCrop,
  recomputeSquareCrop,
} from '../lib/geometry';
import {
  fingerprintProject,
  normalizeSource,
  withUpdatedAt,
} from '../lib/project';
import type { TonePreset } from '../lib/presets';
import type { Histogram } from '../lib/tone';
import type {
  CropRect,
  ExportDefaults,
  GridSettings,
  ImportedSource,
  PaperSettings,
  PrintSettings,
  SourceRef,
  StudySettings,
  ToneSettings,
  TonalProject,
} from '../lib/types';
import { sanitizeTone } from '../lib/tone';

export interface SourcePreview {
  dataUrl: string;
  proxyWidth: number;
  proxyHeight: number;
  warning: string[];
}

export type SourceStatus = 'empty' | 'loading' | 'ready' | 'missing' | 'error';
export type CompareMode = 'off' | 'locked' | 'held';
export type ModalKind = 'export' | 'shortcuts' | 'missing-source' | 'close-confirm' | null;

export interface ToastMessage {
  id: number;
  kind: 'success' | 'notice' | 'error';
  message: string;
  actionLabel?: string;
  action?: () => void;
}

export interface BusyState {
  label: string;
  progress: number;
  cancellable: boolean;
}

export interface LoupeSample {
  x: number;
  y: number;
  tone: number;
  original: number;
  sourceX: number;
  sourceY: number;
}

interface ProjectHistory {
  past: TonalProject[];
  future: TonalProject[];
  gestureBase: TonalProject | null;
  gestureChanged: boolean;
}

export interface AppState extends ProjectHistory {
  project: TonalProject;
  projectPath: string | null;
  savedFingerprint: string | null;
  dirty: boolean;
  sourcePreview: SourcePreview | null;
  sourceStatus: SourceStatus;
  sourceError: string | null;
  zoom: number;
  zoomMode: 'fit' | 'custom';
  panX: number;
  panY: number;
  compareMode: CompareMode;
  loupeEnabled: boolean;
  spaceHeld: boolean;
  modal: ModalKind;
  toast: ToastMessage | null;
  busy: BusyState | null;
  previewHistogram: Histogram | null;
  previewProcessing: boolean;
  loupeSample: LoupeSample | null;

  newProject: () => void;
  replaceProject: (project: TonalProject, path: string | null, saved: boolean) => void;
  setProjectPath: (path: string | null) => void;
  markSaved: (path?: string | null) => void;
  commitSavedProject: (project: TonalProject, path: string) => void;
  relinkSource: (source: ImportedSource) => void;

  setSource: (source: ImportedSource, preview: SourcePreview, replaceTitle: boolean) => void;
  setSourcePreview: (preview: SourcePreview | null) => void;
  setSourceStatus: (status: SourceStatus, error?: string | null) => void;
  setSourceRef: (source: SourceRef | null) => void;

  setTitle: (title: string) => void;
  setGrid: (patch: Partial<GridSettings>) => void;
  setTone: (patch: Partial<ToneSettings>) => void;
  setStudy: (patch: Partial<StudySettings>) => void;
  setPaper: (patch: Partial<PaperSettings>) => void;
  setPrint: (patch: Partial<PrintSettings>) => void;
  setExportDefaults: (patch: Partial<ExportDefaults>) => void;
  setCrop: (crop: CropRect) => void;
  setMirror: (mirror: boolean) => void;
  applyPreset: (preset: TonePreset) => void;
  resetToneGroup: (group: 'basic' | 'range' | 'all') => void;
  centerCrop: () => void;
  fitSource: () => void;

  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;

  setZoom: (zoom: number, mode?: 'fit' | 'custom') => void;
  fitToView: () => void;
  actualPixels: () => void;
  zoomBy: (factor: number) => void;
  setPan: (x: number, y: number) => void;
  nudgePan: (dx: number, dy: number) => void;
  resetView: () => void;
  setCompareMode: (mode: CompareMode) => void;
  setLoupeEnabled: (enabled: boolean) => void;
  setSpaceHeld: (held: boolean) => void;
  setModal: (modal: ModalKind) => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: () => void;
  setBusy: (busy: BusyState | null) => void;
  setPreviewHistogram: (histogram: Histogram | null) => void;
  setPreviewProcessing: (processing: boolean) => void;
  setLoupeSample: (sample: LoupeSample | null) => void;
}

const HISTORY_LIMIT = 120;

function sourceToRef(source: ImportedSource): SourceRef {
  return {
    originalPath: source.path,
    filename: source.filename,
    checksumSha256: source.checksumSha256,
    orientedWidth: source.orientedWidth,
    orientedHeight: source.orientedHeight,
    alphaBackground: '#FFFFFF',
    format: source.format,
    hasAlpha: source.hasAlpha,
  };
}

function initialCrop(project: TonalProject, source: SourceRef): CropRect {
  if (!project.grid.trueSquareCells) return fullCrop();
  return calculateSquareCrop(
    source.orientedWidth,
    source.orientedHeight,
    project.grid.columns,
    project.grid.rows,
  );
}

function projectChanged(a: TonalProject, b: TonalProject): boolean {
  return fingerprintProject(a) !== fingerprintProject(b);
}

export const useAppStore = create<AppState>((set, get) => {
  const mutateProject = (
    updater: (project: TonalProject) => TonalProject,
    options: { history?: boolean; touch?: boolean } = {},
  ) => {
    const state = get();
    const candidate = updater(state.project);
    const next =
      options.touch === false ? candidate : withUpdatedAt(candidate, new Date());
    if (!projectChanged(state.project, next)) return;

    let past = state.past;
    let future = state.future;
    let gestureChanged = state.gestureChanged;

    if (options.history !== false) {
      if (state.gestureBase) {
        gestureChanged = true;
      } else {
        past = [...state.past, state.project].slice(-HISTORY_LIMIT);
        future = [];
      }
    }

    set({
      project: next,
      past,
      future,
      gestureChanged,
      dirty: state.savedFingerprint
        ? fingerprintProject(next) !== state.savedFingerprint
        : next.source !== null,
    });
  };

  return {
    project: createProject(),
    projectPath: null,
    savedFingerprint: null,
    dirty: false,
    sourcePreview: null,
    sourceStatus: 'empty',
    sourceError: null,
    past: [],
    future: [],
    gestureBase: null,
    gestureChanged: false,
    zoom: 1,
    zoomMode: 'fit',
    panX: 0,
    panY: 0,
    compareMode: 'off',
    loupeEnabled: false,
    spaceHeld: false,
    modal: null,
    toast: null,
    busy: null,
    previewHistogram: null,
    previewProcessing: false,
    loupeSample: null,

    newProject: () =>
      set({
        project: createProject(),
        projectPath: null,
        savedFingerprint: null,
        dirty: false,
        sourcePreview: null,
        sourceStatus: 'empty',
        sourceError: null,
        past: [],
        future: [],
        gestureBase: null,
        gestureChanged: false,
        zoom: 1,
        zoomMode: 'fit',
        panX: 0,
        panY: 0,
        compareMode: 'off',
        loupeEnabled: false,
        modal: null,
        previewHistogram: null,
        previewProcessing: false,
        loupeSample: null,
      }),

    replaceProject: (project, path, saved) =>
      set({
        project,
        projectPath: path,
        savedFingerprint: saved ? fingerprintProject(project) : null,
        dirty: saved ? false : project.source !== null,
        past: [],
        future: [],
        gestureBase: null,
        gestureChanged: false,
        sourceStatus: project.source && saved ? 'loading' : 'empty',
        sourceError: null,
        sourcePreview: null,
        zoom: project.view?.zoom === 'fit' ? 1 : (project.view?.zoom ?? 1),
        zoomMode: project.view?.zoom === 'fit' ? 'fit' : project.view ? 'custom' : 'fit',
        panX: project.view?.panX ?? 0,
        panY: project.view?.panY ?? 0,
        compareMode: 'off',
        modal: null,
        previewHistogram: null,
        previewProcessing: false,
        loupeSample: null,
      }),

    setProjectPath: (path) => set({ projectPath: path }),

    markSaved: (path) => {
      const state = get();
      const nextPath = path === undefined ? state.projectPath : path;
      set({
        projectPath: nextPath,
        savedFingerprint: fingerprintProject(state.project),
        dirty: false,
      });
    },

    commitSavedProject: (project, path) =>
      set({
        project,
        projectPath: path,
        savedFingerprint: fingerprintProject(project),
        dirty: false,
      }),

    relinkSource: (imported) =>
      mutateProject((project) => {
        const ref = sourceToRef(imported);
        const previous = project.source;
        let crop = project.composition.crop;
        if (project.grid.trueSquareCells && previous) {
          crop = calculateSquareCrop(
            imported.orientedWidth,
            imported.orientedHeight,
            project.grid.columns,
            project.grid.rows,
            cropCenter(crop),
          );
        }
        return {
          ...project,
          source: {
            ...ref,
            alphaBackground: previous?.alphaBackground ?? ref.alphaBackground,
            relativePath: previous?.relativePath,
          },
          composition: { ...project.composition, crop: clampCrop(crop) },
        };
      }),

    setSource: (source, preview, replaceTitle) => {
      const state = get();
      const ref = sourceToRef(source);
      const crop = initialCrop(state.project, ref);
      const next: TonalProject = withUpdatedAt(
        {
          ...state.project,
          title: replaceTitle ? source.filename.replace(/\.[^.]+$/, '') : state.project.title,
          source: ref,
          composition: { ...state.project.composition, crop },
        },
        new Date(),
      );
      set({
        project: next,
        sourcePreview: preview,
        sourceStatus: 'ready',
        sourceError: null,
        past: [],
        future: [],
        gestureBase: null,
        gestureChanged: false,
        dirty: true,
        zoom: 1,
        zoomMode: 'fit',
        panX: 0,
        panY: 0,
        previewHistogram: null,
        previewProcessing: false,
        loupeSample: null,
      });
    },

    setSourcePreview: (preview) => set({ sourcePreview: preview }),
    setSourceStatus: (status, error = null) => set({ sourceStatus: status, sourceError: error }),
    setSourceRef: (source) => mutateProject((project) => ({ ...project, source })),

    setTitle: (title) => mutateProject((project) => ({ ...project, title: title.slice(0, 160) })),

    setGrid: (patch) =>
      mutateProject((project) => {
        const nextGrid: GridSettings = { ...project.grid, ...patch };
        let crop = project.composition.crop;
        const source = project.source;

        const dimensionChanged =
          (patch.columns !== undefined && patch.columns !== project.grid.columns) ||
          (patch.rows !== undefined && patch.rows !== project.grid.rows);
        const squareTurnedOn = patch.trueSquareCells === true && !project.grid.trueSquareCells;

        if (source && nextGrid.trueSquareCells && (dimensionChanged || squareTurnedOn)) {
          crop = recomputeSquareCrop(
            crop,
            source.orientedWidth,
            source.orientedHeight,
            nextGrid.columns,
            nextGrid.rows,
          );
        }
        if (!nextGrid.trueSquareCells) {
          crop = clampCrop(crop);
        }
        return {
          ...project,
          grid: nextGrid,
          composition: { ...project.composition, crop },
        };
      }),

    setTone: (patch) =>
      mutateProject((project) => ({
        ...project,
        tone: sanitizeTone({ ...project.tone, ...patch }),
      })),

    setStudy: (patch) =>
      mutateProject((project) => ({
        ...project,
        study: {
          ...project.study,
          ...patch,
          levels: Math.round(clamp(patch.levels ?? project.study.levels, 3, 9)),
        },
      })),

    setPaper: (patch) =>
      mutateProject((project) => ({
        ...project,
        paper: {
          ...project.paper,
          ...patch,
          width: clamp(patch.width ?? project.paper.width, 0.1, 1000),
          height: clamp(patch.height ?? project.paper.height, 0.1, 1000),
        },
      })),

    setPrint: (patch) =>
      mutateProject((project) => ({ ...project, print: { ...project.print, ...patch } })),

    setExportDefaults: (patch) =>
      mutateProject((project) => ({
        ...project,
        exportDefaults: { ...project.exportDefaults, ...patch },
      })),

    setCrop: (crop) =>
      mutateProject((project) => ({
        ...project,
        composition: { ...project.composition, crop: clampCrop(crop) },
      })),

    setMirror: (mirror) =>
      mutateProject((project) => ({
        ...project,
        composition: { ...project.composition, mirror },
      })),

    applyPreset: (preset) =>
      mutateProject((project) => ({
        ...project,
        tone: sanitizeTone({ ...preset.tone }),
        study: { ...preset.study },
      })),

    resetToneGroup: (group) =>
      mutateProject((project) => {
        if (group === 'all') {
          return {
            ...project,
            tone: { ...NEUTRAL_TONE },
            study: { ...project.study, enabled: false },
          };
        }
        if (group === 'basic') {
          return {
            ...project,
            tone: {
              ...project.tone,
              brightness: 0,
              contrast: 0,
              gamma: 1,
            },
          };
        }
        return {
          ...project,
          tone: {
            ...project.tone,
            shadows: 0,
            highlights: 0,
            blackPoint: 0,
            whitePoint: 255,
          },
        };
      }),

    centerCrop: () => {
      const { project } = get();
      if (!project.source) return;
      mutateProject((current) => {
        let crop = current.composition.crop;
        if (current.grid.trueSquareCells) {
          crop = calculateSquareCrop(
            current.source?.orientedWidth ?? 1,
            current.source?.orientedHeight ?? 1,
            current.grid.columns,
            current.grid.rows,
          );
        } else {
          crop = centerCropOn(crop, { x: 0.5, y: 0.5 });
        }
        return { ...current, composition: { ...current.composition, crop } };
      });
    },

    fitSource: () => {
      const { project } = get();
      if (!project.source) return;
      mutateProject((current) => {
        const crop = current.grid.trueSquareCells
          ? calculateSquareCrop(
              current.source?.orientedWidth ?? 1,
              current.source?.orientedHeight ?? 1,
              current.grid.columns,
              current.grid.rows,
            )
          : fullCrop();
        return { ...current, composition: { ...current.composition, crop } };
      });
    },

    beginGesture: () => {
      const state = get();
      if (state.gestureBase) return;
      set({ gestureBase: state.project, gestureChanged: false });
    },

    endGesture: () => {
      const state = get();
      if (!state.gestureBase) return;
      if (state.gestureChanged) {
        set({
          past: [...state.past, state.gestureBase].slice(-HISTORY_LIMIT),
          future: [],
          gestureBase: null,
          gestureChanged: false,
        });
      } else {
        set({ gestureBase: null, gestureChanged: false });
      }
    },

    undo: () => {
      const state = get();
      if (state.gestureBase) {
        get().endGesture();
        return;
      }
      const previous = state.past[state.past.length - 1];
      if (!previous) return;
      set({
        project: previous,
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
        dirty: state.savedFingerprint
          ? fingerprintProject(previous) !== state.savedFingerprint
          : previous.source !== null,
      });
    },

    redo: () => {
      const state = get();
      const next = state.future[0];
      if (!next) return;
      set({
        project: next,
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        dirty: state.savedFingerprint
          ? fingerprintProject(next) !== state.savedFingerprint
          : next.source !== null,
      });
    },

    setZoom: (zoom, mode = 'custom') =>
      set({ zoom: clamp(zoom, 0.05, 32), zoomMode: mode }),
    fitToView: () => set({ zoomMode: 'fit', panX: 0, panY: 0 }),
    actualPixels: () => set({ zoom: 1, zoomMode: 'custom', panX: 0, panY: 0 }),
    zoomBy: (factor) =>
      set((state) => ({
        zoom: clamp((state.zoomMode === 'fit' ? 1 : state.zoom) * factor, 0.05, 32),
        zoomMode: 'custom',
      })),
    setPan: (x, y) => set({ panX: x, panY: y }),
    nudgePan: (dx, dy) => set((state) => ({ panX: state.panX + dx, panY: state.panY + dy })),
    resetView: () => set({ zoom: 1, zoomMode: 'fit', panX: 0, panY: 0 }),
    setCompareMode: (mode) => set({ compareMode: mode }),
    setLoupeEnabled: (enabled) => set({ loupeEnabled: enabled }),
    setSpaceHeld: (held) => set({ spaceHeld: held }),
    setModal: (modal) => set({ modal }),
    showToast: (toast) => set({ toast: { ...toast, id: Date.now() + Math.random() } }),
    dismissToast: () => set({ toast: null }),
    setBusy: (busy) => set({ busy }),
    setPreviewHistogram: (histogram) => set({ previewHistogram: histogram }),
    setPreviewProcessing: (processing) => set({ previewProcessing: processing }),
    setLoupeSample: (sample) => set({ loupeSample: sample }),
  };
});

export function activeCropCenter(project: TonalProject): { x: number; y: number } {
  return cropCenter(project.composition.crop);
}

export function currentSource(project: TonalProject): SourceRef | null {
  return normalizeSource(project.source);
}

