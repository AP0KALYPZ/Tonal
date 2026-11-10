import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Columns3,
  Download,
  Eye,
  Grid3x3,
  Hand,
  ImagePlus,
  MapPin,
  Maximize2,
  Minus,
  FlipHorizontal2,
  MousePointer2,
  Plus,
  ScanSearch,
} from 'lucide-react';
import { Button, IconButton } from '../../components/Button';
import { useAppStore } from '../../state/store';
import type { PreviewPipeline } from '../../hooks/usePreviewPipeline';
import { drawGridOverlay } from '../../lib/gridRenderer';
import { clamp, computePngSize, describeCells, moveCrop } from '../../lib/geometry';
import { luminance8 } from '../../lib/tone';

interface CanvasStageProps {
  image: HTMLImageElement | null;
  pipeline: PreviewPipeline;
  dragOver: boolean;
  onOpenPhoto: () => void;
  onLocateImage: () => void;
  onOpenExport: () => void;
}

interface ViewGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  zoom: number;
  stageWidth: number;
  stageHeight: number;
  fitZoom: number;
}

const EMPTY_GEOMETRY: ViewGeometry = {
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  zoom: 1,
  stageWidth: 1,
  stageHeight: 1,
  fitZoom: 1,
};

type DragMode = 'pan' | 'crop' | null;

export function CanvasStage({
  image,
  pipeline,
  dragOver,
  onOpenPhoto,
  onLocateImage,
  onOpenExport,
}: CanvasStageProps) {
  const project = useAppStore((state) => state.project);
  const zoomMode = useAppStore((state) => state.zoomMode);
  const zoom = useAppStore((state) => state.zoom);
  const panX = useAppStore((state) => state.panX);
  const panY = useAppStore((state) => state.panY);
  const setZoom = useAppStore((state) => state.setZoom);
  const setPan = useAppStore((state) => state.setPan);
  const fitToView = useAppStore((state) => state.fitToView);
  const actualPixels = useAppStore((state) => state.actualPixels);
  const setCrop = useAppStore((state) => state.setCrop);
  const beginGesture = useAppStore((state) => state.beginGesture);
  const endGesture = useAppStore((state) => state.endGesture);
  const compareMode = useAppStore((state) => state.compareMode);
  const setCompareMode = useAppStore((state) => state.setCompareMode);
  const loupeEnabled = useAppStore((state) => state.loupeEnabled);
  const setLoupeEnabled = useAppStore((state) => state.setLoupeEnabled);
  const spaceHeld = useAppStore((state) => state.spaceHeld);
  const setGrid = useAppStore((state) => state.setGrid);
  const setMirror = useAppStore((state) => state.setMirror);
  const setLoupeSample = useAppStore((state) => state.setLoupeSample);
  const previewProcessing = useAppStore((state) => state.previewProcessing);
  const status = useAppStore((state) => state.sourceStatus);
  const sourceError = useAppStore((state) => state.sourceError);

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewGeometry>(EMPTY_GEOMETRY);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    basePanX: number;
    basePanY: number;
    baseCrop: typeof project.composition.crop;
  } | null>(null);
  const lastSampleAt = useRef(0);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  const frameW = pipeline.cropPixelWidth || 1;
  const frameH = pipeline.cropPixelHeight || 1;
  const source = project.source;
  const compareActive = compareMode !== 'off';

  const computeFit = useCallback(
    (stageW: number, stageH: number) => {
      const availableW = Math.max(80, stageW - 64);
      const availableH = Math.max(80, stageH - 52);
      return clamp(Math.min(availableW / frameW, availableH / frameH), 0.02, 8);
    },
    [frameW, frameH],
  );

  const fitZoom = computeFit(size.width, size.height);
  const effectiveZoom = zoomMode === 'fit' ? fitZoom : zoom;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /* ------------------------------ drawing ------------------------------ */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!image || !source) {
      viewRef.current = { ...EMPTY_GEOMETRY, stageWidth: width, stageHeight: height };
      return;
    }

    const fit = computeFit(width, height);
    const drawZoom = zoomMode === 'fit' ? fit : zoom;
    const drawWidth = frameW * drawZoom;
    const drawHeight = frameH * drawZoom;
    const left = width / 2 - drawWidth / 2 + panX;
    const top = height / 2 - drawHeight / 2 + panY;
    viewRef.current = {
      left,
      top,
      width: drawWidth,
      height: drawHeight,
      zoom: drawZoom,
      stageWidth: width,
      stageHeight: height,
      fitZoom: fit,
    };

    // Soft ground shadow under the reference sheet.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 42;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = '#0c0e0e';
    ctx.fillRect(left, top, drawWidth, drawHeight);
    ctx.restore();

    const sourceCanvas = compareActive
      ? pipeline.originalCanvas
      : pipeline.ready
        ? pipeline.processedCanvas
        : pipeline.originalCanvas;
    if (sourceCanvas && sourceCanvas.width > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, drawWidth, drawHeight);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceCanvas, left, top, drawWidth, drawHeight);
      ctx.restore();
    }

    ctx.strokeStyle = 'rgba(240, 238, 233, 0.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, Math.max(0, drawWidth - 1), Math.max(0, drawHeight - 1));

    drawGridOverlay(
      ctx,
      { left, top, width: drawWidth, height: drawHeight },
      project.grid,
      { halo: true },
    );

    // Crop-frame corner marks.
    const mark = Math.min(16, drawWidth * 0.055, drawHeight * 0.055);
    if (mark > 4) {
      ctx.save();
      ctx.strokeStyle = 'rgba(229, 197, 156, 0.72)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const x0 = left - 3;
      const y0 = top - 3;
      const x1 = left + drawWidth + 3;
      const y1 = top + drawHeight + 3;
      ctx.moveTo(x0, y0 + mark);
      ctx.lineTo(x0, y0);
      ctx.lineTo(x0 + mark, y0);
      ctx.moveTo(x1 - mark, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(x1, y0 + mark);
      ctx.moveTo(x0, y1 - mark);
      ctx.lineTo(x0, y1);
      ctx.lineTo(x0 + mark, y1);
      ctx.moveTo(x1 - mark, y1);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1, y1 - mark);
      ctx.stroke();
      ctx.restore();
    }

    /* ------------------------------ loupe ------------------------------ */
    const cursorInside =
      cursor &&
      cursor.x >= left &&
      cursor.x <= left + drawWidth &&
      cursor.y >= top &&
      cursor.y <= top + drawHeight;

    if (loupeEnabled && cursorInside && cursor) {
      const nx = clamp((cursor.x - left) / drawWidth, 0, 0.9999);
      const ny = clamp((cursor.y - top) / drawHeight, 0, 0.9999);
      const processed = pipeline.processedCanvas;
      const original = pipeline.originalCanvas;
      const crop = project.composition.crop;
      let toneValue = 0;
      let originalValue = 0;
      if (processed && processed.width > 0) {
        const pctx = processed.getContext('2d', { willReadFrequently: true });
        const px = Math.min(processed.width - 1, Math.floor(nx * processed.width));
        const py = Math.min(processed.height - 1, Math.floor(ny * processed.height));
        if (pctx) {
          const d = pctx.getImageData(px, py, 1, 1).data;
          toneValue = luminance8(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0);
        }
      }
      if (original && original.width > 0) {
        const octx = original.getContext('2d', { willReadFrequently: true });
        const px = Math.min(original.width - 1, Math.floor(nx * original.width));
        const py = Math.min(original.height - 1, Math.floor(ny * original.height));
        if (octx) {
          const d = octx.getImageData(px, py, 1, 1).data;
          originalValue = luminance8(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0);
        }
      }

      const sourceX = Math.round((crop.x + nx * crop.width) * source.orientedWidth);
      const sourceY = Math.round((crop.y + ny * crop.height) * source.orientedHeight);
      const now = performance.now();
      if (now - lastSampleAt.current > 90) {
        lastSampleAt.current = now;
        setLoupeSample({ x: nx, y: ny, tone: toneValue, original: originalValue, sourceX, sourceY });
      }

      const radius = 64;
      let cx = cursor.x + 30 + radius;
      cx = clamp(cx, radius + 12, width - radius - 12);
      let cy = cursor.y - radius - 34;
      cy = clamp(cy, radius + 12, height - radius - 46);
      if (cy + radius > top && cy - radius < top + drawHeight && Math.abs(cx - cursor.x) < radius * 2) {
        // Prefer above-right; if it covers the pointer, place it lower-left instead.
        cy = cursor.y + radius + 34;
        cy = clamp(cy, radius + 12, height - radius - 46);
      }

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#151818';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
      ctx.clip();
      if (processed && processed.width > 0) {
        const region = 15;
        const sx = clamp((nx * processed.width) - region, 0, Math.max(0, processed.width - region * 2));
        const sy = clamp((ny * processed.height) - region, 0, Math.max(0, processed.height - region * 2));
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          processed,
          sx,
          sy,
          region * 2,
          region * 2,
          cx - radius,
          cy - radius,
          radius * 2,
          radius * 2,
        );
      }
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(229, 197, 156, 0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy);
      ctx.lineTo(cx + 12, cy);
      ctx.moveTo(cx, cy - 12);
      ctx.lineTo(cx, cy + 12);
      ctx.stroke();
      ctx.restore();

      const label = `T ${toneValue}  ·  O ${originalValue}  ·  ${sourceX}, ${sourceY}`;
      ctx.save();
      ctx.font = '10px "Cascadia Mono", Consolas, monospace';
      const textWidth = ctx.measureText(label).width;
      const boxW = textWidth + 16;
      const boxX = clamp(cx - boxW / 2, 6, width - boxW - 6);
      const boxY = cy + radius + 8;
      ctx.fillStyle = 'rgba(24, 27, 28, 0.94)';
      ctx.strokeStyle = 'rgba(229, 197, 156, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, 22, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e8e5df';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, boxX + 8, boxY + 11.5);
      ctx.restore();
    }
  }, [
    size,
    image,
    pipeline.originalCanvas,
    pipeline.processedCanvas,
    pipeline.ready,
    pipeline.revision,
    frameW,
    frameH,
    zoomMode,
    zoom,
    panX,
    panY,
    project.grid,
    project.composition.crop,
    compareActive,
    loupeEnabled,
    cursor,
    source,
    computeFit,
    setLoupeSample,
  ]);

  /* ------------------------------ pointer ------------------------------ */
  const pointToFrame = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!image || !source) return;
    const point = pointToFrame(event.clientX, event.clientY);
    const isPan = spaceHeld || event.button === 1 || event.altKey;
    if (event.button !== 0 && event.button !== 1) return;
    if (isPan) {
      event.preventDefault();
      dragRef.current = {
        mode: 'pan',
        startX: point.x,
        startY: point.y,
        basePanX: panX,
        basePanY: panY,
        baseCrop: project.composition.crop,
      };
      setGrabbing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    beginGesture();
    dragRef.current = {
      mode: 'crop',
      startX: point.x,
      startY: point.y,
      basePanX: panX,
      basePanY: panY,
      baseCrop: project.composition.crop,
    };
    setGrabbing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = pointToFrame(event.clientX, event.clientY);
    if (loupeEnabled) setCursor(point);
    const drag = dragRef.current;
    if (!drag) return;
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    if (drag.mode === 'pan') {
      setPan(drag.basePanX + dx, drag.basePanY + dy);
      return;
    }
    if (drag.mode === 'crop' && source) {
      const zoomValue = viewRef.current.zoom || 1;
      const deltaX = -dx / (source.orientedWidth * zoomValue);
      const deltaY = -dy / (source.orientedHeight * zoomValue);
      setCrop(moveCrop(drag.baseCrop, deltaX, deltaY));
    }
  };

  const finishPointer = () => {
    if (dragRef.current) {
      if (dragRef.current.mode === 'crop') endGesture();
      dragRef.current = null;
    }
    setGrabbing(false);
  };

  const onPointerLeave = () => {
    setCursor(null);
    if (!dragRef.current) setLoupeSample(null);
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!image) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const point = pointToFrame(event.clientX, event.clientY);
      const view = viewRef.current;
      if (!view.width) return;
      const factor = Math.exp(-event.deltaY * 0.0018);
      const nextZoom = clamp(view.zoom * factor, 0.05, 32);
      const u = (point.x - view.left) / view.width;
      const v = (point.y - view.top) / view.height;
      const nextWidth = frameW * nextZoom;
      const nextHeight = frameH * nextZoom;
      const nextLeft = point.x - u * nextWidth;
      const nextTop = point.y - v * nextHeight;
      setZoom(nextZoom, 'custom');
      setPan(
        nextLeft - (view.stageWidth / 2 - nextWidth / 2),
        nextTop - (view.stageHeight / 2 - nextHeight / 2),
      );
      return;
    }
    event.preventDefault();
    if (event.shiftKey) {
      setPan(panX - event.deltaY, panY);
    } else {
      setPan(panX - event.deltaX, panY - event.deltaY);
    }
  };

  const outputSize =
    source && project.source
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

  const zoomPercent = Math.round((zoomMode === 'fit' ? fitZoom : zoom) * 100);
  const showEmpty = !source && status !== 'error';

  return (
    <div className="stage-column">
      <div className="stage-toolbar">
        <div className="stage-title">
          <div className="stage-filename">{source?.filename ?? 'No photo loaded'}</div>
          <div className="stage-meta">
            {source && outputSize
              ? `${project.grid.columns} × ${project.grid.rows} · ${
                  project.grid.trueSquareCells ? 'square cells' : 'rectangular cells'
                } · ${outputSize.width.toLocaleString()} × ${outputSize.height.toLocaleString()} px`
              : 'Open a photo to begin a reference'}
          </div>
        </div>

        <div className="stage-tools">
          <IconButton
            label="Show grid (G)"
            icon={<Grid3x3 size={16} />}
            active={project.grid.visible}
            onClick={() => setGrid({ visible: !project.grid.visible })}
          />
          <IconButton
            label="Mirror reference (M)"
            icon={<FlipHorizontal2 size={16} />}
            active={project.composition.mirror}
            onClick={() => setMirror(!project.composition.mirror)}
          />
          <IconButton
            label="Compare original (C)"
            icon={<Eye size={16} />}
            active={compareActive}
            onClick={() => setCompareMode(compareActive ? 'off' : 'locked')}
          />
          <IconButton
            label="Loupe (L)"
            icon={<ScanSearch size={16} />}
            active={loupeEnabled}
            onClick={() => setLoupeEnabled(!loupeEnabled)}
          />
          <span className="header-sep" aria-hidden="true" />
          <div className="zoom-cluster">
            <IconButton
              label="Zoom out"
              icon={<Minus size={14} />}
              size="sm"
              onClick={() => setZoom(effectiveZoom / 1.25, 'custom')}
            />
            <button
              type="button"
              className="zoom-value"
              onClick={() => setZoom(1, 'custom')}
              title="Set zoom to actual pixels (1)"
            >
              {zoomPercent}%
            </button>
            <IconButton
              label="Zoom in"
              icon={<Plus size={14} />}
              size="sm"
              onClick={() => setZoom(effectiveZoom * 1.25, 'custom')}
            />
          </div>
          <div className="zoom-presets">
            <Button variant="quiet" size="sm" onClick={fitToView} title="Fit reference (0)">
              <span className="btn-label-optional">Fit</span>
              <Maximize2 size={13} className="btn-icon-only" />
            </Button>
            <Button variant="quiet" size="sm" onClick={actualPixels} title="Actual pixels (1)">
              <span className="optional-tool">1:1</span>
            </Button>
          </div>
          <IconButton
            label="Export reference (Ctrl+E)"
            icon={<Download size={16} />}
            onClick={onOpenExport}
          />
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`stage-viewport${grabbing ? ' is-grabbing' : ''}${spaceHeld ? ' is-space-held' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onPointerLeave={onPointerLeave}
        onWheel={onWheel}
        onContextMenu={(event) => event.preventDefault()}
        aria-label={
          source
            ? `Reference canvas. ${project.grid.columns} columns by ${project.grid.rows} rows. Drag to reframe; hold Space to pan.`
            : 'Reference canvas. No photo loaded.'
        }
        role="application"
      >
        <canvas ref={canvasRef} className="stage-canvas" />

        {source && compareActive ? (
          <div className="stage-badges">
            <span className="stage-badge original">
              <Eye size={11} /> Original photo
            </span>
          </div>
        ) : null}

        {source && source.hasAlpha ? (
          <div className="stage-badges bottom">
            <span className="stage-badge">Alpha composited on {source.alphaBackground}</span>
          </div>
        ) : null}

        {source && !compareActive ? (
          <div className="stage-hint">
            <MousePointer2 size={11} style={{ verticalAlign: -2, marginRight: 5 }} />
            Drag to reframe · <span className="kbd">Space</span> pan · <span className="kbd">C</span>{' '}
            compare · <span className="kbd">L</span> loupe
          </div>
        ) : null}

        {source && previewProcessing ? (
          <div className="stage-loading" style={{ alignItems: 'flex-start', paddingTop: 14 }}>
            <div className="loading-chip">
              <span className="spinner" /> Updating preview
            </div>
          </div>
        ) : null}

        {status === 'loading' || (source && !image && status !== 'missing') ? (
          <div className="stage-loading">
            <div className="loading-chip">
              <span className="spinner" /> Decoding photo locally…
            </div>
          </div>
        ) : null}

        {status === 'missing' ? (
          <div className="empty-state">
            <div className="empty-inner">
              <div className="empty-illustration" style={{ width: 190 }}>
                <MapPin size={46} strokeWidth={1} style={{ color: 'var(--warning)', margin: '0 auto' }} />
              </div>
              <div className="empty-eyebrow">Source missing</div>
              <h1 className="empty-title">The original photo has moved.</h1>
              <p className="empty-subtitle">
                Your project settings are intact. Locate the photo to restore full-resolution export.
              </p>
              <div className="empty-actions">
                <Button variant="primary" size="lg" onClick={onLocateImage} icon={<MapPin size={16} />}>
                  Locate image…
                </Button>
                <span className="empty-formats">JPG, PNG or WebP · settings remain editable</span>
              </div>
            </div>
          </div>
        ) : null}

        {showEmpty ? (
          <div className="empty-state">
            <div className="empty-inner">
              <img src="/brand/empty-state-grid.svg" alt="" className="empty-illustration" />
              <div className="empty-eyebrow">Local · precise · non-destructive</div>
              <h1 className="empty-title">Your next drawing starts here.</h1>
              <p className="empty-subtitle">
                Drop a photo to build a precise graphite reference. Crops, tonal work and grids are never
                burned into your source.
              </p>
              <div className="empty-actions">
                <Button variant="primary" size="lg" onClick={onOpenPhoto} icon={<ImagePlus size={17} />}>
                  Open photo
                </Button>
                <span className="empty-formats">JPG · PNG · WebP &nbsp;·&nbsp; processed on this computer only</span>
              </div>
              <div className={`empty-drop${dragOver ? ' is-over' : ''}`}>
                {dragOver ? 'Release to open this photo' : 'or drop a photo anywhere in this workspace'}
              </div>
            </div>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="empty-state">
            <div className="empty-inner">
              <div className="empty-eyebrow">Photo could not be opened</div>
              <h1 className="empty-title">Nothing was changed.</h1>
              <p className="empty-subtitle">{sourceError ?? 'Choose a different JPG, PNG or WebP image.'}</p>
              <Button variant="primary" onClick={onOpenPhoto} icon={<ImagePlus size={16} />}>
                Choose another photo
              </Button>
            </div>
          </div>
        ) : null}

        {dragOver && !showEmpty ? (
          <div className="drop-overlay">
            <div className="drop-card">
              <ImagePlus size={34} strokeWidth={1.2} />
              <strong>Drop to open this photo</strong>
              <span>The source is read locally and never modified.</span>
            </div>
          </div>
        ) : null}

        {source && project.grid.visible && !showEmpty ? (
          <div className="stage-pan-badge">
            <span className="stage-badge">
              <Columns3 size={11} />
              {describeCells(outputSize?.width ?? 0, project.grid.columns, outputSize?.height ?? 0, project.grid.rows)}
            </span>
          </div>
        ) : null}

        {source && loupeEnabled && !showEmpty ? (
          <div className="loupe-hint">
            <span className="stage-badge">
              <Hand size={11} /> Loupe · 4× sample
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
