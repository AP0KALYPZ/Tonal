import { Check, Download, Eye, Gauge, Hand, Layers, FlipHorizontal2, MousePointer2, RotateCcw } from 'lucide-react';
import { Button } from '../../components/Button';
import { HistogramView } from '../../components/HistogramView';
import { Section } from '../../components/Section';
import { Slider } from '../../components/Slider';
import { Switch } from '../../components/Switch';
import { useAppStore } from '../../state/store';
import { TONE_PRESETS, presetMatchesTone } from '../../lib/presets';
import { valueSwatches } from '../../lib/tone';
import { computePngSize, describeCells } from '../../lib/geometry';
import type { ExportMode } from '../../lib/types';

interface TonePanelProps {
  onOpenExport: (mode?: ExportMode, tab?: 'png' | 'pdf') => void;
}

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

export function TonePanel({ onOpenExport }: TonePanelProps) {
  const project = useAppStore((state) => state.project);
  const setTone = useAppStore((state) => state.setTone);
  const setStudy = useAppStore((state) => state.setStudy);
  const setExportDefaults = useAppStore((state) => state.setExportDefaults);
  const resetToneGroup = useAppStore((state) => state.resetToneGroup);
  const applyPreset = useAppStore((state) => state.applyPreset);
  const setMirror = useAppStore((state) => state.setMirror);
  const setCompareMode = useAppStore((state) => state.setCompareMode);
  const compareMode = useAppStore((state) => state.compareMode);
  const loupeEnabled = useAppStore((state) => state.loupeEnabled);
  const setLoupeEnabled = useAppStore((state) => state.setLoupeEnabled);
  const loupeSample = useAppStore((state) => state.loupeSample);
  const histogram = useAppStore((state) => state.previewHistogram);

  const tone = project.tone;
  const study = project.study;
  const exportDefaults = project.exportDefaults;
  const swatches = valueSwatches(study.levels);

  const size = project.source
    ? computePngSize({
        crop: project.composition.crop,
        sourceWidth: project.source.orientedWidth,
        sourceHeight: project.source.orientedHeight,
        columns: project.grid.columns,
        rows: project.grid.rows,
        trueSquareCells: project.grid.trueSquareCells,
        resolution: 'native',
        scalePercent: 100,
        customCellSize: exportDefaults.cellSize,
      })
    : null;

  const clippingWarning =
    histogram !== null && (histogram.shadowPercent > 1 || histogram.highlightPercent > 1);

  const exportModes: Array<{ mode: ExportMode; label: string; icon: typeof Layers }> = [
    { mode: 'combined', label: 'Photo + grid', icon: Layers },
    { mode: 'photo', label: 'Photo only', icon: Eye },
    { mode: 'grid', label: 'Grid only', icon: Gauge },
  ];

  return (
    <>
      <Section
        index="04"
        title="Tonal development"
        action={
          <Button
            variant="quiet"
            size="sm"
            onClick={() => resetToneGroup('all')}
            icon={<RotateCcw size={12} />}
            title="Reset all tonal adjustments"
          >
            Reset
          </Button>
        }
      >
        <Switch
          label="Grayscale"
          description="Rec.709 luminance, computed from the untouched source."
          checked={tone.grayscale}
          onChange={(grayscale) => setTone({ grayscale })}
        />

        <div className="subgroup">
          <div className="subgroup-head">
            <span className="subgroup-title">Basic</span>
            <button type="button" className="subgroup-reset" onClick={() => resetToneGroup('basic')}>
              Reset basic
            </button>
          </div>
          <Slider
            label="Brightness"
            value={tone.brightness}
            min={-100}
            max={100}
            step={1}
            format={signed}
            onChange={(brightness) => setTone({ brightness })}
            onReset={() => setTone({ brightness: 0 })}
          />
          <Slider
            label="Contrast"
            value={tone.contrast}
            min={-100}
            max={100}
            step={1}
            format={signed}
            onChange={(contrast) => setTone({ contrast })}
            onReset={() => setTone({ contrast: 0 })}
          />
          <Slider
            label="Midtone gamma"
            value={tone.gamma}
            min={0.25}
            max={3}
            step={0.01}
            format={(value) => value.toFixed(2)}
            onChange={(gamma) => setTone({ gamma })}
            onReset={() => setTone({ gamma: 1 })}
            hint="Adjusts midtones without moving black and white points. Above 1 lifts them."
          />
        </div>

        <div className="subgroup">
          <div className="subgroup-head">
            <span className="subgroup-title">Range</span>
            <button type="button" className="subgroup-reset" onClick={() => resetToneGroup('range')}>
              Reset range
            </button>
          </div>
          <Slider
            label="Shadows"
            value={tone.shadows}
            min={-100}
            max={100}
            step={1}
            format={signed}
            onChange={(shadows) => setTone({ shadows })}
            onReset={() => setTone({ shadows: 0 })}
            hint="Lightens or darkens details mainly in the darker areas."
          />
          <Slider
            label="Highlights"
            value={tone.highlights}
            min={-100}
            max={100}
            step={1}
            format={signed}
            onChange={(highlights) => setTone({ highlights })}
            onReset={() => setTone({ highlights: 0 })}
            hint="Lightens or darkens details mainly in the brighter areas."
          />
          <Slider
            label="Black point"
            value={tone.blackPoint}
            min={0}
            max={254}
            step={1}
            onChange={(blackPoint) => setTone({ blackPoint })}
            onReset={() => setTone({ blackPoint: 0 })}
            hint="Tones at or below this level become full black."
          />
          <Slider
            label="White point"
            value={tone.whitePoint}
            min={1}
            max={255}
            step={1}
            onChange={(whitePoint) => setTone({ whitePoint })}
            onReset={() => setTone({ whitePoint: 255 })}
            hint="Tones at or above this level become full white."
          />
        </div>

        <div className="subgroup">
          <div className="subgroup-head">
            <span className="subgroup-title">Graphite presets</span>
          </div>
          <div className="preset-list">
            {TONE_PRESETS.map((preset) => {
              const active = presetMatchesTone(preset, tone, study);
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`preset-chip${active ? ' is-active' : ''}`}
                  onClick={() => applyPreset(preset)}
                  title={preset.description}
                >
                  <span className="preset-swatch" style={{ background: preset.swatch }} />
                  <span className="preset-text">
                    <span className="preset-name">{preset.name}</span>
                    <span className="preset-desc">{preset.description}</span>
                  </span>
                  {active ? <Check size={14} className="preset-check" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      <Section index="05" title="Value study">
        <Switch
          label="Simplify values"
          description="Reduce the reference to a few clear graphite tones."
          checked={study.enabled}
          onChange={(enabled) => {
            setStudy({ enabled });
            if (enabled) setExportDefaults({ studyInExport: true });
          }}
        />
        <Slider
          label="Number of values"
          value={study.levels}
          min={3}
          max={9}
          step={1}
          onChange={(levels) => setStudy({ levels })}
          onReset={() => setStudy({ levels: 5 })}
          disabled={!study.enabled}
        />
        <div className={`value-strip${study.enabled ? '' : ' is-disabled'}`} aria-label={`${study.levels} value swatches`}>
          {swatches.map((swatch) => (
            <span
              key={swatch.value}
              className={`value-swatch${swatch.value > 140 ? ' light' : ''}`}
              style={{ background: swatch.hex }}
              title={`Value ${swatch.value}`}
            >
              {swatch.value}
            </span>
          ))}
        </div>
        <div className="value-meta">
          <span>Plan light and shadow in {study.levels} groups.</span>
          <span className="mono">{study.levels} levels</span>
        </div>
        <label className={`check-row${!study.enabled ? ' is-disabled' : ''}`}>
          <input
            type="checkbox"
            checked={exportDefaults.studyInExport && study.enabled}
            disabled={!study.enabled}
            onChange={(event) => setExportDefaults({ studyInExport: event.target.checked })}
          />
          Use the value study in exported references
        </label>
      </Section>

      <Section index="06" title="Value distribution" action={
        clippingWarning ? (
          <span className="badge badge-warning">
            <span className="warning-dot" /> clipping
          </span>
        ) : undefined
      }>
        <HistogramView histogram={histogram} levels={study.enabled ? study.levels : undefined} />
        <div className="clip-row">
          <span>Clipped tones</span>
          <span className="clip-values">
            <span className={histogram && histogram.shadowPercent > 1 ? 'warn' : ''}>
              shadows {histogram ? histogram.shadowPercent.toFixed(1) : '0.0'}%
            </span>
            <span className={histogram && histogram.highlightPercent > 1 ? 'warn' : ''}>
              highlights {histogram ? histogram.highlightPercent.toFixed(1) : '0.0'}%
            </span>
          </span>
        </div>
        <p className="info-note">
          Clipping is measured on the processed photo before the grid is drawn. A little is normal; a
          large area can hide drawing detail.
        </p>
      </Section>

      <Section index="07" title="Inspect">
        <div className="source-actions">
          <Button
            variant={compareMode !== 'off' ? 'primary' : 'secondary'}
            size="sm"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setCompareMode('held');
            }}
            onPointerUp={() => setCompareMode('off')}
            onPointerCancel={() => setCompareMode('off')}
            onPointerLeave={() => {
              if (compareMode === 'held') setCompareMode('off');
            }}
            icon={<MousePointer2 size={13} />}
            title="Hold to compare the original photo (or hold C)"
          >
            Hold to compare
          </Button>
          <Button
            variant={compareMode === 'locked' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setCompareMode(compareMode === 'locked' ? 'off' : 'locked')}
            icon={<Eye size={13} />}
            aria-pressed={compareMode === 'locked'}
          >
            {compareMode === 'locked' ? 'Original locked' : 'Lock original'}
          </Button>
        </div>

        <div className="source-actions">
          <Button
            variant={project.composition.mirror ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setMirror(!project.composition.mirror)}
            icon={<FlipHorizontal2 size={13} />}
            aria-pressed={project.composition.mirror}
            title="Mirror reference (M)"
          >
            {project.composition.mirror ? 'Mirrored' : 'Mirror view'}
          </Button>
          <Button
            variant={loupeEnabled ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setLoupeEnabled(!loupeEnabled)}
            icon={<Hand size={13} />}
            aria-pressed={loupeEnabled}
            title="Toggle loupe (L)"
          >
            {loupeEnabled ? 'Loupe on' : 'Loupe'}
          </Button>
        </div>

        <div className="loupe-card">
          <div className="loupe-head">
            <span>Loupe sample</span>
            <span className="mono">0–255</span>
          </div>
          {loupeSample ? (
            <>
              <div className="loupe-reading">
                <div className="loupe-metric">
                  <span className="num">{loupeSample.tone}</span>
                  <span className="lbl">processed</span>
                </div>
                <div className="loupe-metric">
                  <span className="num">{loupeSample.original}</span>
                  <span className="lbl">original</span>
                </div>
              </div>
              <div className="loupe-coords">
                source {loupeSample.sourceX} × {loupeSample.sourceY} px
              </div>
            </>
          ) : (
            <p className="info-note">
              {loupeEnabled
                ? 'Move over the photo to magnify and sample the graphite tone.'
                : 'Enable the loupe or press L, then move over the photo.'}
            </p>
          )}
        </div>
      </Section>

      <Section index="08" title="Export reference">
        <div className="export-quick-modes" role="group" aria-label="Quick export mode">
          {exportModes.map(({ mode, label, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              className={`export-mode-mini${exportDefaults.mode === mode ? ' is-active' : ''}`}
              aria-pressed={exportDefaults.mode === mode}
              onClick={() => setExportDefaults({ mode })}
              title={label}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        <div className="export-summary">
          <div className="export-summary-line">
            <span>Native output</span>
            <strong>{size ? `${size.width.toLocaleString()} × ${size.height.toLocaleString()} px` : '—'}</strong>
          </div>
          <div className="export-summary-line">
            <span>Grid</span>
            <strong>
              {project.grid.columns} × {project.grid.rows}
            </strong>
          </div>
          <div className="export-summary-line">
            <span>Cells</span>
            <strong>
              {size ? describeCells(size.width, project.grid.columns, size.height, project.grid.rows) : '—'}
            </strong>
          </div>
          <div className="export-summary-line">
            <span>Mode</span>
            <strong>
              {exportDefaults.mode === 'combined'
                ? 'Photo + grid'
                : exportDefaults.mode === 'photo'
                  ? 'Photo only'
                  : 'Transparent grid'}
            </strong>
          </div>
        </div>

        {size && size.upscaled ? (
          <div className="inline-status warning">
            <span className="status-dot" /> Native output would upscale this tiny crop. Choose a custom cell
            size intentionally.
          </div>
        ) : null}

        <Button
          variant="primary"
          block
          onClick={() => onOpenExport(undefined, 'png')}
          disabled={!project.source}
          icon={<Download size={15} />}
        >
          Open export dialog
        </Button>
        <div className="source-actions">
          <Button variant="ghost" size="sm" onClick={() => onOpenExport(undefined, 'pdf')} disabled={!project.source}>
            Print PDF…
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenExport(undefined, 'png')}
            disabled={!project.source}
          >
            PNG export…
          </Button>
        </div>
        <p className="info-note">
          Full-resolution processing happens in Rust. No watermark, no upload, no 30 MP ceiling.
        </p>
      </Section>
    </>
  );
}
