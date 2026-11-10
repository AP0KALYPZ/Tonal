import { useId, type CSSProperties } from 'react';
import { RotateCcw } from 'lucide-react';
import { useAppStore } from '../state/store';
import { clamp } from '../lib/geometry';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onReset?: () => void;
  format?: (value: number) => string;
  hint?: string;
  disabled?: boolean;
  labelWidth?: number;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onReset,
  format,
  hint,
  disabled,
  labelWidth,
}: SliderProps) {
  const id = useId();
  const beginGesture = useAppStore((state) => state.beginGesture);
  const endGesture = useAppStore((state) => state.endGesture);
  const percent = ((clamp(value, min, max) - min) / (max - min)) * 100;
  const display = format ? format(value) : String(value);
  const style = { '--slider-fill': `${percent}%` } as CSSProperties;

  return (
    <div className={`slider-row${disabled ? ' is-disabled' : ''}`}>
      <div className="slider-head">
        <label htmlFor={id} className="slider-label" title={hint}>
          {label}
        </label>
        <span className="slider-readout" aria-live="off">
          {display}
        </span>
        {onReset ? (
          <button
            type="button"
            className="slider-reset"
            onClick={onReset}
            aria-label={`Reset ${label}`}
            title={`Reset ${label}`}
            tabIndex={0}
          >
            <RotateCcw size={11} />
          </button>
        ) : null}
      </div>
      <input
        id={id}
        type="range"
        className="slider"
        style={style}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={display}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onPointerDown={beginGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onBlur={endGesture}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? (
        <span id={`${id}-hint`} className="visually-hidden">
          {hint}
        </span>
      ) : null}
      {labelWidth ? null : null}
    </div>
  );
}
