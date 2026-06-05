import { Trash2, Images } from 'lucide-react';
import { API_URL } from '../lib/api.js';

export default function DetectionHistory({ history, onDelete }) {
  return (
    <section className="tool-panel history-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Archive</p>
          <h2>Detections</h2>
        </div>
        <Images size={22} aria-hidden="true" />
      </div>

      <div className="history-list">
        {history?.length ? (
          history.map((item) => (
            <article className="history-item" key={item.id}>
              <img src={`${API_URL}${item.imageUrl}`} alt={item.message} />
              <div>
                <strong>{item.message}</strong>
                <span>{formatDate(item.createdAt)}</span>
                <em>{item.location || 'No location'}</em>
              </div>
              <button
                type="button"
                className="icon-button danger"
                onClick={() => onDelete(item.id)}
                title="Delete screenshot"
                aria-label="Delete screenshot"
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </article>
          ))
        ) : (
          <div className="history-empty">No saved detections</div>
        )}
      </div>
    </section>
  );
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
