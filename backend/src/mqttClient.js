import mqtt from 'mqtt';
import { config } from './config.js';
import { clearHistoryStore, getHistoryItems, saveDetectionScreenshot } from './historyStore.js';
import { clearRecordings } from './micService.js';
import { addEvent, parseLocation, robotState } from './state.js';
import { clearVideoRecordings, handleVideoFrame } from './videoService.js';

const inboundTopics = [
  'robot/flux',
  'robot/photo',
  'robot/feu_photo',
  'robot/localisation',
  'robot/alerte_vocale',
  'robot/detection',
  'robot/feu',
  'robot/obstacle',
  'robot/status',
  'robot/motion/status',
  'robot/motion/event'
];

const commandTopics = {
  command: 'robot/command',
  servoOy: 'robot/servo/oy',
  servoOz: 'robot/servo/oz',
  mode: 'robot/mode'
};

let mqttClient;
let pendingDetection = null;
let lastObstacleDetected = null;  // last broadcast obstacle state (so we emit only on change)
let lastHistorySaveAt = 0;
const HISTORY_SAVE_COOLDOWN_MS = 15000;

function emitState(io) {
  io.emit('robot:state', robotState);
}

function shouldIgnoreDuplicateAlert(text) {
  if (!robotState.lastAlert || robotState.lastAlert.text !== text) return false;

  const previous = Date.parse(robotState.lastAlertAt || 0);
  return Date.now() - previous < 1500;
}

function isDetectionText(text) {
  const normalized = text.toLowerCase();
  return !normalized.includes('aucune') &&
    !normalized.includes('no one') &&
    !normalized.includes('0 personne');
}

async function handleMessage(io, topic, payload) {
  const text = payload.toString();
  const now = new Date().toISOString();

  if (topic === 'robot/flux') {
    robotState.liveFrame = text;
    robotState.frameCount += 1;
    robotState.lastFrameAt = now;
    handleVideoFrame(text);
    io.emit('robot:frame', {
      image: text,
      frameCount: robotState.frameCount,
      receivedAt: now
    });
    return;
  }

  if (topic === 'robot/photo') {
    robotState.lastPhoto = text;
    io.emit('robot:photo', { image: text, receivedAt: now });

    if (pendingDetection && Date.now() - pendingDetection.createdAtMs < 10000) {
      if (Date.now() - lastHistorySaveAt < HISTORY_SAVE_COOLDOWN_MS) {
        pendingDetection = null;
        return;
      }

      const item = await saveDetectionScreenshot({
        image: text,
        message: pendingDetection.text,
        location: robotState.location,
        receivedAt: pendingDetection.receivedAt
      });

      robotState.history = getHistoryItems();
      io.emit('robot:history:add', item);
      emitState(io);
      lastHistorySaveAt = Date.now();
      pendingDetection = null;
    }

    return;
  }

  if (topic === 'robot/feu_photo') {
    robotState.lastFirePhoto = text;
    io.emit('robot:fire_photo', { image: text, receivedAt: now });
    return;
  }

  if (topic === 'robot/feu') {
    const detected = !text.toLowerCase().includes('aucun');
    robotState.lastFireAlert = { text, topic, receivedAt: now, detected };
    robotState.lastFireAlertAt = now;
    if (!detected) {
      robotState.lastFirePhoto = null;
      io.emit('robot:fire_photo', { image: null, receivedAt: now });
    }
    io.emit('robot:fire_alert', { ...robotState.lastFireAlert });
    emitState(io);
    return;
  }

  if (topic === 'robot/obstacle') {
    // Robot publishes "1" (obstacle) / "0" (clear) at ~2 Hz. Keep the latest in state
    // for fresh page loads, but only push to clients when the state actually flips —
    // emitState carries the whole robotState (incl. the live frame), so avoid spamming it.
    const detected = text.trim() === '1';
    robotState.lastObstacle = { detected, receivedAt: now };
    if (detected !== lastObstacleDetected) {
      lastObstacleDetected = detected;
      io.emit('robot:obstacle', { ...robotState.lastObstacle });
      emitState(io);
    }
    return;
  }

  if (topic === 'robot/localisation') {
    robotState.location = parseLocation(text);
    io.emit('robot:location', robotState.location);
    return;
  }

  if (topic === 'robot/alerte_vocale' || topic === 'robot/detection') {
    if (shouldIgnoreDuplicateAlert(text)) return;

    const detected = isDetectionText(text);
    robotState.lastAlert = { text, topic, receivedAt: now, detected };
    robotState.lastAlertAt = now;
    const event = detected ? addEvent('alert', text, { topic }) : addEvent('clear', text, { topic });

    if (detected) {
      pendingDetection = { text, receivedAt: now, createdAtMs: Date.now() };
    } else {
      pendingDetection = null;
      robotState.lastPhoto = null;
      io.emit('robot:photo', { image: null, receivedAt: now });
    }

    io.emit('robot:alert', { ...robotState.lastAlert, event });
    emitState(io);
    return;
  }

  if (topic === 'robot/status') {
    robotState.lastStatusAt = now;

    if (text.toLowerCase() === 'online') {
      await clearHistoryStore();
      await clearRecordings();
      await clearVideoRecordings();
      robotState.history = getHistoryItems();
      pendingDetection = null;
      lastHistorySaveAt = 0;
      io.emit('robot:history:clear');
    }

    const event = addEvent('status', text, { topic });
    io.emit('robot:status', { text, receivedAt: now, event });
    emitState(io);
    return;
  }

  if (topic === 'robot/motion/status') {
    const event = addEvent('status', `motion ${text}`, { topic });
    io.emit('robot:status', { text: `motion ${text}`, receivedAt: now, event });
    emitState(io);
    return;
  }

  if (topic === 'robot/motion/event') {
    const event = addEvent('command', `motion ${text}`, { topic });
    io.emit('robot:event', event);
    emitState(io);
  }
}

export function initMqtt(io) {
  mqttClient = mqtt.connect(config.mqttUrl, {
    reconnectPeriod: 2000,
    connectTimeout: 5000
  });

  mqttClient.on('connect', () => {
    robotState.mqttConnected = true;
    mqttClient.subscribe(inboundTopics);
    // Keep the broker's retained mode in sync with the backend on (re)connect, so a
    // motion worker that subscribes later immediately gets the correct mode.
    mqttClient.publish(commandTopics.mode, robotState.mode, { retain: true });
    addEvent('status', `MQTT connected to ${config.mqttUrl}`);
    emitState(io);
  });

  mqttClient.on('reconnect', () => {
    robotState.mqttConnected = false;
    emitState(io);
  });

  mqttClient.on('close', () => {
    robotState.mqttConnected = false;
    emitState(io);
  });

  mqttClient.on('error', (error) => {
    addEvent('error', error.message);
    io.emit('robot:error', { message: error.message });
  });

  mqttClient.on('message', (topic, payload) => {
    handleMessage(io, topic, payload).catch((error) => {
      addEvent('error', error.message);
      io.emit('robot:error', { message: error.message });
    });
  });

  return mqttClient;
}

export function publishCommand(command) {
  if (!mqttClient?.connected) {
    throw new Error('MQTT broker is not connected');
  }

  const cmd = String(command);
  // In auto mode the robot drives itself — drop stray manual commands, but let the
  // `auto:` calibration commands (turn_ms / test_turn) through.
  if (robotState.mode === 'auto' && !cmd.startsWith('auto:')) {
    return addEvent('command', `ignored in auto: ${cmd}`, { topic: commandTopics.command });
  }

  mqttClient.publish(commandTopics.command, cmd);
  return addEvent('command', cmd, { topic: commandTopics.command });
}

export function publishMode(mode) {
  if (!mqttClient?.connected) {
    throw new Error('MQTT broker is not connected');
  }

  // Retained so a motion worker that connects later picks up the current mode.
  mqttClient.publish(commandTopics.mode, String(mode), { retain: true });
  return addEvent('command', `mode -> ${mode}`, { topic: commandTopics.mode });
}

const SERVO_LIMITS = {
  oy: { min: 0, max: 120 },
  oz: { min: 30, max: 150 },
};

export function publishServo(axis, value) {
  if (!mqttClient?.connected) {
    throw new Error('MQTT broker is not connected');
  }

  const limits = SERVO_LIMITS[axis];
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < limits.min || numericValue > limits.max) {
    throw new Error(`Servo ${axis} value must be between ${limits.min} and ${limits.max}`);
  }

  const topic = axis === 'oz' ? commandTopics.servoOz : commandTopics.servoOy;
  mqttClient.publish(topic, String(Math.round(numericValue)));

  return addEvent('command', `${axis.toUpperCase()} -> ${Math.round(numericValue)}`, { topic });
}
