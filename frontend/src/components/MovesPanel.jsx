import { ChevronsDown, ChevronsUp, Hand, MoveHorizontal, Radio, Waves, Wind, Zap } from 'lucide-react';

const ACTIONS = [
  { id: 'bow',    label: 'Bow',    icon: <ChevronsDown size={22} /> },
  { id: 'shake',  label: 'Shake',  icon: <Zap size={22} /> },
  { id: 'wave',   label: 'Wave',   icon: <Waves size={22} /> },
  { id: 'bounce', label: 'Bounce', icon: <ChevronsUp size={22} /> },
  { id: 'sway',   label: 'Sway',   icon: <MoveHorizontal size={22} /> },
  { id: 'tiptoe', label: 'Tiptoe', icon: <Wind size={22} /> },
  { id: 'ripple', label: 'Ripple', icon: <Radio size={22} /> },
  { id: 'pulse',  label: 'Pulse',  icon: <ChevronsUp size={22} /> },
];

export default function MovesPanel({ onHello, onDriveCommand }) {
  return (
    <section className="tool-panel">
      <div className="panel-heading">
        <h2>Moves</h2>
      </div>

      <div className="moves-wrap">
        <button
          type="button"
          className="wave-btn"
          onClick={onHello}
          aria-label="Wave hello"
        >
          <Hand size={22} aria-hidden="true" />
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
