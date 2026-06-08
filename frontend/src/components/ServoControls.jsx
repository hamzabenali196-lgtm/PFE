import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronsDown, ChevronsUp, Gauge, Hand, MoveHorizontal, Radio, SlidersHorizontal, Waves, Wind, Zap } from 'lucide-react';
import { useRef, useState } from 'react';

const DIRECTIONS = [
  { id: 'forward',  label: 'Forward',  icon: <ArrowUp size={26} />,    gridArea: 'forward'  },
  { id: 'left',     label: 'Left',     icon: <ArrowLeft size={26} />,   gridArea: 'left'     },
  { id: 'backward', label: 'Backward', icon: <ArrowDown size={26} />,   gridArea: 'backward' },
  { id: 'right',    label: 'Right',    icon: <ArrowRight size={26} />,  gridArea: 'right'    },
];

const ACTIONS = [
  { id: 'bow',    label: 'Bow',    icon: <ChevronsDown size={20} /> },
  { id: 'shake',  label: 'Shake',  icon: <Zap size={20} /> },
  { id: 'wave',   label: 'Wave',   icon: <Waves size={20} /> },
  { id: 'bounce', label: 'Bounce', icon: <ChevronsUp size={20} /> },
  { id: 'sway',   label: 'Sway',   icon: <MoveHorizontal size={20} /> },
  { id: 'tiptoe', label: 'Tiptoe', icon: <Wind size={20} /> },
  { id: 'ripple', label: 'Ripple', icon: <Radio size={20} /> },
  { id: 'pulse',  label: 'Pulse',  icon: <ChevronsUp size={20} /> },
];

export default function ServoControls({ onHello, onDriveCommand }) {
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
        <div>
          <p className="eyebrow">Control</p>
          <h2>Motion Control</h2>
        </div>
        <SlidersHorizontal size={20} aria-hidden="true" />
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
              <ArrowUp size={18} />
              <span>High</span>
            </button>
            <button
              type="button"
              className="height-btn"
              onClick={() => onDriveCommand('height_up')}
              aria-label="Lower body"
            >
              <ArrowDown size={18} />
              <span>Low</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          className="wave-btn"
          onClick={onHello}
          aria-label="Wave"
        >
          <Hand size={20} aria-hidden="true" />
          <span>Wave</span>
        </button>

        <div className="speed-control">
          <div className="speed-header">
            <Gauge size={14} aria-hidden="true" />
            <span className="speed-label">Speed</span>
            <span className="speed-value">{speed}<span className="speed-max">/10</span></span>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            step="1"
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

        <div className="actions-row">
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              className="action-btn"
              onClick={() => onDriveCommand(action.id)}
              aria-label={action.label}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </div>

      </div>
    </section>
  );
}
