import {
  Crosshair,
  Expand,
  ImagePlus,
  MapPin,
  RefreshCw,
  Replace,
} from 'lucide-react';
import { Button } from '../../components/Button';
import { Section } from '../../components/Section';
import { SourceMap } from './SourceMap';
import { useAppStore } from '../../state/store';
import { cropPixelSize, percentOfSourceKept } from '../../lib/geometry';

interface SourcePanelProps {
  onOpenPhoto: () => void;
  onLocateImage: () => void;
}

export function SourcePanel({ onOpenPhoto, onLocateImage }: SourcePanelProps) {
  const project = useAppStore((state) => state.project);
  const preview = useAppStore((state) => state.sourcePreview);
  const status = useAppStore((state) => state.sourceStatus);
  const error = useAppStore((state) => state.sourceError);
  const centerCrop = useAppStore((state) => state.centerCrop);
  const fitSource = useAppStore((state) => state.fitSource);
  const source = project.source;

  const cropPx = source
    ? cropPixelSize(project.composition.crop, source.orientedWidth, source.orientedHeight)
    : null;

  return (
    <Section index="01" title="Source" action={
      <Button
        variant="quiet"
        size="sm"
        onClick={onOpenPhoto}
        icon={source ? <Replace size={13} /> : <ImagePlus size={13} />}
      >
        {source ? 'Replace' : 'Open'}
      </Button>
    }>
      {!source ? (
        <div className="source-empty">
          <div className="empty-card">
            <div style={{ marginBottom: 8, color: 'var(--text-muted)' }}>
              <ImagePlus size={22} strokeWidth={1.4} />
            </div>
            No photo loaded. Open a JPG, PNG or WebP to begin.
          </div>
          <Button variant="secondary" block onClick={onOpenPhoto} icon={<ImagePlus size={15} />}>
            Open photo
          </Button>
        </div>
      ) : status === 'missing' ? (
        <div className="source-missing">
          <strong>The original photo has moved.</strong>
          <p>
            TONAL kept your grid, crop and tonal settings. Locate the file to restore the full-resolution
            reference.
          </p>
          <Button variant="secondary" size="sm" onClick={onLocateImage} icon={<MapPin size={13} />}>
            Locate image…
          </Button>
        </div>
      ) : (
        <div className="source-summary">
          <div>
            <div className="source-name" title={source.filename}>
              {source.filename}
            </div>
            <div className="source-meta-line">
              <span className="mono">
                {source.orientedWidth.toLocaleString()} × {source.orientedHeight.toLocaleString()} px
              </span>
              <span>{(source.format || '').replace('image/', '').toUpperCase()}</span>
            </div>
          </div>

          <div className="source-flags">
            <span className="badge">Source untouched</span>
            {source.hasAlpha ? <span className="badge">Alpha · white paper</span> : null}
            {status === 'loading' ? <span className="badge badge-accent">Loading…</span> : null}
            {error ? <span className="badge badge-warning">Preview issue</span> : null}
          </div>

          {preview ? (
            <>
              <SourceMap
                source={source}
                previewUrl={preview.dataUrl}
                crop={project.composition.crop}
                trueSquareCells={project.grid.trueSquareCells}
              />
              <div className="source-map-note">
                <span>
                  Crop {Math.round(project.composition.crop.width * 100)}% ×{' '}
                  {Math.round(project.composition.crop.height * 100)}% of photo
                </span>
                <span className="mono">
                  {Math.round(cropPx?.width ?? 0).toLocaleString()} ×{' '}
                  {Math.round(cropPx?.height ?? 0).toLocaleString()} px
                </span>
              </div>
            </>
          ) : null}

          {error ? (
            <div className="inline-status error" role="alert">
              <span className="status-dot" />
              {error}
            </div>
          ) : null}

          <div className="source-actions">
            <Button variant="ghost" size="sm" onClick={fitSource} icon={<Expand size={13} />}>
              Fit source
            </Button>
            <Button variant="ghost" size="sm" onClick={centerCrop} icon={<Crosshair size={13} />}>
              Center crop
            </Button>
          </div>

          <p className="info-note">
            Drag the map or the photo to reframe. The photo is never stretched:{' '}
            {project.grid.trueSquareCells
              ? 'the crop ratio always matches your grid.'
              : 'free crop corners let you choose any framing, so cells may be rectangular.'}{' '}
            <span className="muted">Keeps {percentOfSourceKept(project.composition.crop).toFixed(0)}% of the source.</span>
          </p>
        </div>
      )}

      {source && status !== 'missing' ? (
        <Button
          variant="ghost"
          size="sm"
          block
          onClick={onOpenPhoto}
          icon={<RefreshCw size={13} />}
        >
          Open a different photo
        </Button>
      ) : null}
    </Section>
  );
}
