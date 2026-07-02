import { Bot, Circle, Flame, RotateCw, Search, TriangleAlert, User } from 'lucide-react';

// What the robot is doing right now, derived from the live detection signals. In Phase 1
// this is computed in the browser from the same alert/obstacle data the manual dashboard
// already receives; Phase 3 can replace it with an authoritative status from the worker.
function deriveStatus({ obstacle, alert, fireAlert }) {
  if (obstacle?.detected) {
    return { label: 'Obstacle ahead — turning right', tone: 'turn', Icon: RotateCw };
  }
  if (fireAlert?.detected) {
    return { label: 'Fire spotted — approaching', tone: 'fire', Icon: Flame };
  }
  if (alert?.detected) {
    return { label: 'Human spotted — approaching', tone: 'target', Icon: User };
  }
  return { label: 'Searching — scanning area', tone: 'search', Icon: Search };
}

export default function AutoStatusPanel({
  alert, fireAlert, obstacle, recording,
  turnMs, onTurnMsChange, onTestTurn
}) {
  const status = deriveStatus({ obstacle, alert, fireAlert });
  const { Icon } = status;

  const chips = [
    { key: 'human', label: 'Human', on: alert?.detected === true, Icon: User },
    { key: 'fire', label: 'Fire', on: fireAlert?.detected === true, Icon: Flame },
    { key: 'obstacle', label: 'Obstacle', on: obstacle?.detected === true, Icon: TriangleAlert },
  ];

  return (
    <section className="tool-panel auto-status-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Autonomous</p>
          <h2>Auto Patrol</h2>
        </div>
        <span className={`auto-rec${recording ? ' on' : ''}`}>
          <Circle size={9} aria-hidden="true" />
          {recording ? 'REC' : 'Idle'}
        </span>
      </div>

      <div className={`auto-status-banner ${status.tone}`}>
        <Icon size={20} aria-hidden="true" />
        <span>{status.label}</span>
        {status.tone === 'search' ? <span className="auto-scan-dot" aria-hidden="true" /> : null}
      </div>

      <div className="auto-chip-row">
        {chips.map((chip) => (
          <div key={chip.key} className={`auto-chip${chip.on ? ' on' : ''}`}>
            <chip.Icon size={15} aria-hidden="true" />
            <span>{chip.label}</span>
            <strong>{chip.on ? 'Yes' : '—'}</strong>
          </div>
        ))}
      </div>

      <div className="auto-cal">
        <p className="ctrl-section-label">90° turn calibration</p>
        <div className="auto-cal-row">
          <div className="auto-cal-input">
            <input
              type="number"
              min="200"
              max="6000"
              step="50"
              value={turnMs}
              onChange={(e) => onTurnMsChange?.(Number(e.target.value))}
              aria-label="Turn duration in milliseconds"
            />
            <span>ms</span>
          </div>
          <button type="button" className="auto-test-btn" onClick={onTestTurn}>
            <RotateCw size={16} aria-hidden="true" />
            Test turn
          </button>
        </div>
        <p className="auto-cal-hint">
          <Bot size={13} aria-hidden="true" />
          Tune until the robot turns a real 90°, then we lock it in as the default.
        </p>
      </div>
    </section>
  );
}
