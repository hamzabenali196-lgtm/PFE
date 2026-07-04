const MAX_EVENTS = 50;

export const robotState = {
  mode: 'manual',            // 'manual' | 'auto'  (auto = autonomous patrol)
  auto: { turnMs: 1500 },    // tunable ~90° right-turn duration for auto mode
  mqttConnected: false,
  liveFrame: null,
  lastPhoto: null,
  lastAlert: null,
  lastFireAlert: null,
  lastFirePhoto: null,
  lastFireAlertAt: null,
  lastObstacle: null,
  motionAlert: null,         // { kind: 'fire'|'human', receivedAt } while the robot is halted awaiting auto:resume
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
  },
  speaker: {
    talking: false,   // an operator is streaming their voice to the BT speaker
    error: null
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
