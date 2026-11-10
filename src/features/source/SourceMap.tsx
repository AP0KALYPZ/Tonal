import { useRef, type PointerEvent } from 'react';
import { useAppStore } from '../../state/store';
import { clampCrop, moveCrop, resizeCrop, type CropHandle } from '../../lib/geometry';
import type { CropRect, SourceRef } from '../../lib/types';

interface SourceMapProps {
  source: SourceRef;
  previewUrl: string;
  crop: CropRect;
  trueSquareCells: boolean;
}

type DragState =
  | { mode: 'move'; startX: number; startY: number; base: CropRect }
  | { mode: CropHandle; startX: number; startY: number; base: CropRect };

export function SourceMap({ source, previewUrl, crop, trueSquareCells }: SourceMapProps) {
  const setCrop = useAppStore((state) => state.setCrop);
  const beginGesture = useAppStore((state) => state.beginGesture);
  const endGesture = useAppStore((state) => state.endGesture);
  const mapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const dimensions = (): { width: number; height: number } => {
    const rect = mapRef.current?.getBoundingClientRect();
    return { width: rect?.width || 1, height: rect?.height || 1 };
  };

  const startDrag = (event: PointerEvent, state: DragState) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = state;
    beginGesture();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { width, height } = dimensions();
    const dx = (event.clientX - drag.startX) / width;
    const dy = (event.clientY - drag.startY) / height;
    if (drag.mode === 'move') {
      setCrop(moveCrop(drag.base, dx, dy));
    } else {
      setCrop(resizeCrop(drag.base, drag.mode, dx, dy));
    }
  };

  const finishDrag = (event: PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    endGesture();
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }
  };

  const onMapPointerDown = (event: PointerEvent) => {
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains('source-shade')) {
      return;
    }
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = (event.clientX - rect.left) / rect.width;
    const clickY = (event.clientY - rect.top) / rect.height;
    const next = clampCrop({ ...crop, x: clickX - crop.width / 2, y: clickY - crop.height / 2 });
    beginGesture();
    setCrop(next);
    dragRef.current = {
      mode: 'move',
      startX: event.clientX,
      startY: event.clientY,
      base: next,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const pct = (value: number) => `${value * 100}%`;
  const handles: CropHandle[] = ['nw', 'ne', 'sw', 'se'];

  return (
    <div
      ref={mapRef}
      className="source-map"
      style={{ aspectRatio: `${source.orientedWidth} / ${source.orientedHeight}` }}
      onPointerDown={onMapPointerDown}
      onPointerMove={onMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      role="group"
      aria-label={`Photo framing map. Crop ${Math.round(crop.width * 100)} percent wide and ${Math.round(crop.height * 100)} percent tall.`}
    >
      <img src={previewUrl} alt="" draggable={false} />
      <div
        className="source-map-shade"
        style={{ left: 0, top: 0, width: '100%', height: pct(crop.y) }}
      />
      <div
        className="source-map-shade"
        style={{ left: 0, top: pct(crop.y + crop.height), width: '100%', bottom: 0 }}
      />
      <div
        className="source-map-shade"
        style={{ left: 0, top: pct(crop.y), width: pct(crop.x), height: pct(crop.height) }}
      />
      <div
        className="source-map-shade"
        style={{ left: pct(crop.x + crop.width), top: pct(crop.y), right: 0, height: pct(crop.height) }}
      />
      <div
        className={`source-crop-box${trueSquareCells ? ' is-square' : ''}`}
        style={{
          left: pct(crop.x),
          top: pct(crop.y),
          width: pct(crop.width),
          height: pct(crop.height),
        }}
        title={trueSquareCells ? 'Drag to reframe. Square crop size follows the grid ratio.' : 'Drag to reframe. Drag corners to resize.'}
        onPointerDown={(event) =>
          startDrag(event, {
            mode: 'move',
            startX: event.clientX,
            startY: event.clientY,
            base: crop,
          })
        }
      >
        {!trueSquareCells
          ? handles.map((handle) => (
              <span
                key={handle}
                className={`crop-handle ${handle}`}
                role="presentation"
                onPointerDown={(event) =>
                  startDrag(event, {
                    mode: handle,
                    startX: event.clientX,
                    startY: event.clientY,
                    base: crop,
                  })
                }
              />
            ))
          : null}
      </div>
    </div>
  );
}
