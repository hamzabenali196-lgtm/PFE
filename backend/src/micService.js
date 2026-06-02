import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { addEvent, robotState } from './state.js';
import { handleVideoAudio } from './videoService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const recordingsDir = path.resolve(__dirname, '..', 'data', 'recordings');
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const MAX_RECORDINGS = 20;

let ioRef = null;
let micProcess = null;
let stoppingMic = false;
let recordings = [];
let currentRecording = null;

export async function initMic(io) {
  ioRef = io;
  await clearRecordings();
  robotState.mic.device = config.micDevice;
  robotState.mic.recording = false;
  robotState.recordings = recordings;
}

export function getMicState() {
  return robotState.mic;
}

export function getRecordings() {
  return recordings;
}

export async function clearRecordings() {
  await stopRecording();
  await fs.rm(recordingsDir, { recursive: true, force: true });
  await fs.mkdir(recordingsDir, { recursive: true });
  recordings = [];
  robotState.recordings = recordings;
  ioRef?.emit('robot:recordings', recordings);
}

export async function setMicEnabled(enabled) {
  return enabled ? startMic() : stopMic();
}

export async function startRecording() {
  if (currentRecording) {
    return currentRecording.item;
  }

  startMic();
  await fs.mkdir(recordingsDir, { recursive: true });

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const filename = `${id}.wav`;
  const filePath = path.join(recordingsDir, filename);
  const handle = await fs.open(filePath, 'w');

  await handle.write(createWavHeader(0), 0, 44, 0);

  const item = {
    id,
    filename,
    url: `/recordings/${filename}`,
    createdAt: new Date().toISOString(),
    duration: 0,
    size: 44
  };

  currentRecording = {
    bytes: 0,
    filePath,
    handle,
    item,
    pendingWrite: Promise.resolve(),
    startedAtMs: Date.now()
  };

  robotState.mic.recording = true;
  addEvent('status', 'Recording started');
  emitMic();
  return item;
}

export async function stopRecording() {
  if (!currentRecording) return null;

  const recording = currentRecording;
  currentRecording = null;
  await recording.pendingWrite;

  const duration = recording.bytes / (SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8));
  await recording.handle.write(createWavHeader(recording.bytes), 0, 44, 0);
  await recording.handle.close();

  const stat = await fs.stat(recording.filePath);
  const item = {
    ...recording.item,
    duration: Number(duration.toFixed(1)),
    size: stat.size
  };

  recordings.unshift(item);
  while (recordings.length > MAX_RECORDINGS) {
    const removed = recordings.pop();
    if (removed) await fs.rm(path.join(recordingsDir, removed.filename), { force: true });
  }

  robotState.mic.recording = false;
  robotState.recordings = recordings;
  addEvent('status', 'Recording saved');
  ioRef?.emit('robot:recordings', recordings);
  emitMic();
  return item;
}

export async function deleteRecording(id) {
  const item = recordings.find((entry) => entry.id === id);
  if (!item) return null;

  recordings = recordings.filter((entry) => entry.id !== id);
  await fs.rm(path.join(recordingsDir, item.filename), { force: true });
  robotState.recordings = recordings;
  ioRef?.emit('robot:recordings', recordings);
  return item;
}

function startMic() {
  if (micProcess) return robotState.mic;

  micProcess = spawn('arecord', [
    '-D', config.micDevice,
    '-f', 'S16_LE',
    '-r', '16000',
    '-c', '1',
    '-t', 'raw',
    '-q'
  ]);
  stoppingMic = false;

  robotState.mic = {
    enabled: true,
    device: config.micDevice,
    level: 0,
    error: null,
    recording: Boolean(currentRecording),
    updatedAt: new Date().toISOString()
  };
  addEvent('status', `USB mic enabled (${config.micDevice})`);
  emitMic();

  micProcess.stdout.on('data', (chunk) => {
    const level = calculateAudioLevel(chunk);
    robotState.mic.level = level;
    robotState.mic.updatedAt = new Date().toISOString();
    emitMic();
    ioRef?.emit('robot:mic:audio', chunk);
    handleVideoAudio(chunk);

    if (currentRecording) {
      const recording = currentRecording;
      recording.pendingWrite = recording.pendingWrite.then(() => recording.handle.write(chunk)).catch((error) => {
        robotState.mic.error = error.message;
        emitMic();
      });
      recording.bytes += chunk.length;
    }
  });

  micProcess.stderr.on('data', (chunk) => {
    if (stoppingMic) return;
    robotState.mic.error = chunk.toString().trim();
    emitMic();
  });

  micProcess.on('close', (code) => {
    micProcess = null;
    robotState.mic.enabled = false;
    robotState.mic.level = 0;
    robotState.mic.recording = Boolean(currentRecording);
    robotState.mic.updatedAt = new Date().toISOString();
    if (code && !robotState.mic.error && !stoppingMic) {
      robotState.mic.error = `arecord exited with code ${code}`;
    }
    stoppingMic = false;
    emitMic();
  });

  return robotState.mic;
}

async function stopMic() {
  await stopRecording();

  if (micProcess) {
    stoppingMic = true;
    micProcess.kill('SIGTERM');
    micProcess = null;
  }

  robotState.mic.enabled = false;
  robotState.mic.level = 0;
  robotState.mic.error = null;
  robotState.mic.recording = false;
  robotState.mic.updatedAt = new Date().toISOString();
  addEvent('status', 'USB mic disabled');
  emitMic();
  return robotState.mic;
}

function emitMic() {
  ioRef?.emit('robot:mic', robotState.mic);
}

function calculateAudioLevel(chunk) {
  let sum = 0;
  let samples = 0;

  for (let offset = 0; offset + 1 < chunk.length; offset += 2) {
    const sample = chunk.readInt16LE(offset) / 32768;
    sum += sample * sample;
    samples += 1;
  }

  if (!samples) return 0;

  const rms = Math.sqrt(sum / samples);
  return Math.min(1, Number((rms * 8).toFixed(3)));
}

function createWavHeader(dataLength) {
  const buffer = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}
