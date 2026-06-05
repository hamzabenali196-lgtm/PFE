import { Download, Film, Square, Trash2, Video } from 'lucide-react';
import { API_URL } from '../lib/api.js';

export default function VideoRecorder({ video, videos, onStart, onStop, onDelete }) {
  const recording = Boolean(video?.recording);

  return (
    <section className="tool-panel video-record-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Media</p>
          <h2>Recorder</h2>
        </div>
        <Film size={22} aria-hidden="true" />
      </div>

      <div className="audio-row">
        <button
          type="button"
          className={recording ? 'active record-button' : 'record-button'}
          onClick={recording ? onStop : onStart}
          aria-pressed={recording}
        >
          {recording ? <Square size={18} aria-hidden="true" /> : <Video size={18} aria-hidden="true" />}
          <span>{recording ? 'Stop record' : 'Record'}</span>
        </button>
        <strong className={recording ? 'recording-state active' : 'recording-state'}>
          {recording ? 'Recording' : `${videos?.length || 0} saved`}
        </strong>
      </div>

      {video?.error ? <p className="mic-error">{video.error}</p> : null}

      <div className="video-list">
        {videos?.length ? (
          videos.slice(0, 5).map((item) => (
            <article className="video-item" key={item.id}>
              <video controls src={`${API_URL}${item.url}`} />
              <div>
                <strong>{formatTime(item.createdAt)}</strong>
                <span>{formatDuration(item.duration)} / sound + detection video / {formatSize(item.size)}</span>
              </div>
              <a href={`${API_URL}${item.url}`} download={item.filename} title="Download video" aria-label="Download video">
                <Download size={17} aria-hidden="true" />
              </a>
              <button
                type="button"
                className="icon-button danger"
                onClick={() => onDelete(item.id)}
                title="Delete video"
                aria-label="Delete video"
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </article>
          ))
        ) : (
          <div className="recording-empty">No media recordings</div>
        )}
      </div>
    </section>
  );
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatDuration(value) {
  const seconds = Number(value || 0);
  return `${seconds.toFixed(1)}s`;
}

function formatSize(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
