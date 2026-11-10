import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FolderOpen, Grid3x3, Image, Layers } from 'lucide-react';
import { Button } from '../../components/Button';
import { useAppStore } from '../../state/store';
import {
  cancelJob,
  defaultExportDir,
  exportPng,
  onExportProgress,
  pathExists,
  pickSavePath,
  revealInFolder,
} from '../../lib/native';
import {
  computePngSize,
  describeCells,
  percentOfSourceKept,
  suggestedExportFilename,
} from '../../lib/geometry';
import type { ExportMode, ExportProgress, ResolutionMode } from '../../lib/types';
import { errorMessage, joinPath, progressStageLabel, sanitizeFilename, splitPath } from './exportUtils';

interface PngExportFormProps {
  onClose: () => void;
}

const MODES: Array<{
  mode: ExportMode;
  title: string;
  description: string;
  icon: typeof Layers;
}> = [
  {
    mode: 'combined',
    title: 'Photo + drawing grid',
    description: 'The prepared reference with grid and optional coordinate labels.',
    icon: Layers,
  },
  {
    mode: 'photo',
    title: 'Prepared photo only',
    description: 'A clean tonal reference with no grid lines.',
    icon: Image,
  },
  {
    mode: 'grid',
    title: 'Transparent grid only',
    description: 'Only grid strokes and labels on true transparent alpha.',
    icon: Grid3x3,
  },
];

export function PngExportForm({ onClose }: PngExportFormProps) {
  const project = useAppStore((state) => state.project);
  const setExportDefaults = useAppStore((state) => state.setExportDefaults);
  const setBusy = useAppStore((state) => state.setBusy);
  const showToast = useAppStore((state) => state.showToast);
  const source = project.source;

  const initialMode = project.exportDefaults.mode;
  const [mode, setMode] = useState<ExportMode>(initialMode);
  const [filename, setFilename] = useState(
    suggestedExportFilename(source?.filename ?? 'reference', initialMode),
  );
  const [folder, setFolder] = useState(project.exportDefaults.folder);
  const [resolution, setResolution] = useState<ResolutionMode>(project.exportDefaults.resolution);
  const [scale, setScale] = useState(project.exportDefaults.scale || 100);
  const [cellSize, setCellSize] = useState(project.exportDefaults.cellSize || 200);
  const [dpi, setDpi] = useState(project.exportDefaults.dpi || 300);
  const [dpiChoice, setDpiChoice] = useState(
    [72, 150, 300, 600].includes(project.exportDefaults.dpi) ? String(project.exportDefaults.dpi) : 'custom',
  );
  const [includeLabels, setIncludeLabels] = useState(project.grid.labelsEnabled);
  const [includeMirror, setIncludeMirror] = useState(project.composition.mirror);
  const [includeStudy, setIncludeStudy] = useState(
    project.study.enabled ? project.exportDefaults.studyInExport : false,
  );
  const [exporting, setExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState<{ path: string; isPdf: boolean } | null>(null);
  const jobRef = useRef<string | null>(null);

  useEffect(() => {
    if (folder) return;
    let active = true;
    defaultExportDir()
      .then((dir) => {
        if (active && dir) setFolder(dir);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [folder]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onExportProgress((event) => {
      if (event.jobId !== jobRef.current) return;
      setProgress(event);
      setBusy({ label: progressStageLabel(event.stage), progress: event.progress, cancellable: true });
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      unlisten?.();
    };
  }, [setBusy]);

  const size = useMemo(() => {
    if (!source) return null;
    return computePngSize({
      crop: project.composition.crop,
      sourceWidth: source.orientedWidth,
      sourceHeight: source.orientedHeight,
      columns: project.grid.columns,
      rows: project.grid.rows,
      trueSquareCells: project.grid.trueSquareCells,
      resolution,
      scalePercent: scale,
      customCellSize: cellSize,
    });
  }, [
    source,
    project.composition.crop,
    project.grid.columns,
    project.grid.rows,
    project.grid.trueSquareCells,
    resolution,
    scale,
    cellSize,
  ]);

  const currentMode = MODES.find((entry) => entry.mode === mode) ?? MODES[0]!;

  const changeMode = (next: ExportMode) => {
    setMode(next);
    setFilename(suggestedExportFilename(source?.filename ?? 'reference', next));
  };

  const chooseResolution = (next: ResolutionMode) => {
    setResolution(next);
    if (next === 'custom' && size) {
      setCellSize(project.grid.trueSquareCells ? size.nativeCellSize : size.nativeWidth);
    }
  };

  const browse = async () => {
    const picked = await pickSavePath({
      title: 'Export reference PNG',
      defaultName: sanitizeFilename(filename, 'png'),
      filters: [{ name: 'PNG image', extensions: ['png'] }],
      folder,
    });
    if (!picked) return;
    const parts = splitPath(picked);
    setFolder(parts.folder);
    setFilename(parts.filename);
  };

  const runExport = async (outputPath: string) => {
    if (!source?.originalPath || !size) {
      setError('The original photo path is unavailable. Locate the photo before exporting.');
      return;
    }
    if (!size.valid) {
      setError(size.error ?? 'Choose a valid output size.');
      return;
    }
    const jobId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    jobRef.current = jobId;
    setExporting(true);
    setCancelling(false);
    setError(null);
    setOverwrite(null);
    setProgress({ jobId, stage: 'render', progress: 0, message: 'Preparing photo' });
    setBusy({ label: 'Preparing export', progress: 0.01, cancellable: true });
    try {
      const result = await exportPng({
        jobId,
        sourcePath: source.originalPath,
        outputPath,
        mode,
        crop: project.composition.crop,
        columns: project.grid.columns,
        rows: project.grid.rows,
        mirror: includeMirror,
        tone: project.tone,
        study: project.study,
        studyInExport: includeStudy && project.study.enabled,
        grid: project.grid,
        labelsInExport: includeLabels,
        background: source.alphaBackground,
        dpi,
        width: size.width,
        height: size.height,
      });
      setExportDefaults({
        mode,
        dpi,
        studyInExport: includeStudy,
        mirrorInExport: includeMirror,
        labelsInExport: includeLabels,
        resolution,
        scale,
        cellSize,
        folder,
      });
      showToast({
        kind: 'success',
        message: `PNG exported · ${result.width.toLocaleString()} × ${result.height.toLocaleString()} px`,
        actionLabel: 'Show in folder',
        action: () => {
          void revealInFolder(result.path).catch(() => undefined);
        },
      });
      onClose();
    } catch (exportError) {
      const message = errorMessage(exportError);
      if (/cancel/i.test(message)) {
        showToast({ kind: 'notice', message: 'Export cancelled. No finished file was written.' });
        setError(null);
      } else {
        setError(message);
        showToast({ kind: 'error', message });
      }
    } finally {
      setBusy(null);
      setExporting(false);
      setCancelling(false);
      jobRef.current = null;
      setProgress(null);
    }
  };

  const requestExport = async () => {
    if (!size || !size.valid) return;
    const cleanName = sanitizeFilename(filename, 'png');
    setFilename(cleanName);
    if (!folder) {
      setError('Choose a folder for the exported PNG.');
      return;
    }
    const outputPath = joinPath(folder, cleanName);
    const exists = await pathExists(outputPath);
    if (exists) {
      setOverwrite({ path: outputPath, isPdf: false });
      return;
    }
    await runExport(outputPath);
  };

  const cancel = async () => {
    if (!jobRef.current) return;
    setCancelling(true);
    setBusy({ label: 'Cancelling export…', progress: 0, cancellable: false });
    try {
      await cancelJob(jobRef.current);
    } catch {
      // The job may already have finished.
    }
  };

  const cropPercent = percentOfSourceKept(project.composition.crop);
  const warnings: string[] = [];
  if (size?.upscaled) {
    warnings.push('The chosen export size is larger than the original cropped photo. Detail cannot be added by enlarging.');
  }
  if (cropPercent < 99.5) {
    warnings.push(`Square framing keeps ${cropPercent.toFixed(0)}% of the source. Edges outside the crop are not exported.`);
  }
  if (size && !size.squareCells) {
    warnings.push('Cells are rectangular in this framing. Turn on true square cells for equal cell dimensions.');
  }

  return (
    <div className="dialog-form">
      <div className="form-block">
        <div className="form-label">Export mode</div>
        <div className="export-mode-list" role="radiogroup" aria-label="Export mode">
          {MODES.map(({ mode: option, title, description, icon: Icon }) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              className={`export-mode${mode === option ? ' is-active' : ''}`}
              onClick={() => changeMode(option)}
              disabled={exporting}
            >
              <span className="export-mode-radio" aria-hidden="true" />
              <span className="export-mode-text">
                <span className="export-mode-title">{title}</span>
                <span className="export-mode-desc">{description}</span>
              </span>
              <Icon size={17} className="export-mode-icon" />
            </button>
          ))}
        </div>
      </div>

      <div className="form-block">
        <div className="form-label">File</div>
        <div className="file-grid">
          <label>
            <span className="visually-hidden">Filename</span>
            <input
              className="text-input"
              value={filename}
              spellCheck={false}
              disabled={exporting}
              onChange={(event) => setFilename(event.target.value)}
              onBlur={() => setFilename(sanitizeFilename(filename, 'png'))}
              aria-label="Export filename"
            />
          </label>
          <div className="dpi-row" style={{ justifyContent: 'flex-end' }}>
            <span className="badge">PNG</span>
            <span className="badge">Lossless</span>
          </div>
        </div>
        <div className="folder-grid">
          <label>
            <span className="visually-hidden">Folder</span>
            <input
              className="text-input"
              value={folder}
              spellCheck={false}
              disabled={exporting}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="Choose an export folder"
              aria-label="Export folder"
            />
          </label>
          <Button variant="secondary" size="sm" onClick={browse} icon={<FolderOpen size={13} />} disabled={exporting}>
            Browse
          </Button>
        </div>
      </div>

      <div className="form-block">
        <div className="form-label">
          Output size
          <span className="value">
            {size ? `${size.width.toLocaleString()} × ${size.height.toLocaleString()} px` : 'No photo'}
          </span>
        </div>
        <div className="segmented" role="group" aria-label="Output resolution">
          <button
            type="button"
            className={`segmented-option${resolution === 'native' ? ' is-active' : ''}`}
            aria-pressed={resolution === 'native'}
            onClick={() => chooseResolution('native')}
            disabled={exporting}
          >
            Native
          </button>
          <button
            type="button"
            className={`segmented-option${resolution === 'scale' && scale === 50 ? ' is-active' : ''}`}
            aria-pressed={resolution === 'scale' && scale === 50}
            onClick={() => {
              setResolution('scale');
              setScale(50);
            }}
            disabled={exporting}
          >
            50%
          </button>
          <button
            type="button"
            className={`segmented-option${resolution === 'scale' && scale === 200 ? ' is-active' : ''}`}
            aria-pressed={resolution === 'scale' && scale === 200}
            onClick={() => {
              setResolution('scale');
              setScale(200);
            }}
            disabled={exporting}
          >
            200%
          </button>
          <button
            type="button"
            className={`segmented-option${resolution === 'custom' ? ' is-active' : ''}`}
            aria-pressed={resolution === 'custom'}
            onClick={() => chooseResolution('custom')}
            disabled={exporting}
          >
            Custom
          </button>
        </div>

        {resolution === 'custom' ? (
          <div className="mini-field" style={{ maxWidth: 230 }}>
            <span className="field-label">
              {project.grid.trueSquareCells ? 'Cell size (integer pixels)' : 'Output width (pixels)'}
            </span>
            <div className="stepper">
              <input
                className="stepper-input"
                inputMode="numeric"
                value={cellSize}
                disabled={exporting}
                onChange={(event) => setCellSize(Math.max(1, Math.round(Number(event.target.value) || 1)))}
                aria-label={project.grid.trueSquareCells ? 'Cell size in pixels' : 'Output width in pixels'}
              />
              <span className="stepper-suffix">px</span>
            </div>
          </div>
        ) : null}

        <div className="export-size-card">
          <div className="size-stat">
            <span className="stat-label">Final pixels</span>
            <span className="stat-value">
              {size ? `${size.width.toLocaleString()} × ${size.height.toLocaleString()}` : '—'}
            </span>
            <span className="stat-sub">
              {size
                ? describeCells(size.width, project.grid.columns, size.height, project.grid.rows)
                : 'Open a photo'}
            </span>
          </div>
          <div className="size-stat">
            <span className="stat-label">Grid</span>
            <span className="stat-value">
              {project.grid.columns} × {project.grid.rows}
            </span>
            <span className="stat-sub">
              {project.grid.trueSquareCells
                ? size
                  ? `${size.cellSize} px cells`
                  : 'true square'
                : 'rectangular cells'}
            </span>
          </div>
        </div>
        {size && !size.valid ? (
          <div className="inline-status error" role="alert">
            <AlertTriangle size={13} />
            {size.error}
          </div>
        ) : null}
      </div>

      <div className="form-block">
        <div className="form-label">Included in file</div>
        <div className="option-grid">
          <label className="check-row">
            <input
              type="checkbox"
              checked={includeLabels}
              onChange={(event) => setIncludeLabels(event.target.checked)}
              disabled={exporting || mode === 'photo'}
            />
            Grid coordinate labels
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={includeMirror}
              onChange={(event) => setIncludeMirror(event.target.checked)}
              disabled={exporting}
            />
            Mirror, as reviewed
          </label>
          <label className={`check-row${!project.study.enabled ? ' is-disabled' : ''}`}>
            <input
              type="checkbox"
              checked={includeStudy && project.study.enabled}
              onChange={(event) => setIncludeStudy(event.target.checked)}
              disabled={exporting || !project.study.enabled}
            />
            Simplified value study
          </label>
          <div className="check-row" style={{ cursor: 'default' }}>
            <span className="mono" style={{ fontSize: 10 }}>
              {mode === 'grid' ? 'RGBA · transparent' : 'RGBA · ' + (source?.alphaBackground ?? '#FFFFFF')}
            </span>
          </div>
        </div>
      </div>

      <div className="form-block">
        <div className="form-label">DPI metadata</div>
        <div className="dpi-row">
          <select
            className="select-input"
            value={dpiChoice}
            onChange={(event) => {
              const value = event.target.value;
              setDpiChoice(value);
              if (value !== 'custom') setDpi(Number(value));
            }}
            disabled={exporting}
            aria-label="Output DPI"
          >
            <option value="72">72 DPI</option>
            <option value="150">150 DPI</option>
            <option value="300">300 DPI</option>
            <option value="600">600 DPI</option>
            <option value="custom">Custom</option>
          </select>
          {dpiChoice === 'custom' ? (
            <input
              className="text-input"
              inputMode="numeric"
              style={{ width: 92 }}
              value={dpi}
              onChange={(event) => setDpi(Math.min(1200, Math.max(1, Math.round(Number(event.target.value) || 1))))}
              aria-label="Custom DPI"
              disabled={exporting}
            />
          ) : null}
          <span className="dpi-note">Written to PNG metadata. DPI does not add image detail.</span>
        </div>
      </div>

      <div className="export-summary-panel">
        <div className="summary-row">
          <span>File</span>
          <strong>
            {folder ? joinPath(folder, sanitizeFilename(filename, 'png')) : sanitizeFilename(filename, 'png')}
          </strong>
        </div>
        <div className="summary-row">
          <span>Content</span>
          <strong>
            {currentMode.title} · {includeLabels ? 'labels on' : 'no labels'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Crop</span>
          <strong>
            {Math.round(project.composition.crop.width * 100)}% ×{' '}
            {Math.round(project.composition.crop.height * 100)}% of source
          </strong>
        </div>
      </div>

      {warnings.length ? (
        <div className="export-warnings">
          {warnings.map((warning) => (
            <div className="inline-status warning" key={warning}>
              <span className="status-dot" />
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      {overwrite ? (
        <div className="overwrite-panel">
          <AlertTriangle size={15} />
          <span>A file with this name already exists. Replace it or choose another name.</span>
          <div className="actions">
            <Button variant="ghost" size="sm" onClick={() => setOverwrite(null)}>
              Cancel
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void runExport(overwrite.path)}>
              Replace
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="inline-status error" role="alert">
          <AlertTriangle size={13} />
          {error}
        </div>
      ) : null}

      {progress ? (
        <div className="export-progress" role="status" aria-live="polite">
          <div className="progress-head">
            <span>{progressStageLabel(progress.stage)}</span>
            <span className="stage-label">{Math.round(progress.progress * 100)}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.max(2, progress.progress * 100)}%` }} />
          </div>
          <div className="progress-meta">
            <span>{project.grid.columns} × {project.grid.rows} grid · native Rust renderer</span>
            <span>{Math.round((progress.progress || 0) * 100)}%</span>
          </div>
        </div>
      ) : null}

      <div className="dialog-actions">
        {exporting ? (
          <Button variant="ghost" onClick={() => void cancel()} disabled={cancelling}>
            {cancelling ? 'Cancelling…' : 'Cancel export'}
          </Button>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          onClick={() => void requestExport()}
          disabled={exporting || !source || !size?.valid}
          icon={<Download size={15} />}
        >
          {exporting ? 'Exporting…' : 'Export PNG'}
        </Button>
      </div>

      <p className="info-note" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <CheckCircle2 size={12} /> Atomic write · no watermark · source photo remains untouched.
      </p>
    </div>
  );
}

