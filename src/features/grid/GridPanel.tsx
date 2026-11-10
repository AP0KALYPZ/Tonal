import { Grid3x3, Palette } from 'lucide-react';
import { NumberStepper } from '../../components/NumberStepper';
import { Section } from '../../components/Section';
import { Slider } from '../../components/Slider';
import { Switch } from '../../components/Switch';
import { useAppStore } from '../../state/store';
import { GRID_SWATCHES } from '../../lib/defaults';
import { cropPixelSize, labelsAreTight } from '../../lib/geometry';

export function GridPanel() {
  const project = useAppStore((state) => state.project);
  const setGrid = useAppStore((state) => state.setGrid);
  const grid = project.grid;
  const source = project.source;

  const cropPx = source
    ? cropPixelSize(project.composition.crop, source.orientedWidth, source.orientedHeight)
    : { width: 0, height: 0 };
  const cellW = cropPx.width / grid.columns;
  const cellH = cropPx.height / grid.rows;
  const tightLabels = grid.labelsEnabled && labelsAreTight(cropPx.width, cropPx.height, grid.columns, grid.rows, grid.labelPlacement);
  const isPresetColor = GRID_SWATCHES.some((swatch) => swatch.value.toUpperCase() === grid.color.toUpperCase());
  const cellsSquare = Math.abs(cellW - cellH) < 0.5;

  return (
    <Section
      index="02"
      title="Drawing grid"
      action={<Switch label="Show grid" checked={grid.visible} onChange={(visible) => setGrid({ visible })} showLabel={false} />}
    >
      <div className="grid-two">
        <NumberStepper
          label="Columns"
          value={grid.columns}
          min={1}
          max={100}
          onChange={(columns) => setGrid({ columns })}
          hint="Number of columns across the reference. 1–100."
        />
        <NumberStepper
          label="Rows"
          value={grid.rows}
          min={1}
          max={100}
          onChange={(rows) => setGrid({ rows })}
          hint="Number of rows down the reference. 1–100."
        />
      </div>

      <Switch
        label="Keep cells truly square"
        description="Crops to the grid ratio instead of stretching the photo."
        checked={grid.trueSquareCells}
        onChange={(trueSquareCells) => setGrid({ trueSquareCells })}
      />

      <div className="grid-summary">
        <span className="mono">
          {grid.columns} × {grid.rows}
        </span>
        <span className={`shape${cellsSquare ? '' : ' rect'}`}>
          {cellsSquare ? 'square cells' : 'rectangular cells'}
          {source ? ` · ${Math.round(cellW)} × ${Math.round(cellH)} px` : ''}
        </span>
      </div>

      {!grid.trueSquareCells ? (
        <div className="inline-status warning">
          <span className="status-dot" />
          <span>
            Cells follow the photo&apos;s proportions and may be rectangular. Drag the crop corners in the
            source map to frame freely.
          </span>
        </div>
      ) : (
        <p className="info-note">
          The source is cropped to preserve image proportions. Drag the photo to adjust framing.
        </p>
      )}

      <div className="divider" />

      <div className="subgroup">
        <div className="subgroup-head">
          <span className="subgroup-title">
            <Palette size={10} style={{ marginRight: 4, verticalAlign: -1 }} />
            Grid appearance
          </span>
        </div>

        <div>
          <span className="field-label">Grid colour</span>
          <div className="swatch-row" role="group" aria-label="Grid colour">
            {GRID_SWATCHES.map((swatch) => (
              <button
                key={swatch.value}
                type="button"
                className={`swatch${grid.color.toUpperCase() === swatch.value.toUpperCase() ? ' is-selected' : ''}`}
                style={{ background: swatch.value }}
                aria-label={`${swatch.name} grid`}
                aria-pressed={grid.color.toUpperCase() === swatch.value.toUpperCase()}
                title={swatch.name}
                onClick={() => setGrid({ color: swatch.value })}
              />
            ))}
            <label
              className={`swatch-custom${!isPresetColor ? ' is-selected' : ''}`}
              title="Custom grid colour"
              style={!isPresetColor ? { boxShadow: '0 0 0 2px var(--panel), 0 0 0 3px var(--accent)' } : undefined}
            >
              <span
                style={{
                  position: 'absolute',
                  inset: 4,
                  borderRadius: 4,
                  background: grid.customColor,
                  pointerEvents: 'none',
                }}
              />
              <input
                type="color"
                aria-label="Custom grid colour"
                value={grid.customColor}
                onChange={(event) => setGrid({ customColor: event.target.value.toUpperCase(), color: event.target.value.toUpperCase() })}
              />
            </label>
          </div>
        </div>

        <Slider
          label="Opacity"
          value={Math.round(grid.opacity * 100)}
          min={0}
          max={100}
          step={1}
          format={(value) => `${value}%`}
          onChange={(value) => setGrid({ opacity: value / 100 })}
          onReset={() => setGrid({ opacity: 0.68 })}
        />
        <Slider
          label="Line thickness"
          value={grid.thickness}
          min={0.5}
          max={3}
          step={0.05}
          format={(value) => value.toFixed(2)}
          onChange={(thickness) => setGrid({ thickness })}
          onReset={() => setGrid({ thickness: 1 })}
          hint="Relative to cell size so the grid stays legible at high resolution."
        />

        <div className="mini-select-row">
          <div className="mini-field">
            <label className="field-label" htmlFor="major-every">
              Major lines
            </label>
            <select
              id="major-every"
              className="select-input"
              value={grid.majorEvery}
              onChange={(event) => setGrid({ majorEvery: Number(event.target.value) })}
            >
              <option value={0}>Off</option>
              <option value={2}>Every 2nd</option>
              <option value={3}>Every 3rd</option>
              <option value={4}>Every 4th</option>
              <option value={5}>Every 5th</option>
              <option value={10}>Every 10th</option>
            </select>
          </div>
          <div className="mini-field">
            <span className="field-label">Border</span>
            <div style={{ display: 'flex', alignItems: 'center', height: 30 }}>
              <Switch
                label="Outline border"
                checked={grid.border}
                onChange={(border) => setGrid({ border })}
                showLabel={false}
              />
              <span className="info-note" style={{ marginLeft: 8 }}>
                {grid.border ? 'Outlined' : 'Bounds only'}
              </span>
            </div>
          </div>
        </div>

        {grid.majorEvery > 0 ? (
          <Slider
            label="Major line weight"
            value={grid.majorThickness}
            min={1}
            max={2.5}
            step={0.05}
            format={(value) => `${value.toFixed(2)}×`}
            onChange={(majorThickness) => setGrid({ majorThickness })}
            onReset={() => setGrid({ majorThickness: 1.8 })}
          />
        ) : null}
      </div>

      <div className="divider" />

      <Switch
        label="Coordinate labels"
        description="A1, B1… in cells, or letters and numbers on the perimeter."
        checked={grid.labelsEnabled}
        onChange={(labelsEnabled) => setGrid({ labelsEnabled })}
      />

      {grid.labelsEnabled ? (
        <>
          <div className="label-placement-row">
            <span className="field-label">Label placement</span>
            <div className="segmented" role="group" aria-label="Label placement">
              <button
                type="button"
                className={`segmented-option${grid.labelPlacement === 'cells' ? ' is-active' : ''}`}
                aria-pressed={grid.labelPlacement === 'cells'}
                onClick={() => setGrid({ labelPlacement: 'cells' })}
              >
                In cells
              </button>
              <button
                type="button"
                className={`segmented-option${grid.labelPlacement === 'perimeter' ? ' is-active' : ''}`}
                aria-pressed={grid.labelPlacement === 'perimeter'}
                onClick={() => setGrid({ labelPlacement: 'perimeter' })}
              >
                Perimeter
              </button>
            </div>
          </div>
          {tightLabels ? (
            <div className="inline-status warning">
              <span className="status-dot" />
              Labels are tight at this cell size. Perimeter labels stay legible on dense grids.
            </div>
          ) : null}
        </>
      ) : null}

      <div className="grid-summary">
        <span>
          <Grid3x3 size={10} style={{ marginRight: 4, verticalAlign: -1 }} />
          {grid.visible ? 'Grid visible in preview and export' : 'Grid hidden'}
        </span>
        <span className="mono">{source ? `${grid.columns * grid.rows} cells` : 'No photo'}</span>
      </div>
    </Section>
  );
}
