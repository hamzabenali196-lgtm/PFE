import { Camera, Clock3, Images, Square, Video, Volume2 } from 'lucide-react';

export default function LiveCamera({ frame, frameCount, lastFrameAt, video, onStart, onStop }) {
  const recording = Boolean(video?.recording);

  async function testSound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const audioContext = new AudioContext({ sampleRate: 16000 });
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 720;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.28);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);
  }

  return (
    <section className="tool-panel live-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Vision</p>
          <h2>Live Camera</h2>
        </div>
        <Camera size={22} aria-hidden="true" />
      </div>

      <div className="video-shell">
        {frame ? (
          <img src={`data:image/jpeg;base64,${frame}`} alt="Robot live camera" />
        ) : (
          <div className="video-empty">Waiting for robot/flux</div>
        )}
      </div>

      <div className="camera-actions">
        <button type="button" onClick={testSound} title="Test browser audio">
          <Volume2 size={18} aria-hidden="true" />
          <span>Test sound</span>
        </button>
        <button
          type="button"
          className={recording ? 'active record-button' : 'record-button'}
          onClick={recording ? onStop : onStart}
          aria-pressed={recording}
        >
          {recording ? <Square size={18} aria-hidden="true" /> : <Video size={18} aria-hidden="true" />}
          <span>{recording ? 'Stop record' : 'Record'}</span>
        </button>
      </div>

      <div className="camera-stats">
        <div>
          <Images size={18} aria-hidden="true" />
          <span>{frameCount || 0} frames</span>
        </div>
        <div>
          <Clock3 size={18} aria-hidden="true" />
          <span>{formatTime(lastFrameAt)}</span>
        </div>
      </div>
    </section>
  );
}

function formatTime(value) {
  if (!value) return 'No frame yet';
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
