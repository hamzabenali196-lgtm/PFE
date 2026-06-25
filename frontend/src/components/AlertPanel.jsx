import { Bell, Camera, Flame, Radar, Volume2, VolumeX } from 'lucide-react';

export default function AlertPanel({ alert, photo, fireAlert, firePhoto, obstacle, voiceEnabled, onToggleVoice }) {
  const humanClass = alert?.detected === false ? 'clear' : alert ? 'active' : '';
  const showHumanPhoto = alert?.detected !== false && photo;

  const fireClass = fireAlert?.detected === false ? 'clear' : fireAlert ? 'fire' : '';
  const showFirePhoto = fireAlert?.detected !== false && firePhoto;

  // obstacle: red when something's in range, green when the path is clear, neutral until first reading
  const obstacleClass = obstacle?.detected ? 'active' : obstacle ? 'clear' : '';
  const obstacleText = !obstacle ? 'No reading yet' : obstacle.detected ? 'Obstacle detected' : 'Path clear';

  return (
    <section className="tool-panel alert-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Detection</p>
          <h2>Alerts</h2>
        </div>
        <Bell size={22} aria-hidden="true" />
      </div>

      <p className="alert-section-label">Human Presence</p>
      <div className={`alert-message ${humanClass}`}>
        {alert?.text || 'No detection yet'}
      </div>

      <div className="snapshot">
        {showHumanPhoto ? (
          <img src={`data:image/jpeg;base64,${photo}`} alt="Human detection snapshot" />
        ) : (
          <div>
            <Camera size={24} aria-hidden="true" />
            <span>No snapshot yet</span>
          </div>
        )}
      </div>

      <p className="alert-section-label alert-section-label--fire">Fire Detection</p>
      <div className={`alert-message ${fireClass}`}>
        <Flame size={16} className="alert-fire-icon" aria-hidden="true" />
        {fireAlert?.text || 'No fire detected'}
      </div>

      <div className="snapshot">
        {showFirePhoto ? (
          <img src={`data:image/jpeg;base64,${firePhoto}`} alt="Fire detection snapshot" />
        ) : (
          <div>
            <Flame size={24} aria-hidden="true" />
            <span>No fire snapshot</span>
          </div>
        )}
      </div>

      <p className="alert-section-label">Obstacle (IR)</p>
      <div className={`alert-message ${obstacleClass}`}>
        <Radar size={16} className="alert-fire-icon" aria-hidden="true" />
        {obstacleText}
      </div>

      <button
        type="button"
        className="voice-toggle"
        onClick={onToggleVoice}
        aria-pressed={voiceEnabled}
        title="Toggle browser voice"
      >
        {voiceEnabled ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
        <span>{voiceEnabled ? 'Voice on' : 'Voice off'}</span>
      </button>
    </section>
  );
}
