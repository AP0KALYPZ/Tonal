import { useEffect, useState } from 'react';
import { Printer, Ruler } from 'lucide-react';
import { Button } from '../../components/Button';
import { Section } from '../../components/Section';
import { useAppStore } from '../../state/store';
import {
  drawingAreaFitsGridRatio,
  formatLength,
  mmToUnit,
  physicalCells,
  suggestDrawingArea,
  unitToMm,
} from '../../lib/paper';
import type { PaperUnit } from '../../lib/types';

interface PaperPanelProps {
  onPrintSetup: () => void;
}

function DimensionInput({
  label,
  value,
  unit,
  onCommit,
}: {
  label: string;
  value: number;
  unit: PaperUnit;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(1000, Math.max(0.1, Math.round(parsed * 100) / 100));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <label className="mini-field">
      <span className="field-label">{label}</span>
      <div style={{ position: 'relative' }}>
        <input
          className="text-input"
          inputMode="decimal"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit();
              event.currentTarget.blur();
            }
          }}
          aria-label={`Drawing area ${label.toLowerCase()} in ${unit}`}
        />
        <span
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 9.5,
            color: 'var(--text-muted)',
            pointerEvents: 'none',
          }}
        >
          {unit}
        </span>
      </div>
    </label>
  );
}

export function PaperPanel({ onPrintSetup }: PaperPanelProps) {
  const project = useAppStore((state) => state.project);
  const setPaper = useAppStore((state) => state.setPaper);
  const paper = project.paper;
  const cells = physicalCells(paper, project.grid.columns, project.grid.rows);
  const matches = drawingAreaFitsGridRatio(paper, project.grid.columns, project.grid.rows);
  const suggestion = suggestDrawingArea(paper, project.grid.columns, project.grid.rows);
  const sourceAspect = project.source
    ? (project.composition.crop.width * project.source.orientedWidth) /
      (project.composition.crop.height * project.source.orientedHeight)
    : null;

  const changeUnit = (unit: PaperUnit) => {
    const widthMm = unitToMm(paper.width, paper.unit);
    const heightMm = unitToMm(paper.height, paper.unit);
    setPaper({
      unit,
      width: Math.round(mmToUnit(widthMm, unit) * 100) / 100,
      height: Math.round(mmToUnit(heightMm, unit) * 100) / 100,
    });
  };

  return (
    <Section
      index="03"
      title="Drawing paper"
      action={<Ruler size={14} style={{ color: 'var(--text-muted)' }} />}
    >
      <p className="info-note">
        Enter the area you will actually draw inside, excluding sheet margins. Cells are measured with a
        ruler — not screen pixels or DPI.
      </p>

      <div className="paper-unit-row">
        <DimensionInput
          label="Width"
          value={paper.width}
          unit={paper.unit}
          onCommit={(width) => setPaper({ width })}
        />
        <DimensionInput
          label="Height"
          value={paper.height}
          unit={paper.unit}
          onCommit={(height) => setPaper({ height })}
        />
        <label className="mini-field">
          <span className="field-label">Unit</span>
          <select
            className="select-input"
            value={paper.unit}
            onChange={(event) => changeUnit(event.target.value as PaperUnit)}
            aria-label="Paper measurement unit"
          >
            <option value="cm">cm</option>
            <option value="mm">mm</option>
            <option value="in">in</option>
          </select>
        </label>
      </div>

      <div className="paper-summary">
        <div className="paper-cell-line">
          <span>Each cell</span>
          <strong>
            {formatLength(cells.cellWidthMm, paper.unit)} × {formatLength(cells.cellHeightMm, paper.unit)}
          </strong>
        </div>
        <div className="paper-cell-line">
          <span>Grid</span>
          <strong>
            {project.grid.columns} × {project.grid.rows}
          </strong>
        </div>
        <div className="paper-cell-line">
          <span>Cell shape</span>
          <strong style={{ color: cells.square ? 'var(--success)' : 'var(--warning)' }}>
            {cells.square ? 'Square' : `Rectangular (${cells.differencePercent.toFixed(1)}% off)`}
          </strong>
        </div>
      </div>

      {!matches ? (
        <div className="inline-status warning">
          <span className="status-dot" />
          <span>
            This drawing area won&apos;t make square cells. For {project.grid.columns} × {project.grid.rows},
            try {suggestion.width} × {suggestion.height} {paper.unit}
            {sourceAspect ? ' (or change the grid counts).' : '.'}
          </span>
        </div>
      ) : (
        <div className="inline-status success">
          <span className="status-dot" />
          Your paper ratio matches the grid. Ruler-measured cells will be square.
        </div>
      )}

      <div className="source-actions">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPaper({ width: suggestion.width, height: suggestion.height })}
          disabled={matches}
        >
          Match grid ratio
        </Button>
        <Button variant="ghost" size="sm" onClick={onPrintSetup} icon={<Printer size={13} />}>
          Print setup
        </Button>
      </div>
    </Section>
  );
}
