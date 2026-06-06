import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Hand, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

const DRIVE_BUTTONS = [
  { key: 'Z', label: 'Forward', command: 'forward', icon: <ArrowUp size={18} aria-hidden="true" /> },
  { key: 'Q', label: 'Left', command: 'left', icon: <ArrowLeft size={18} aria-hidden="true" /> },
  { key: 'S', label: 'Backward', command: 'backward', icon: <ArrowDown size={18} aria-hidden="true" /> },
  { key: 'D', label: 'Right', command: 'right', icon: <ArrowRight size={18} aria-hidden="true" /> }
];

export default function ServoControls({ onHello, onDriveCommand }) {
  const [activeDrive, setActiveDrive] = useState('');

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
        <button type="button" className="button-primary" onClick={onHello} title="Saluer" aria-label="Saluer">
          <Hand size={18} aria-hidden="true" />
          <span>Wave</span>
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
    </section>
  );
}
