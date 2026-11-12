import { useCallback, useRef, useState } from 'react';

interface Props {
  min?: number;
  max?: number;
  /** Starting position; the knob then manages its own value internally (uncontrolled) — the
   * caller only needs the live value as it changes, via `onChange`. */
  defaultValue?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (value: number) => void;
}

const MIN_ANGLE = -135;
const MAX_ANGLE = 135;
/** px of vertical drag to sweep the whole range — matches the feel of a real knob: a deliberate
 * drag for a big change, fine control near the end of a short one. */
const DRAG_RANGE_PX = 150;

function angleFor(value: number, min: number, max: number): number {
  const t = max === min ? 0 : (value - min) / (max - min);
  return MIN_ANGLE + t * (MAX_ANGLE - MIN_ANGLE);
}

/** A round, rotary pedal-knob control (drag vertically, or use arrow keys once focused) — the
 * CC Reference page's hand-off from a plain `<input type="range">`: that was hard to use for a
 * quick test-send (see docs/MIDI_MAPPING_NOTES.md's CC Reference section). Visual only; value
 * semantics (min/max/step, a turn = a change) match a native range input, with the same
 * `role="slider"` + `aria-value*` contract for assistive tech. */
export function Knob({ min = 0, max = 127, defaultValue = 64, step = 1, disabled, ariaLabel, onChange }: Props) {
  const [value, setValue] = useState(defaultValue);
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null);

  const commit = useCallback(
    (next: number) => {
      const clamped = Math.min(max, Math.max(min, Math.round(next / step) * step));
      setValue(clamped);
      onChange(clamped);
    },
    [min, max, step, onChange],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startValue: value };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const deltaY = dragRef.current.startY - e.clientY; // up = increase
    const deltaValue = (deltaY / DRAG_RANGE_PX) * (max - min);
    commit(dragRef.current.startValue + deltaValue);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = (max - min) / 10 || step;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') commit(value + step);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') commit(value - step);
    else if (e.key === 'PageUp') commit(value + big);
    else if (e.key === 'PageDown') commit(value - big);
    else if (e.key === 'Home') commit(min);
    else if (e.key === 'End') commit(max);
    else return;
    e.preventDefault();
  };

  const angle = angleFor(value, min, max);

  return (
    <div
      className={`knob${disabled ? ' knob--disabled' : ''}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <div className="knob__dial" style={{ transform: `rotate(${angle}deg)` }}>
        <div className="knob__pointer" />
      </div>
    </div>
  );
}
