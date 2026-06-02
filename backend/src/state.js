const MAX_EVENTS = 50;

export const robotState = {
  mqttConnected: false,
  liveFrame: null,
  lastPhoto: null,
  lastAlert: null,
  location: null,
  frameCount: 0,
  lastFrameAt: null,
  lastAlertAt: null,
  lastStatusAt: null,
  events: [],
  history: [],
  recordings: [],
  videoRecordings: [],
  video: {
    recording: false,
    audio: false,
    error: null,
    startedAt: null
  },
  mic: {
    enabled: false,
    device: null,
    level: 0,
    recording: false,
    error: null,
    updatedAt: null
  }
};

export function addEvent(type, message, extra = {}) {
  const event = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    message,
    createdAt: new Date().toISOString(),
    ...extra
  };

  robotState.events.unshift(event);
  robotState.events = robotState.events.slice(0, MAX_EVENTS);
  return event;
}

export function parseLocation(payload) {
  const raw = payload.toString().trim();
  const [latText, lonText] = raw.split(',').map((part) => part.trim());
  const lat = Number(latText);
  const lon = Number(lonText);

  return {
    raw,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    updatedAt: new Date().toISOString()
  };
}
