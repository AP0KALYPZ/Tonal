import { useEffect, useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { clamp, clampInteger } from '../lib/geometry';

interface NumberStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  hint?: string;
}

export function NumberStepper({
  label,
  value,
  min,
  max,
  onChange,
  step = 1,
  suffix,
  disabled,
  hint,
}: NumberStepperProps) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!focused) {
      setText(String(value));
      setError(null);
    }
  }, [value, focused]);

  const commit = (raw: string) => {
    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed)) {
      setError(`Enter a number between ${min} and ${max}.`);
      setText(String(value));
      return;
    }
    const rounded = clampInteger(parsed, min, max);
    if (rounded !== parsed) {
      setError(`Adjusted to the nearest allowed value (${min}–${max}).`);
    } else {
      setError(null);
    }
    setText(String(rounded));
    if (rounded !== value) onChange(rounded);
  };

  const nudge = (delta: number) => {
    const next = clamp(value + delta, min, max);
    setError(null);
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className={`stepper-field${disabled ? ' is-disabled' : ''}`}>
      <label htmlFor={id} className="field-label" title={hint}>
        {label}
      </label>
      <div className="stepper">
        <button
          type="button"
          className="stepper-btn"
          aria-label={`Decrease ${label}`}
          disabled={disabled || value <= min}
          onClick={() => nudge(-step)}
        >
          <Minus size={13} />
        </button>
        <div className="stepper-input-wrap">
          <input
            id={id}
            role="spinbutton"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-label={label}
            className="stepper-input"
            inputMode="numeric"
            value={text}
            disabled={disabled}
            onFocus={(event) => {
              setFocused(true);
              event.currentTarget.select();
            }}
            onBlur={(event) => {
              setFocused(false);
              commit(event.currentTarget.value);
            }}
            onChange={(event) => {
              setText(event.target.value);
              if (!focused) setFocused(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commit(event.currentTarget.value);
                event.currentTarget.blur();
              } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                nudge((event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 5 : 1));
              } else if (event.key === 'Escape') {
                setText(String(value));
                setError(null);
                event.currentTarget.blur();
              }
            }}
          />
          {suffix ? <span className="stepper-suffix">{suffix}</span> : null}
        </div>
        <button
          type="button"
          className="stepper-btn"
          aria-label={`Increase ${label}`}
          disabled={disabled || value >= max}
          onClick={() => nudge(step)}
        >
          <Plus size={13} />
        </button>
      </div>
      {error ? (
        <span className="field-error" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
