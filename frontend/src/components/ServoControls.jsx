import { Hand, Home, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function ServoControls({ onHome, onHello, onServo }) {
  const [values, setValues] = useState({ oy: 90, oz: 90 });

  useEffect(() => {
    setValues({ oy: 90, oz: 90 });
  }, []);

  function update(axis, value) {
    setValues((current) => ({ ...current, [axis]: Number(value) }));
  }

  function commit(axis) {
    onServo(axis, values[axis]);
  }

  return (
    <section className="tool-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Control</p>
          <h2>Servos</h2>
        </div>
        <SlidersHorizontal size={22} aria-hidden="true" />
      </div>

      <div className="button-row">
        <button type="button" onClick={onHome} title="Position repos" aria-label="Position repos">
          <Home size={18} aria-hidden="true" />
          <span>Repos</span>
        </button>
        <button type="button" onClick={onHello} title="Saluer" aria-label="Saluer">
          <Hand size={18} aria-hidden="true" />
          <span>Saluer</span>
        </button>
        <button type="button" onClick={() => onServo('oy', 90)} title="Center horizontal rotation" aria-label="Center horizontal rotation">
          <RotateCcw size={18} aria-hidden="true" />
          <span>Center</span>
        </button>
      </div>

      <ServoSlider
        label="Rotation horizontale"
        axis="oy"
        value={values.oy}
        onChange={update}
        onCommit={commit}
      />
      <ServoSlider
        label="Hauteur extension"
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
