/// <reference lib="webworker" />
import { applyToneToImageData, buildToneLuts, computeHistogram, type Histogram } from './tone';
import type { StudySettings, ToneSettings } from './types';

export interface ToneWorkerRequest {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  tone: ToneSettings;
  study: StudySettings;
}

export interface ToneWorkerResponse {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  histogram: Histogram;
  error?: string;
}

self.onmessage = (event: MessageEvent<ToneWorkerRequest>) => {
  const { id, buffer, width, height, tone, study } = event.data;
  try {
    const data = new Uint8ClampedArray(buffer);
    const luts = buildToneLuts(tone, study);
    applyToneToImageData(data, tone, study, luts);
    const histogram = computeHistogram(data);
    const response: ToneWorkerResponse = {
      id,
      buffer: data.buffer as ArrayBuffer,
      width,
      height,
      histogram,
    };
    self.postMessage(response, { transfer: [data.buffer] });
  } catch (error) {
    const response: ToneWorkerResponse = {
      id,
      buffer,
      width,
      height,
      histogram: {
        bins: new Uint32Array(256),
        total: 0,
        min: 0,
        max: 0,
        shadowClipped: 0,
        highlightClipped: 0,
        shadowPercent: 0,
        highlightPercent: 0,
      },
      error: error instanceof Error ? error.message : 'Tone processing failed',
    };
    self.postMessage(response);
  }
};

export {};
