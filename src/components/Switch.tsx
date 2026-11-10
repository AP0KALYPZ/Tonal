import { useId } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  showLabel?: boolean;
}

export function Switch({ checked, onChange, label, description, disabled, showLabel }: SwitchProps) {
  const id = useId();
  return (
    <div className={`switch-row${disabled ? ' is-disabled' : ''}`}>
      {showLabel === false ? null : (
        <span className="switch-text">
          <label htmlFor={id} className="switch-label">
            {label}
          </label>
          {description ? <span className="switch-hint">{description}</span> : null}
        </span>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={showLabel === false ? label : undefined}
        disabled={disabled}
        className={`switch${checked ? ' is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}
