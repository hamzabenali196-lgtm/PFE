import { Bell, Camera, Volume2, VolumeX } from 'lucide-react';

export default function AlertPanel({ alert, photo, voiceEnabled, onToggleVoice }) {
  const stateClass = alert?.detected === false ? 'clear' : alert ? 'active' : '';
  const showPhoto = alert?.detected !== false && photo;

  return (
    <section className="tool-panel alert-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Detection</p>
          <h2>Latest Alert</h2>
        </div>
        <Bell size={22} aria-hidden="true" />
      </div>

      <div className={`alert-message ${stateClass}`}>
        {alert?.text || 'No detection yet'}
      </div>

      <div className="snapshot">
        {showPhoto ? (
          <img src={`data:image/jpeg;base64,${photo}`} alt="Latest detection snapshot" />
        ) : (
          <div>
            <Camera size={24} aria-hidden="true" />
            <span>No snapshot</span>
          </div>
        )}
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
