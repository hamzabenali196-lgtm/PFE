import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEvent, robotState } from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const videosDir = path.resolve(__dirname, '..', 'data', 'videos');
const MAX_VIDEOS = 10;
const VIDEO_FPS = 12;

let ioRef = null;
let videos = [];
let currentVideo = null;

export async function initVideoRecorder(io) {
  ioRef = io;
  await clearVideoRecordings();
  robotState.video = { recording: false, audio: false, error: null, startedAt: null };
  robotState.videoRecordings = videos;
}

export function getVideoState() {
  return robotState.video;
}

export function getVideoRecordings() {
  return videos;
}

export async function clearVideoRecordings() {
  await stopVideoRecording();
  await fs.rm(videosDir, { recursive: true, force: true });
  await fs.mkdir(videosDir, { recursive: true });
  videos = [];
  robotState.videoRecordings = videos;
  ioRef?.emit('robot:videos', videos);
}

export async function startVideoRecording({ stopMicAfter = false } = {}) {
  if (currentVideo) return currentVideo.item;

  await fs.mkdir(videosDir, { recursive: true });

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const filename = `${id}.mp4`;
  const filePath = path.join(videosDir, filename);
  const startedAt = new Date().toISOString();

  const process = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(VIDEO_FPS),
    '-vcodec', 'mjpeg',
    '-i', 'pipe:0',
    '-f', 's16le',
    '-ar', '16000',
    '-ac', '1',
    '-i', 'pipe:3',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-shortest',
    '-movflags', '+faststart',
    filePath
  ], { stdio: ['pipe', 'ignore', 'pipe', 'pipe'] });

  const item = {
    id,
    filename,
    url: `/videos/${filename}`,
    createdAt: startedAt,
    duration: 0,
    size: 0,
    frames: 0
  };

  currentVideo = {
    filePath,
    item,
    process,
    stopMicAfter,
    startedAtMs: Date.now()
  };

  process.stdin.on('error', () => {});
  process.stderr.on('error', () => {});
  if (process.stdio[3]) process.stdio[3].on('error', () => {});

  process.stderr.on('data', (chunk) => {
    robotState.video.error = chunk.toString().trim().split('\n').at(-1);
    emitVideo();
  });

  process.on('close', () => {
    if (currentVideo?.process === process) {
      currentVideo = null;
      robotState.video.recording = false;
      robotState.video.audio = false;
      emitVideo();
    }
  });

  robotState.video = {
    recording: true,
    audio: true,
    error: null,
    startedAt
  };
  addEvent('status', 'Audio/video recording started');
  emitVideo();
  return item;
}

export async function stopVideoRecording() {
  if (!currentVideo) return null;

  const recording = currentVideo;
  currentVideo = null;

  const closed = new Promise((resolve) => {
    recording.process.once('close', resolve);
  });

  recording.process.stdin.end();
  recording.process.stdio[3]?.end();
  await closed;

  const stat = await fs.stat(recording.filePath).catch(() => ({ size: 0 }));
  const duration = recording.item.frames / VIDEO_FPS;
  const item = {
    ...recording.item,
    duration: Number(duration.toFixed(1)),
    size: stat.size
  };

  if (item.size > 0 && item.frames > 0) {
    videos.unshift(item);
    while (videos.length > MAX_VIDEOS) {
      const removed = videos.pop();
      if (removed) await fs.rm(path.join(videosDir, removed.filename), { force: true });
    }
  } else {
    await fs.rm(recording.filePath, { force: true });
  }

  robotState.video = { recording: false, audio: false, error: null, startedAt: null };
  robotState.videoRecordings = videos;
  addEvent('status', 'Audio/video recording saved');
  ioRef?.emit('robot:videos', videos);
  emitVideo();
  return item;
}

export async function deleteVideoRecording(id) {
  const item = videos.find((entry) => entry.id === id);
  if (!item) return null;

  videos = videos.filter((entry) => entry.id !== id);
  await fs.rm(path.join(videosDir, item.filename), { force: true });
  robotState.videoRecordings = videos;
  ioRef?.emit('robot:videos', videos);
  return item;
}

export function handleVideoFrame(image) {
  if (!currentVideo || currentVideo.process.stdin.destroyed) return;

  const cleanedImage = image.replace(/^data:image\/jpeg;base64,/, '');
  const frame = Buffer.from(cleanedImage, 'base64');
  currentVideo.process.stdin.write(frame);
  currentVideo.item.frames += 1;
}

export function handleVideoAudio(chunk) {
  if (!currentVideo || !currentVideo.process.stdio[3] || currentVideo.process.stdio[3].destroyed) return;
  currentVideo.process.stdio[3].write(chunk);
}

export function shouldStopMicAfterVideo() {
  return Boolean(currentVideo?.stopMicAfter);
}

function emitVideo() {
  ioRef?.emit('robot:video', robotState.video);
}
