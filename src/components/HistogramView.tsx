import { useEffect, useRef } from 'react';
import type { Histogram } from '../lib/tone';

interface HistogramViewProps {
  histogram: Histogram | null;
  levels?: number;
}

export function HistogramView({ histogram, levels }: HistogramViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 260;
    const height = 96;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#141617';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(229, 197, 156, 0.055)';
    ctx.fillRect(0, 0, width / 3, height);
    ctx.fillStyle = 'rgba(229, 197, 156, 0.085)';
    ctx.fillRect(width / 3, 0, width / 3, height);

    if (!histogram || histogram.total === 0) {
      ctx.strokeStyle = '#34393A';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height - 0.5);
      ctx.lineTo(width, height - 0.5);
      ctx.stroke();
      return;
    }

    const bins = histogram.bins;
    let peak = 1;
    for (let i = 0; i < 256; i += 1) peak = Math.max(peak, bins[i] ?? 0);
    const barWidth = width / 256;
    for (let i = 0; i < 256; i += 1) {
      const value = bins[i] ?? 0;
      const normalized = Math.pow(value / peak, 0.6);
      const barHeight = Math.max(value > 0 ? 1 : 0, normalized * (height - 5));
      const shade = Math.round(70 + (i / 255) * 150);
      ctx.fillStyle = `rgba(${shade + 20}, ${shade + 4}, ${Math.max(50, shade - 22)}, 0.9)`;
      ctx.fillRect(i * barWidth, height - barHeight, Math.max(1, barWidth), barHeight);
    }

    if (levels && levels >= 3) {
      ctx.strokeStyle = 'rgba(229, 197, 156, 0.35)';
      ctx.setLineDash([2, 3]);
      for (let i = 0; i < levels; i += 1) {
        const x = (i / (levels - 1)) * (width - 1);
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, height - 1, width, 1);
  }, [histogram, levels]);

  const summary = histogram
    ? `Luminance histogram. Range ${histogram.min} to ${histogram.max}. Shadow clipping ${histogram.shadowPercent.toFixed(1)} percent, highlight clipping ${histogram.highlightPercent.toFixed(1)} percent.`
    : 'Histogram appears when a photo is loaded.';

  return (
    <div className="histogram-wrap">
      <canvas ref={canvasRef} className="histogram-canvas" role="img" aria-label={summary} />
      <div className="histogram-axis" aria-hidden="true">
        <span>Shadows</span>
        <span>Midtones</span>
        <span>Highlights</span>
      </div>
      <div className="histogram-meta">
        <span>0–255</span>
        {histogram ? (
          <span>
            range {histogram.min}–{histogram.max}
          </span>
        ) : (
          <span>waiting for photo</span>
        )}
      </div>
    </div>
  );
}
