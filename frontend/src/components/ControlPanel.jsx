import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp,
  ChevronsDown, ChevronsUp, Crosshair, Gauge,
  Hand, MoveHorizontal, Radio, Waves, Wind, Zap
} from 'lucide-react';
import { useRef, useState } from 'react';

const DIRECTIONS = [
  { id: 'forward',  label: 'Forward',  icon: <ArrowUp size={28} />,   gridArea: 'forward'  },
  { id: 'left',     label: 'Left',     icon: <ArrowLeft size={28} />, gridArea: 'left'     },
  { id: 'backward', label: 'Backward', icon: <ArrowDown size={28} />, gridArea: 'backward' },
  { id: 'right',    label: 'Right',    icon: <ArrowRight size={28} />,gridArea: 'right'    },
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

export default function ControlPanel({ onHello, onDriveCommand, headPos, onHeadMove }) {
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

  function centerHead() {
    onHeadMove('oz', 90);
    onHeadMove('oy', 60);
  }

  return (
    <section className="tool-panel control-panel">

      {/* ── Section 1: Movement ── */}
      <div className="ctrl-section">
        <p className="ctrl-section-label">Movement</p>

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
            <button type="button" className="height-btn" onClick={() => onDriveCommand('height_down')} aria-label="Raise body">
              <ArrowUp size={20} />
              <span>High</span>
            </button>
            <button type="button" className="height-btn" onClick={() => onDriveCommand('height_up')} aria-label="Lower body">
              <ArrowDown size={20} />
              <span>Low</span>
            </button>
          </div>
        </div>

        <div className="speed-control">
          <div className="speed-header">
            <Gauge size={14} aria-hidden="true" />
            <span className="speed-label">Speed</span>
            <span className="speed-value">{speed}<span className="speed-max">/10</span></span>
          </div>
          <input
            type="range" min="1" max="10" step="1"
            value={speed}
            onChange={handleSpeedChange}
            className="speed-slider"
            style={{ '--pct': `${(speed - 1) / 9 * 100}%` }}
            aria-label="Robot speed"
          />
          <div className="speed-markers"><span>Slow</span><span>Fast</span></div>
        </div>
      </div>

      {/* ── Section 2: Head Camera ── */}
      <div className="ctrl-section">
        <div className="ctrl-section-label-row">
          <p className="ctrl-section-label">Head Camera</p>
          <button type="button" className="head-center-btn" onClick={centerHead} aria-label="Center head">
            <Crosshair size={13} />
            Center
          </button>
        </div>

        <div className="head-slider-row">
          <div className="head-slider-header">
            <span className="head-slider-label">Pan</span>
            <strong className="head-slider-val">{headPos.pan}°</strong>
          </div>
          <input
            type="range" min="30" max="150" step="1"
            value={headPos.pan}
            onChange={(e) => onHeadMove('oz', Number(e.target.value))}
            className="head-slider"
            style={{ '--pct': `${(headPos.pan - 30) / 120 * 100}%` }}
            aria-label="Head pan"
          />
          <div className="head-slider-markers"><span>Left</span><span>Right</span></div>
        </div>

        <div className="head-slider-row head-slider-row--tilt">
          <div className="head-slider-header">
            <span className="head-slider-label">Tilt</span>
            <strong className="head-slider-val">{headPos.tilt}°</strong>
          </div>
          <div className="head-slider-vertical-wrap">
            <span className="head-slider-vlabel">Up</span>
            <div className="head-slider-vertical-track">
              <input
                type="range" min="0" max="120" step="1"
                value={headPos.tilt}
                onChange={(e) => onHeadMove('oy', Number(e.target.value))}
                className="head-slider head-slider--vertical"
                style={{ '--pct': `${headPos.tilt / 120 * 100}%` }}
                aria-label="Head tilt"
              />
            </div>
            <span className="head-slider-vlabel">Down</span>
          </div>
        </div>
      </div>

      {/* ── Section 3: Moves ── */}
      <div className="ctrl-section">
        <p className="ctrl-section-label">Moves</p>

        <button type="button" className="wave-btn" onClick={onHello} aria-label="Wave hello">
          <Hand size={20} aria-hidden="true" />
          Wave Hello
        </button>

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
