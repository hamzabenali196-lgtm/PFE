import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Hand, SlidersHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';

const DIRECTIONS = [
  { id: 'forward',  label: 'Forward',  icon: <ArrowUp size={26} />,    gridArea: 'forward'  },
  { id: 'left',     label: 'Left',     icon: <ArrowLeft size={26} />,   gridArea: 'left'     },
  { id: 'backward', label: 'Backward', icon: <ArrowDown size={26} />,   gridArea: 'backward' },
  { id: 'right',    label: 'Right',    icon: <ArrowRight size={26} />,  gridArea: 'right'    },
];

export default function ServoControls({ onHello, onDriveCommand }) {
  const [active, setActive] = useState('');
  const activeRef = useRef('');

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

        <button
          type="button"
          className="wave-btn"
          onClick={onHello}
          aria-label="Wave"
        >
          <Hand size={20} aria-hidden="true" />
          <span>Wave</span>
        </button>
      </div>
    </section>
  );
}
