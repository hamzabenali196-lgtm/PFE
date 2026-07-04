import { spawn } from 'node:child_process';
import { addEvent, robotState } from './state.js';

// The Bluetooth speaker is the PipeWire default sink. Under systemd the user
// session env is missing, so point pacat/paplay at the user's runtime dir.
const audioEnv = {
  ...process.env,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`
};

const TALK_SAMPLE_RATE = 16000;
const SPEECH_COOLDOWN_MS = 8000;

let ioRef = null;
let talkProcess = null;
let talkOwner = null; // socket.id of the browser currently talking
let lastSpeech = { text: null, at: 0 };

export function initSpeaker(io) {
  ioRef = io;
  emitSpeaker();
}

// Live intercom: raw 16 kHz mono PCM chunks from the browser mic are piped
// straight into pacat, which plays them on the Bluetooth speaker.
export function attachTalkHandlers(socket) {
  socket.on('robot:talk:start', (callback) => {
    try {
      startTalk(socket.id);
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on('robot:talk:audio', (chunk) => {
    if (talkOwner !== socket.id || !talkProcess) return;
    try {
      talkProcess.stdin.write(Buffer.from(chunk));
    } catch {
      // pacat died mid-stream; the close handler resets state
    }
  });

  socket.on('robot:talk:stop', () => stopTalk(socket.id));
  socket.on('disconnect', () => stopTalk(socket.id));
}

function startTalk(socketId) {
  if (talkProcess && talkOwner !== socketId) {
    // A new operator takes over the speaker
    stopTalk(talkOwner);
  }
  if (talkProcess) return;

  talkProcess = spawn('pacat', [
    '--playback',
    '--raw',
    `--format=s16le`,
    `--rate=${TALK_SAMPLE_RATE}`,
    '--channels=1',
    '--latency-msec=80',
    '--client-name=robot-talk'
  ], { env: audioEnv, stdio: ['pipe', 'ignore', 'pipe'] });

  talkOwner = socketId;
  let stderrText = '';

  talkProcess.stdin.on('error', () => {});
  talkProcess.stderr.on('data', (chunk) => {
    stderrText = chunk.toString().trim();
  });

  talkProcess.on('error', (error) => {
    talkProcess = null;
    talkOwner = null;
    robotState.speaker.talking = false;
    robotState.speaker.error = `Unable to start pacat: ${error.message}`;
    addEvent('alert', robotState.speaker.error);
    emitSpeaker();
  });

  talkProcess.on('close', (code) => {
    const wasTalking = Boolean(talkOwner);
    talkProcess = null;
    talkOwner = null;
    robotState.speaker.talking = false;
    if (code && wasTalking) {
      robotState.speaker.error = stderrText || `pacat exited with code ${code}`;
    }
    emitSpeaker();
  });

  robotState.speaker.talking = true;
  robotState.speaker.error = null;
  addEvent('status', 'Operator talking through robot speaker');
  emitSpeaker();
}

function stopTalk(socketId) {
  if (!talkProcess || talkOwner !== socketId) return;
  const proc = talkProcess;
  talkProcess = null;
  talkOwner = null;
  proc.stdin.end();
  setTimeout(() => proc.kill('SIGTERM'), 500).unref();
  robotState.speaker.talking = false;
  addEvent('status', 'Operator talk ended');
  emitSpeaker();
}

// Speak alert text (French) on the robot's speaker. Deduped so a re-published
// detection message doesn't repeat itself every few seconds.
export function speak(text) {
  const clean = String(text || '').trim();
  if (!clean) return;

  const now = Date.now();
  if (clean === lastSpeech.text && now - lastSpeech.at < SPEECH_COOLDOWN_MS) return;
  lastSpeech = { text: clean, at: now };

  const proc = spawn('sh', ['-c', 'espeak-ng -v fr -s 145 -a 190 --stdout "$0" | paplay', clean], {
    env: audioEnv,
    stdio: 'ignore'
  });
  proc.on('error', (error) => {
    robotState.speaker.error = `TTS failed: ${error.message}`;
    emitSpeaker();
  });
}

function emitSpeaker() {
  ioRef?.emit('robot:speaker', robotState.speaker);
}
