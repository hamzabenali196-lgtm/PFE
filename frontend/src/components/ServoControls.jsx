import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Hand, Home, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';

const DRIVE_BUTTONS = [
  { key: 'Z', label: 'Left', command: 'left', icon: <ArrowUp size={18} aria-hidden="true" /> },
  { key: 'Q', label: 'Forward', command: 'run', icon: <ArrowLeft size={18} aria-hidden="true" /> },
  { key: 'S', label: 'Right', command: 'right', icon: <ArrowDown size={18} aria-hidden="true" /> },
  { key: 'D', label: 'Backward', command: 'backward', icon: <ArrowRight size={18} aria-hidden="true" /> }
];

export default function ServoControls({ onHome, onHello, onServo, onDriveCommand }) {
  const [values, setValues] = useState({ oy: 90, oz: 90 });
  const [activeDrive, setActiveDrive] = useState('');

  useEffect(() => {
    setValues({ oy: 90, oz: 90 });
  }, []);

  function update(axis, value) {
    setValues((current) => ({ ...current, [axis]: Number(value) }));
  }

  function commit(axis) {
    onServo(axis, values[axis]);
  }

  function startDrive(button) {
    setActiveDrive(button.key);
    onDriveCommand(`start:${button.command}`);
  }

  function stopDrive(button) {
    setActiveDrive((current) => (current === button.key ? '' : current));
    onDriveCommand('stand');
  }

  return (
    <section className="tool-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Control</p>
          <h2>Motion Control</h2>
        </div>
        <SlidersHorizontal size={22} aria-hidden="true" />
      </div>

      <div className="button-row">
        <button type="button" className="button-primary" onClick={onHome} title="Rest position" aria-label="Rest position">
          <Home size={18} aria-hidden="true" />
          <span>Rest</span>
        </button>
        <button type="button" onClick={onHello} title="Saluer" aria-label="Saluer">
          <Hand size={18} aria-hidden="true" />
          <span>Wave</span>
        </button>
        <button type="button" onClick={() => onServo('oy', 90)} title="Center horizontal rotation" aria-label="Center horizontal rotation">
          <RotateCcw size={18} aria-hidden="true" />
          <span>Center</span>
        </button>
      </div>

      <div className="drive-command-pad" aria-label="Drive controls">
        {DRIVE_BUTTONS.map((button) => (
          <button
            key={button.key}
            type="button"
            className={activeDrive === button.key ? 'active' : ''}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              startDrive(button);
            }}
            onPointerUp={(event) => {
              event.preventDefault();
              event.currentTarget.releasePointerCapture?.(event.pointerId);
              stopDrive(button);
            }}
            onPointerCancel={(event) => {
              event.preventDefault();
              stopDrive(button);
            }}
            onPointerLeave={(event) => {
              event.preventDefault();
              stopDrive(button);
            }}
            title={button.label}
            aria-label={button.label}
            aria-pressed={activeDrive === button.key}
          >
            {button.icon}
            <strong>{button.key}</strong>
          </button>
        ))}
      </div>

      <ServoSlider
        label="Horizontal rotation"
        axis="oy"
        value={values.oy}
        onChange={update}
        onCommit={commit}
      />
      <ServoSlider
        label="Height extension"
        axis="oz"
        value={values.oz}
        onChange={update}
        onCommit={commit}
      />
    </section>
  );
}

function ServoSlider({ label, axis, value, onChange, onCommit }) {
  return (
    <label className="servo-slider">
      <span>
        <strong>{label}</strong>
        <em>{value} deg</em>
      </span>
      <input
        type="range"
        min="0"
        max="180"
        step="1"
        value={value}
        onChange={(event) => onChange(axis, event.target.value)}
        onPointerUp={() => onCommit(axis)}
        onKeyUp={(event) => {
          if (event.key === 'Enter') onCommit(axis);
        }}
        onBlur={() => onCommit(axis)}
      />
    </label>
  );
}
