import { Bot, Gamepad2 } from 'lucide-react';

// Manual = the existing hands-on dashboard. Auto = autonomous patrol (forward + head
// scan, turns right on an IR obstacle, records non-stop). The accent flips amber in Auto
// so it's always obvious the robot is driving itself.
export default function ModeToggle({ mode = 'manual', onChange, disabled = false }) {
  return (
    <div className="mode-toggle" role="group" aria-label="Operating mode">
      <button
        type="button"
        className={`mode-toggle-btn${mode !== 'auto' ? ' active' : ''}`}
        onClick={() => onChange?.('manual')}
        disabled={disabled}
        aria-pressed={mode !== 'auto'}
      >
        <Gamepad2 size={16} aria-hidden="true" />
        Manual
      </button>
      <button
        type="button"
        className={`mode-toggle-btn mode-toggle-btn--auto${mode === 'auto' ? ' active' : ''}`}
        onClick={() => onChange?.('auto')}
        disabled={disabled}
        aria-pressed={mode === 'auto'}
      >
        <Bot size={16} aria-hidden="true" />
        Auto
      </button>
    </div>
  );
}
