import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, FolderOpen, Printer } from 'lucide-react';
import { Button } from '../../components/Button';
import { useAppStore } from '../../state/store';
import {
  cancelJob,
  defaultExportDir,
  exportPdf,
  onExportProgress,
  pathExists,
  pickSavePath,
  revealInFolder,
} from '../../lib/native';
import {
  computePrintLayout,
  formatLength,
  mmToUnit,
  printWarnings,
  suggestDrawingArea,
  unitToMm,
} from '../../lib/paper';
import { suggestedExportFilename } from '../../lib/geometry';
import type { ExportProgress, Orientation, PaperUnit, PrintPagePreset } from '../../lib/types';
import { errorMessage, joinPath, progressStageLabel, sanitizeFilename, splitPath } from './exportUtils';

interface PdfExportFormProps {
  onClose: () => void;
}

export function PdfExportForm({ onClose }: PdfExportFormProps) {
  const project = useAppStore((state) => state.project);
  const setPaper = useAppStore((state) => state.setPaper);
  const setPrint = useAppStore((state) => state.setPrint);
  const setExportDefaults = useAppStore((state) => state.setExportDefaults);
  const setBusy = useAppStore((state) => state.setBusy);
  const showToast = useAppStore((state) => state.showToast);
  const source = project.source;
  const paper = project.paper;
  const print = project.print;

  const [filename, setFilename] = useState(
    suggestedExportFilename(source?.filename ?? 'reference', 'combined').replace(/\.png$/i, '.pdf'),
  );
  const [folder, setFolder] = useState(project.exportDefaults.folder);
  const [includeLabels, setIncludeLabels] = useState(project.grid.labelsEnabled);
  const [includeMirror, setIncludeMirror] = useState(project.composition.mirror);
  const [includeStudy, setIncludeStudy] = useState(
    project.study.enabled ? project.exportDefaults.studyInExport : false,
  );
  const [customScale, setCustomScale] = useState(100);
  const [scaleChoice, setScaleChoice] = useState(String(print.scalePercent));
  const [exporting, setExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState<string | null>(null);
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

  const layout = useMemo(() => {
    return computePrintLayout({
      paper,
      print,
      crop: project.composition.crop,
      sourceWidth: source?.orientedWidth ?? 1,
      sourceHeight: source?.orientedHeight ?? 1,
      columns: project.grid.columns,
      rows: project.grid.rows,
    });
  }, [paper, print, project.composition.crop, source, project.grid.columns, project.grid.rows]);

  const warnings = printWarnings(layout, project.grid.trueSquareCells);
  const suggestion = suggestDrawingArea(paper, project.grid.columns, project.grid.rows);
  const huge = layout.printedPixelWidth * layout.printedPixelHeight > 120_000_000;

  const browse = async () => {
    const picked = await pickSavePath({
      title: 'Export print-ready PDF',
      defaultName: sanitizeFilename(filename, 'pdf'),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
      folder,
    });
    if (!picked) return;
    const parts = splitPath(picked);
    setFolder(parts.folder);
    setFilename(parts.filename);
  };

  const changeUnit = (unit: PaperUnit) => {
    const widthMm = unitToMm(paper.width, paper.unit);
    const heightMm = unitToMm(paper.height, paper.unit);
    setPaper({
      unit,
      width: Math.round(mmToUnit(widthMm, unit) * 100) / 100,
      height: Math.round(mmToUnit(heightMm, unit) * 100) / 100,
    });
  };

  const runExport = async (outputPath: string) => {
    const current = useAppStore.getState().project;
    if (!current.source?.originalPath) {
      setError('The original photo path is unavailable. Locate the photo before exporting.');
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
    setProgress({ jobId, stage: 'render', progress: 0, message: 'Preparing print reference' });
    setBusy({ label: 'Preparing print PDF', progress: 0.01, cancellable: true });
    try {
      const result = await exportPdf({
        jobId,
        sourcePath: current.source.originalPath,
        outputPath,
        crop: current.composition.crop,
        columns: current.grid.columns,
        rows: current.grid.rows,
        mirror: includeMirror,
        tone: current.tone,
        study: current.study,
        studyInExport: includeStudy && current.study.enabled,
        grid: current.grid,
        labelsInExport: includeLabels,
        background: current.source.alphaBackground,
        dpi: current.print.dpi,
        paper: current.paper,
        print: current.print,
      });
      setExportDefaults({
        mode: 'combined',
        studyInExport: includeStudy,
        mirrorInExport: includeMirror,
        labelsInExport: includeLabels,
        folder,
      });
      showToast({
        kind: 'success',
        message: `Print PDF exported · ${result.pages ?? layout.pages} page${(result.pages ?? layout.pages) === 1 ? '' : 's'}`,
        actionLabel: 'Show in folder',
        action: () => {
          void revealInFolder(result.path).catch(() => undefined);
        },
      });
      onClose();
    } catch (exportError) {
      const message = errorMessage(exportError);
      if (/cancel/i.test(message)) {
        showToast({ kind: 'notice', message: 'Export cancelled. No finished PDF was written.' });
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
    const cleanName = sanitizeFilename(filename, 'pdf');
    setFilename(cleanName);
    if (!folder) {
      setError('Choose a folder for the exported PDF.');
      return;
    }
    const outputPath = joinPath(folder, cleanName);
    if (await pathExists(outputPath)) {
      setOverwrite(outputPath);
      return;
    }
    await runExport(outputPath);
  };

  const cancel = async () => {
    if (!jobRef.current) return;
    setCancelling(true);
    setBusy({ label: 'Cancelling print export…', progress: 0, cancellable: false });
    try {
      await cancelJob(jobRef.current);
    } catch {
      // The job may already have finished.
    }
  };

  return (
    <div className="dialog-form">
      <div className="form-block">
        <div className="form-label">
          Drawing area
          <button
            type="button"
            className="subgroup-reset"
            style={{ textTransform: 'none', letterSpacing: 0 }}
            onClick={() => setPaper({ width: suggestion.width, height: suggestion.height })}
          >
            Match grid ratio
          </button>
        </div>
        <div className="paper-inline-grid">
          <input
            className="text-input"
            inputMode="decimal"
            value={paper.width}
            aria-label="Drawing area width"
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) setPaper({ width: Math.max(0.1, value) });
            }}
          />
          <input
            className="text-input"
            inputMode="decimal"
            value={paper.height}
            aria-label="Drawing area height"
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) setPaper({ height: Math.max(0.1, value) });
            }}
          />
          <select
            className="select-input"
            value={paper.unit}
            aria-label="Paper unit"
            onChange={(event) => changeUnit(event.target.value as PaperUnit)}
          >
            <option value="cm">cm</option>
            <option value="mm">mm</option>
            <option value="in">in</option>
          </select>
        </div>
        <p className="info-note">
          Physical cells print at {formatLength(layout.cellWmm, paper.unit)} ×{' '}
          {formatLength(layout.cellHmm, paper.unit)} with {project.grid.columns} × {project.grid.rows} grid at{' '}
          {Math.round(layout.scale * 100)}%.
        </p>
      </div>

      <div className="form-block">
        <div className="form-label">Page</div>
        <div className="mini-select-row">
          <label className="mini-field">
            <span className="field-label">Page size</span>
            <select
              className="select-input"
              value={print.page}
              onChange={(event) => setPrint({ page: event.target.value as PrintPagePreset })}
            >
              <option value="a4">A4 · 210 × 297 mm</option>
              <option value="letter">Letter · 8.5 × 11 in</option>
              <option value="a3">A3 · 297 × 420 mm</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="mini-field">
            <span className="field-label">Orientation</span>
            <select
              className="select-input"
              value={print.orientation}
              onChange={(event) => setPrint({ orientation: event.target.value as Orientation })}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
        </div>
        {print.page === 'custom' ? (
          <div className="paper-inline-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="mini-field">
              <span className="field-label">Page width (mm)</span>
              <input
                className="text-input"
                inputMode="decimal"
                value={print.customWidthMm}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) setPrint({ customWidthMm: Math.max(50, value) });
                }}
              />
            </label>
            <label className="mini-field">
              <span className="field-label">Page height (mm)</span>
              <input
                className="text-input"
                inputMode="decimal"
                value={print.customHeightMm}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) setPrint({ customHeightMm: Math.max(50, value) });
                }}
              />
            </label>
          </div>
        ) : null}

        <div className="paper-inline-grid">
          <label className="mini-field">
            <span className="field-label">Margin (mm)</span>
            <input
              className="text-input"
              inputMode="decimal"
              value={print.marginMm}
              onChange={(event) => setPrint({ marginMm: Math.min(40, Math.max(0, Number(event.target.value) || 0)) })}
            />
          </label>
          <label className="mini-field">
            <span className="field-label">Tile overlap (mm)</span>
            <input
              className="text-input"
              inputMode="decimal"
              value={print.overlapMm}
              onChange={(event) => setPrint({ overlapMm: Math.min(50, Math.max(0, Number(event.target.value) || 0)) })}
            />
          </label>
          <label className="mini-field">
            <span className="field-label">Print scale</span>
            <select
              className="select-input"
              value={scaleChoice}
              onChange={(event) => {
                const value = event.target.value;
                setScaleChoice(value);
                if (value === 'custom') setPrint({ scalePercent: customScale });
                else setPrint({ scalePercent: Number(value) });
              }}
            >
              <option value="100">100% actual</option>
              <option value="75">75%</option>
              <option value="50">50%</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>
        {scaleChoice === 'custom' ? (
          <div className="dpi-row">
            <input
              className="text-input"
              style={{ width: 90 }}
              inputMode="numeric"
              value={customScale}
              aria-label="Custom print scale percent"
              onChange={(event) => {
                const value = Math.min(1000, Math.max(10, Math.round(Number(event.target.value) || 100)));
                setCustomScale(value);
                setPrint({ scalePercent: value });
              }}
            />
            <span className="dpi-note">% of actual size. 100% is required for ruler-accurate cells.</span>
          </div>
        ) : null}
      </div>

      <div className="pdf-preview-summary">
        <div className="size-stat">
          <span className="stat-label">Pages</span>
          <span className="stat-value">{layout.pages}</span>
          <span className="stat-sub">
            {layout.tilesX} × {layout.tilesY} tiles
          </span>
        </div>
        <div className="size-stat">
          <span className="stat-label">Printed frame</span>
          <span className="stat-value">
            {mmToUnit(layout.frameWmm, paper.unit).toFixed(1)} ×{' '}
            {mmToUnit(layout.frameHmm, paper.unit).toFixed(1)} {paper.unit}
          </span>
          <span className="stat-sub">{layout.pagePresetLabel} · {Math.round(layout.scale * 100)}%</span>
        </div>
        <div className="size-stat">
          <span className="stat-label">Print resolution</span>
          <span className="stat-value">{print.dpi} DPI</span>
          <span className="stat-sub">
            {layout.printedPixelWidth.toLocaleString()} × {layout.printedPixelHeight.toLocaleString()} px
          </span>
        </div>
      </div>

      <div className="form-block">
        <div className="form-label">Print reference</div>
        <div className="option-grid">
          <label className="check-row">
            <input
              type="checkbox"
              checked={includeLabels}
              onChange={(event) => setIncludeLabels(event.target.checked)}
              disabled={exporting}
            />
            Coordinate labels
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
          <label className="check-row">
            <input
              type="checkbox"
              checked={print.dpi >= 300}
              onChange={(event) => setPrint({ dpi: event.target.checked ? 300 : 150 })}
              disabled={exporting}
            />
            High-detail 300 DPI
          </label>
        </div>
      </div>

      <div className="form-block">
        <div className="form-label">File</div>
        <div className="folder-grid">
          <label>
            <span className="visually-hidden">PDF filename</span>
            <input
              className="text-input"
              value={filename}
              spellCheck={false}
              disabled={exporting}
              onChange={(event) => setFilename(event.target.value)}
              onBlur={() => setFilename(sanitizeFilename(filename, 'pdf'))}
              aria-label="PDF filename"
            />
          </label>
          <Button variant="secondary" size="sm" onClick={browse} icon={<FolderOpen size={13} />} disabled={exporting}>
            Browse
          </Button>
        </div>
        <div className="folder-grid">
          <label>
            <span className="visually-hidden">PDF folder</span>
            <input
              className="text-input"
              value={folder}
              spellCheck={false}
              disabled={exporting}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="Choose an export folder"
              aria-label="PDF export folder"
            />
          </label>
          <span />
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
      ) : (
        <div className="inline-status success">
          <span className="status-dot" />
          Square cells verified at {Math.round(layout.scale * 100)}% print scale.
        </div>
      )}

      {layout.areaRatioMismatch && project.grid.trueSquareCells ? (
        <div className="inline-status">
          <span className="status-dot" />
          To fill the whole area with square cells, use {suggestion.width} × {suggestion.height} {paper.unit}.
        </div>
      ) : null}

      {huge ? (
        <div className="inline-status warning">
          <span className="status-dot" />
          This print is very large ({layout.printedPixelWidth.toLocaleString()} ×{' '}
          {layout.printedPixelHeight.toLocaleString()} px). Rendering may take a while; you can cancel.
        </div>
      ) : null}

      {overwrite ? (
        <div className="overwrite-panel">
          <AlertTriangle size={15} />
          <span>A PDF with this name already exists. Replace it or choose another name.</span>
          <div className="actions">
            <Button variant="ghost" size="sm" onClick={() => setOverwrite(null)}>
              Cancel
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void runExport(overwrite)}>
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
            <span>
              Actual-size print · {layout.pages} page{layout.pages === 1 ? '' : 's'} · registration marks
            </span>
            <span>{Math.round(progress.progress * 100)}%</span>
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
          disabled={exporting || !source}
          icon={<Download size={15} />}
        >
          {exporting ? 'Building PDF…' : 'Export PDF'}
        </Button>
      </div>

      <p className="info-note" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Printer size={12} /> Print at Actual Size / 100%. Registration marks and a 20 mm scale check are
        included on every tiled page.
      </p>
    </div>
  );
}
