import {
  borderLineWidth,
  cellLabel,
  columnLabel,
  gridLineWidth,
  isMajorLine,
  majorLineWidth,
} from './geometry';
import type { GridSettings } from './types';

export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GridDrawOptions {
  labels?: boolean;
  halo?: boolean;
  opacityMultiplier?: number;
  /** Override placement for export preview, defaults to the grid setting. */
  placement?: GridSettings['labelPlacement'];
}

export function drawGridOverlay(
  ctx: CanvasRenderingContext2D,
  rect: FrameRect,
  grid: GridSettings,
  options: GridDrawOptions = {},
): void {
  if (!grid.visible || rect.width <= 0 || rect.height <= 0) return;
  const labels = options.labels ?? grid.labelsEnabled;
  const opacity = grid.opacity * (options.opacityMultiplier ?? 1);
  if (opacity <= 0) return;
  const placement = options.placement ?? grid.labelPlacement;
  const baseWidth = gridLineWidth(rect.width, rect.height, grid.columns, grid.rows, grid.thickness);
  const majorWidth = majorLineWidth(
    rect.width,
    rect.height,
    grid.columns,
    grid.rows,
    grid.thickness,
    grid.majorThickness,
  );
  const borderWidth = borderLineWidth(rect.width, rect.height, grid.columns, grid.rows, grid.thickness);
  const cellWidth = rect.width / grid.columns;
  const cellHeight = rect.height / grid.rows;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = grid.color;
  ctx.fillStyle = grid.color;
  ctx.lineCap = 'butt';

  for (let i = 0; i <= grid.columns; i += 1) {
    const isEdge = i === 0 || i === grid.columns;
    const width = isEdge ? (grid.border ? borderWidth : baseWidth) : isMajorLine(i, grid.columns, grid.majorEvery) ? majorWidth : baseWidth;
    const x = i === grid.columns ? rect.left + rect.width : rect.left + (rect.width * i) / grid.columns;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, rect.top);
    ctx.lineTo(x, rect.top + rect.height);
    ctx.stroke();
  }

  for (let j = 0; j <= grid.rows; j += 1) {
    const isEdge = j === 0 || j === grid.rows;
    const width = isEdge ? (grid.border ? borderWidth : baseWidth) : isMajorLine(j, grid.rows, grid.majorEvery) ? majorWidth : baseWidth;
    const y = j === grid.rows ? rect.top + rect.height : rect.top + (rect.height * j) / grid.rows;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(rect.left, y);
    ctx.lineTo(rect.left + rect.width, y);
    ctx.stroke();
  }

  if (labels) {
    const cell = Math.min(cellWidth, cellHeight);
    const font = Math.max(5, Math.min(48, cell * 0.16));
    ctx.font = `600 ${font}px "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    const padX = Math.max(2, cell * 0.07);
    const padY = Math.max(2, cell * 0.06);
    const halo = options.halo ?? true;

    if (placement === 'cells') {
      for (let row = 0; row < grid.rows; row += 1) {
        for (let col = 0; col < grid.columns; col += 1) {
          const text = cellLabel(col, row);
          const x = rect.left + col * cellWidth + padX;
          const y = rect.top + row * cellHeight + padY;
          if (halo) {
            ctx.save();
            ctx.globalAlpha = opacity * 0.55;
            ctx.strokeStyle = 'rgba(10, 11, 11, 0.85)';
            ctx.lineWidth = Math.max(2, font * 0.18);
            ctx.strokeText(text, x, y);
            ctx.restore();
          }
          ctx.fillText(text, x, y);
        }
      }
    } else {
      ctx.textBaseline = 'top';
      for (let col = 0; col < grid.columns; col += 1) {
        const text = columnLabel(col + 1);
        const x = rect.left + col * cellWidth + padX;
        const y = rect.top + padY;
        if (halo) {
          ctx.save();
          ctx.globalAlpha = opacity * 0.55;
          ctx.strokeStyle = 'rgba(10, 11, 11, 0.85)';
          ctx.lineWidth = Math.max(2, font * 0.18);
          ctx.strokeText(text, x, y);
          ctx.restore();
        }
        ctx.fillText(text, x, y);
      }
      for (let row = 0; row < grid.rows; row += 1) {
        const text = String(row + 1);
        const x = rect.left + padX;
        const y = rect.top + row * cellHeight + padY;
        if (halo) {
          ctx.save();
          ctx.globalAlpha = opacity * 0.55;
          ctx.strokeStyle = 'rgba(10, 11, 11, 0.85)';
          ctx.lineWidth = Math.max(2, font * 0.18);
          ctx.strokeText(text, x, y);
          ctx.restore();
        }
        ctx.fillText(text, x, y);
      }
    }
  }

  ctx.restore();
}
