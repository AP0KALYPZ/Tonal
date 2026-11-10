import { CircleHelp } from 'lucide-react';
import { useAppStore } from '../state/store';
import { computePngSize } from '../lib/geometry';

interface FooterProps {
  onShowShortcuts: () => void;
}

export function Footer({ onShowShortcuts }: FooterProps) {
  const project = useAppStore((state) => state.project);
  const status = useAppStore((state) => state.sourceStatus);
  const previewProcessing = useAppStore((state) => state.previewProcessing);
  const busy = useAppStore((state) => state.busy);
  const zoomMode = useAppStore((state) => state.zoomMode);
  const zoom = useAppStore((state) => state.zoom);
  const dirty = useAppStore((state) => state.dirty);

  const output =
    project.source && project.source
      ? computePngSize({
          crop: project.composition.crop,
          sourceWidth: project.source.orientedWidth,
          sourceHeight: project.source.orientedHeight,
          columns: project.grid.columns,
          rows: project.grid.rows,
          trueSquareCells: project.grid.trueSquareCells,
          resolution: 'native',
          scalePercent: 100,
          customCellSize: project.exportDefaults.cellSize,
        })
      : null;

  let statusText = 'Ready to draw';
  let statusClass = '';
  if (busy) {
    statusText = busy.label;
    statusClass = 'is-busy';
  } else if (status === 'loading') {
    statusText = 'Reading photo…';
    statusClass = 'is-busy';
  } else if (status === 'missing') {
    statusText = 'Original photo missing';
    statusClass = 'is-error';
  } else if (status === 'error') {
    statusText = 'Photo could not be opened';
    statusClass = 'is-error';
  } else if (previewProcessing) {
    statusText = 'Generating preview…';
    statusClass = 'is-busy';
  } else if (!project.source) {
    statusText = 'Ready to draw';
  } else if (dirty) {
    statusText = 'Unsaved changes';
  }

  return (
    <footer className="app-footer">
      <div className={`footer-status ${statusClass}`} role="status" aria-live="polite">
        <span className="status-led" />
        <span className="footer-text">{statusText}</span>
      </div>
      {busy ? (
        <span className="footer-value">{Math.round(busy.progress * 100)}%</span>
      ) : null}
      <div className="footer-spacer" />
      <div className="footer-stat optional">
        <span className="label">Source</span>
        <span className="footer-value">
          {project.source
            ? `${project.source.orientedWidth.toLocaleString()} × ${project.source.orientedHeight.toLocaleString()} px`
            : '—'}
        </span>
      </div>
      <div className="footer-stat">
        <span className="label">Output</span>
        <span className="footer-value">
          {output ? `${output.width.toLocaleString()} × ${output.height.toLocaleString()} px` : '—'}
        </span>
      </div>
      <div className="footer-stat optional">
        <span className="label">Grid</span>
        <span className="footer-value">
          {project.grid.columns} × {project.grid.rows} ·{' '}
          {project.grid.trueSquareCells ? 'square' : 'rectangular'}
        </span>
      </div>
      <div className="footer-stat optional">
        <span className="label">Crop</span>
        <span className="footer-value">
          {Math.round(project.composition.crop.width * 100)}% ×{' '}
          {Math.round(project.composition.crop.height * 100)}%
        </span>
      </div>
      <div className="footer-stat">
        <span className="label">Zoom</span>
        <span className="footer-value">{zoomMode === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
      </div>
      <button type="button" className="footer-help" onClick={onShowShortcuts} title="Keyboard shortcuts (?)">
        <CircleHelp size={12} />
        Shortcuts
        <span className="kbd">?</span>
      </button>
    </footer>
  );
}
