import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

const emptyImageData = { data: new Uint8ClampedArray(4) };

HTMLCanvasElement.prototype.getContext = vi.fn(function getContext(this: HTMLCanvasElement, kind: string) {
  if (kind === '2d') {
    return {
      canvas: this,
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      roundRect: vi.fn(),
      clip: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => emptyImageData),
      putImageData: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      setLineDash: vi.fn(),
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textBaseline: 'top',
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetY: 0,
      lineCap: 'butt',
    } as unknown as CanvasRenderingContext2D;
  }
  return null;
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;

class ImageDataMock {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? 0;
    }
  }
}

Object.defineProperty(globalThis, 'ImageData', {
  writable: true,
  value: ImageDataMock,
});
