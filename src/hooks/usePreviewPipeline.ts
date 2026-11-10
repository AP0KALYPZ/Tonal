import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { applyToneToImageData, buildToneLuts, computeHistogram, parseHexColor } from '../lib/tone';
import type { ToneWorkerRequest, ToneWorkerResponse } from '../lib/toneWorker';
import type { CropRect, StudySettings, ToneSettings } from '../lib/types';

export interface PreviewPipeline {
  originalCanvas: HTMLCanvasElement | null;
  processedCanvas: HTMLCanvasElement | null;
  renderWidth: number;
  renderHeight: number;
  cropPixelWidth: number;
  cropPixelHeight: number;
  ready: boolean;
  revision: number;
}

const MAX_PREVIEW_EDGE = 2400;
const MAX_PREVIEW_PIXELS = 5_000_000;
const DEBOUNCE_MS = 45;

function drawCrop(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  crop: CropRect,
  mirror: boolean,
  background: string,
  targetWidth: number,
  targetHeight: number,
): void {
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const bg = parseHexColor(background, { r: 255, g: 255, b: 255 });
  ctx.fillStyle = `rgb(${bg.r}, ${bg.g}, ${bg.b})`;
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  const sx = crop.x * image.naturalWidth;
  const sy = crop.y * image.naturalHeight;
  const sw = Math.max(1, crop.width * image.naturalWidth);
  const sh = Math.max(1, crop.height * image.naturalHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  if (mirror) {
    ctx.translate(targetWidth, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
  ctx.restore();
}

export function usePreviewPipeline(image: HTMLImageElement | null): PreviewPipeline {
  const project = useAppStore((state) => state.project);
  const setPreviewHistogram = useAppStore((state) => state.setPreviewHistogram);
  const setPreviewProcessing = useAppStore((state) => state.setPreviewProcessing);
  const originalRef = useRef<HTMLCanvasElement | null>(null);
  const processedRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [size, setSize] = useState({ renderWidth: 0, renderHeight: 0 });

  if (!originalRef.current && typeof document !== 'undefined') {
    originalRef.current = document.createElement('canvas');
    processedRef.current = document.createElement('canvas');
  }

  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    const worker = new Worker(new URL('../lib/toneWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<ToneWorkerResponse>) => {
      const response = event.data;
      if (response.id !== seqRef.current) return;
      const processed = processedRef.current;
      if (!processed || response.error) {
        setPreviewProcessing(false);
        return;
      }
      processed.width = response.width;
      processed.height = response.height;
      const ctx = processed.getContext('2d');
      if (ctx) {
        ctx.putImageData(
          new ImageData(new Uint8ClampedArray(response.buffer), response.width, response.height),
          0,
          0,
        );
      }
      setPreviewHistogram(response.histogram);
      setPreviewProcessing(false);
      setReady(true);
      setRevision((value) => value + 1);
      setSize({ renderWidth: response.width, renderHeight: response.height });
    };
    worker.onerror = () => {
      workerRef.current = null;
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [setPreviewHistogram, setPreviewProcessing]);

  const crop = project.composition.crop;
  const tone = project.tone;
  const study = project.study;
  const mirror = project.composition.mirror;
  const background = project.source?.alphaBackground ?? '#FFFFFF';

  useEffect(() => {
    if (!image) {
      setReady(false);
      setPreviewHistogram(null);
      return;
    }
    if (!processedRef.current || !originalRef.current) return;

    const imageWidth = image.naturalWidth;
    const imageHeight = image.naturalHeight;
    if (!imageWidth || !imageHeight) return;

    const cropPixelWidth = Math.max(1, crop.width * imageWidth);
    const cropPixelHeight = Math.max(1, crop.height * imageHeight);
    const edgeScale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(cropPixelWidth, cropPixelHeight));
    const pixelScale = Math.min(1, Math.sqrt(MAX_PREVIEW_PIXELS / (cropPixelWidth * cropPixelHeight)));
    const scale = Math.min(edgeScale, pixelScale);
    const targetWidth = Math.max(1, Math.round(cropPixelWidth * scale));
    const targetHeight = Math.max(1, Math.round(cropPixelHeight * scale));
    const generation = seqRef.current + 1;
    seqRef.current = generation;
    setPreviewProcessing(true);

    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (!processedRef.current || !originalRef.current) return;
      drawCrop(originalRef.current, image, crop, mirror, background, targetWidth, targetHeight);

      const ctx = originalRef.current.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setPreviewProcessing(false);
        return;
      }
      const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const worker = workerRef.current;
      if (worker) {
        const request: ToneWorkerRequest = {
          id: generation,
          buffer: imageData.data.buffer as ArrayBuffer,
          width: targetWidth,
          height: targetHeight,
          tone,
          study,
        };
        worker.postMessage(request, [request.buffer]);
      } else {
        const luts = buildToneLuts(tone, study);
        applyToneToImageData(imageData.data, tone, study, luts);
        const processed = processedRef.current;
        if (!processed) return;
        processed.width = targetWidth;
        processed.height = targetHeight;
        processed.getContext('2d')?.putImageData(imageData, 0, 0);
        setPreviewHistogram(computeHistogram(imageData.data));
        setPreviewProcessing(false);
        setReady(true);
        setRevision((value) => value + 1);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // The crop/tone/study/mirror/background/image tuple fully describes this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    tone.grayscale,
    tone.brightness,
    tone.contrast,
    tone.shadows,
    tone.highlights,
    tone.gamma,
    tone.blackPoint,
    tone.whitePoint,
    study.enabled,
    study.levels,
    mirror,
    background,
    setPreviewHistogram,
    setPreviewProcessing,
  ]);

  return {
    originalCanvas: originalRef.current,
    processedCanvas: processedRef.current,
    renderWidth: size.renderWidth,
    renderHeight: size.renderHeight,
    cropPixelWidth: image ? Math.max(1, crop.width * image.naturalWidth) : 0,
    cropPixelHeight: image ? Math.max(1, crop.height * image.naturalHeight) : 0,
    ready,
    revision,
  };
}

/** Used by tests to exercise the exact worker-free tone transform. */
export function processPixelsForTest(
  data: Uint8ClampedArray,
  tone: ToneSettings,
  study: StudySettings,
): Uint8ClampedArray {
  applyToneToImageData(data, tone, study);
  return data;
}
