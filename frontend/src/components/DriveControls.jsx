import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Gauge } from 'lucide-react';
import { useRef, useState } from 'react';

const DIRECTIONS = [
  { id: 'forward',  label: 'Forward',  icon: <ArrowUp size={28} />,    gridArea: 'forward'  },
  { id: 'left',     label: 'Left',     icon: <ArrowLeft size={28} />,   gridArea: 'left'     },
  { id: 'backward', label: 'Backward', icon: <ArrowDown size={28} />,   gridArea: 'backward' },
  { id: 'right',    label: 'Right',    icon: <ArrowRight size={28} />,  gridArea: 'right'    },
];

export default function DriveControls({ onDriveCommand }) {
  const [active, setActive] = useState('');
  const activeRef = useRef('');
  const [speed, setSpeed] = useState(5);

  function handleSpeedChange(e) {
    const val = Number(e.target.value);
    setSpeed(val);
    onDriveCommand(`speed:${val}`);
  }

  function startDir(id) {
    if (activeRef.current === id) return;
    activeRef.current = id;
    setActive(id);
    onDriveCommand(`start:${id}`);
  }

  function stopDir(id) {
    if (activeRef.current !== id) return;
    activeRef.current = '';
    setActive('');
    onDriveCommand('stand');
  }

  return (
    <section className="tool-panel">
      <div className="panel-heading">
        <h2>Drive</h2>
      </div>

      <div className="dpad-wrap">
        <div className="dpad-area">
          <div className="dpad" aria-label="Direction controls">
            {DIRECTIONS.map((dir) => (
              <button
                key={dir.id}
                type="button"
                className={`dpad-btn${active === dir.id ? ' dpad-btn--active' : ''}`}
                style={{ gridArea: dir.gridArea }}
                onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); startDir(dir.id); }}
                onPointerUp={(e) => { e.preventDefault(); e.currentTarget.releasePointerCapture(e.pointerId); stopDir(dir.id); }}
                onPointerCancel={(e) => { e.preventDefault(); stopDir(dir.id); }}
                onPointerLeave={(e) => { e.preventDefault(); stopDir(dir.id); }}
                onContextMenu={(e) => e.preventDefault()}
                draggable="false"
                aria-label={dir.label}
                aria-pressed={active === dir.id}
              >
                {dir.icon}
              </button>
            ))}
            <div className="dpad-center" aria-hidden="true" />
          </div>

          <div className="height-controls" aria-label="Body height">
            <button
              type="button"
              className="height-btn"
              onClick={() => onDriveCommand('height_down')}
              aria-label="Raise body"
            >
              <ArrowUp size={20} />
              <span>High</span>
            </button>
            <button
              type="button"
              className="height-btn"
              onClick={() => onDriveCommand('height_up')}
              aria-label="Lower body"
            >
              <ArrowDown size={20} />
              <span>Low</span>
            </button>
          </div>
        </div>

        <div className="speed-control">
          <div className="speed-header">
            <Gauge size={15} aria-hidden="true" />
            <span className="speed-label">Speed</span>
            <span className="speed-value">{speed}<span className="speed-max">/10</span></span>
          </div>
          <input
            type="range"
            min="1" max="10" step="1"
            value={speed}
            onChange={handleSpeedChange}
            className="speed-slider"
            style={{ '--pct': `${(speed - 1) / 9 * 100}%` }}
            aria-label="Robot speed"
          />
          <div className="speed-markers">
            <span>Slow</span>
            <span>Fast</span>
          </div>
        </div>
      </div>
    </section>
  );
}
