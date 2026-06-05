import { ListChecks, X } from 'lucide-react';

export default function EventLog({ events, onClose }) {
  return (
    <section className="tool-panel event-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">System</p>
          <h2>Recent Events</h2>
        </div>
        <div className="panel-tools">
          <ListChecks size={22} aria-hidden="true" />
          {onClose ? (
            <button type="button" className="icon-button" onClick={onClose} title="Hide events" aria-label="Hide events">
              <X size={17} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="event-list">
        {events?.length ? (
          events.slice(0, 8).map((event) => (
            <div className={`event-item ${event.type}`} key={event.id}>
              <span>{event.type}</span>
              <strong>{event.message}</strong>
              <time>{formatTime(event.createdAt)}</time>
            </div>
          ))
        ) : (
          <div className="event-empty">No events</div>
        )}
      </div>
    </section>
  );
}

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}
