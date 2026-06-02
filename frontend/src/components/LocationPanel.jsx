import { ExternalLink, MapPin, Navigation } from 'lucide-react';

export default function LocationPanel({ location }) {
  const hasCoordinates = Number.isFinite(location?.lat) && Number.isFinite(location?.lon);
  const mapUrl = hasCoordinates
    ? `https://www.google.com/maps?q=${encodeURIComponent(location.raw)}`
    : '#';
  const embedUrl = hasCoordinates
    ? `https://maps.google.com/maps?q=${encodeURIComponent(location.raw)}&output=embed`
    : null;

  return (
    <section className="tool-panel location-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Localisation</p>
          <h2>Robot Position</h2>
        </div>
        <MapPin size={22} aria-hidden="true" />
      </div>

      <div className="map-shell">
        {embedUrl ? (
          <iframe src={embedUrl} title="Robot map position" loading="lazy" />
        ) : (
          <div className="map-empty">
            <Navigation size={24} aria-hidden="true" />
            <span>No coordinates</span>
          </div>
        )}
      </div>

      <div className="location-footer">
        <span>{location?.raw || 'No position received'}</span>
        <a
          href={mapUrl}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!hasCoordinates}
          title="Open in Google Maps"
        >
          <ExternalLink size={17} aria-hidden="true" />
          <span>Map</span>
        </a>
      </div>
    </section>
  );
}
