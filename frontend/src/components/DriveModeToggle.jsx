import { Footprints, Zap } from 'lucide-react';

// Which actuators answer the drive controls: the six leg servos (tripod gait) or
// the L298N DC motors. Independent of Manual/Auto — both combine freely. Switching
// to Motors lifts the legs off the ground first; switching back stands them up.
export default function DriveModeToggle({ driveMode = 'legs', onChange, disabled = false }) {
  return (
    <div className="mode-toggle" role="group" aria-label="Drive mode">
      <button
        type="button"
        className={`mode-toggle-btn${driveMode !== 'motors' ? ' active' : ''}`}
        onClick={() => onChange?.('legs')}
        disabled={disabled}
        aria-pressed={driveMode !== 'motors'}
      >
        <Footprints size={16} aria-hidden="true" />
        Walk
      </button>
      <button
        type="button"
        className={`mode-toggle-btn mode-toggle-btn--motors${driveMode === 'motors' ? ' active' : ''}`}
        onClick={() => onChange?.('motors')}
        disabled={disabled}
        aria-pressed={driveMode === 'motors'}
      >
        <Zap size={16} aria-hidden="true" />
        Motors
      </button>
    </div>
  );
}
