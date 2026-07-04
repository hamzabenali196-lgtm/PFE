import { Flame, ShieldCheck, User } from 'lucide-react';

// Full-screen alert shown while the robot is halted after detecting a fire or
// a human in auto mode. It stays up (with the siren) until the operator
// authorizes the robot to move again.
export default function MotionAlertOverlay({ alert, onAuthorize }) {
  if (!alert) return null;

  const isFire = alert.kind === 'fire';

  return (
    <div className={`motion-alert-overlay${isFire ? ' fire' : ' human'}`} role="alertdialog" aria-live="assertive">
      <div className="motion-alert-box">
        <div className="motion-alert-icon">
          {isFire ? <Flame size={72} aria-hidden="true" /> : <User size={72} aria-hidden="true" />}
        </div>
        <h2>{isFire ? 'FIRE DETECTED' : 'HUMAN DETECTED'}</h2>
        <p>The robot has stopped and is holding position, waiting for your authorization.</p>
        <button type="button" className="motion-alert-btn" onClick={onAuthorize}>
          <ShieldCheck size={20} aria-hidden="true" />
          Authorize robot to move
        </button>
      </div>
    </div>
  );
}
