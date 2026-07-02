import { Router } from 'express';
import { deleteHistoryItem, getHistoryItems } from '../historyStore.js';
import { deleteRecording, getMicState, getRecordings, setMicEnabled, startRecording, stopRecording } from '../micService.js';
import { publishCommand, publishMode, publishServo } from '../mqttClient.js';
import { addEvent, robotState } from '../state.js';
import {
  deleteVideoRecording,
  getVideoRecordings,
  getVideoState,
  shouldStopMicAfterVideo,
  startVideoRecording,
  stopVideoRecording
} from '../videoService.js';

export function createRobotRoutes(io) {
  const router = Router();

  router.get('/state', (req, res) => {
    res.json(robotState);
  });

  router.get('/history', (req, res) => {
    res.json(getHistoryItems());
  });

  router.delete('/history/:id', async (req, res) => {
    const deleted = await deleteHistoryItem(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'history item not found' });
    }

    robotState.history = getHistoryItems();
    io.emit('robot:history:clear');
    robotState.history.forEach((item) => io.emit('robot:history:add', item));
    return res.json({ ok: true, deleted });
  });

  router.get('/mic', (req, res) => {
    res.json(getMicState());
  });

  router.post('/mic', async (req, res) => {
    try {
      const mic = await setMicEnabled(Boolean(req.body.enabled));
      return res.json({ ok: true, mic });
    } catch (error) {
      return res.status(503).json({ error: error.message });
    }
  });

  router.get('/recordings', (req, res) => {
    res.json(getRecordings());
  });

  router.post('/recordings/start', async (req, res) => {
    try {
      const recording = await startRecording();
      return res.json({ ok: true, recording, mic: getMicState() });
    } catch (error) {
      return res.status(503).json({ error: error.message });
    }
  });

  router.post('/recordings/stop', async (req, res) => {
    try {
      const recording = await stopRecording();
      return res.json({ ok: true, recording, mic: getMicState(), recordings: getRecordings() });
    } catch (error) {
      return res.status(503).json({ error: error.message });
    }
  });

  router.delete('/recordings/:id', async (req, res) => {
    const deleted = await deleteRecording(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'recording not found' });
    }

    return res.json({ ok: true, deleted, recordings: getRecordings() });
  });

  router.get('/videos', (req, res) => {
    res.json(getVideoRecordings());
  });

  router.post('/videos/start', async (req, res) => {
    try {
      const micWasEnabled = getMicState().enabled;
      await setMicEnabled(true);
      const video = await startVideoRecording({ stopMicAfter: !micWasEnabled });
      return res.json({ ok: true, video, state: getVideoState(), mic: getMicState() });
    } catch (error) {
      return res.status(503).json({ error: error.message });
    }
  });

  router.post('/videos/stop', async (req, res) => {
    try {
      const stopMicAfter = shouldStopMicAfterVideo();
      const video = await stopVideoRecording();
      if (stopMicAfter) {
        await setMicEnabled(false);
      }
      return res.json({ ok: true, video, state: getVideoState(), videos: getVideoRecordings(), mic: getMicState() });
    } catch (error) {
      return res.status(503).json({ error: error.message });
    }
  });

  router.delete('/videos/:id', async (req, res) => {
    const deleted = await deleteVideoRecording(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'video not found' });
    }

    return res.json({ ok: true, deleted, videos: getVideoRecordings() });
  });

  router.post('/command', (req, res) => {
    try {
      const { command } = req.body;
      if (!command) {
        return res.status(400).json({ error: 'command is required' });
      }

      const event = publishCommand(command);
      return res.json({ ok: true, event });
    } catch (error) {
      return res.status(503).json({ error: error.message });
    }
  });

  router.post('/home', (req, res) => {
    try {
      const event = publishCommand('POSITION_REPOS');
      return res.json({ ok: true, event });
    } catch (error) {
      return res.status(503).json({ error: error.message });
    }
  });

  router.post('/servo', (req, res) => {
    try {
      const { axis, value } = req.body;
      if (!['oy', 'oz'].includes(axis)) {
        return res.status(400).json({ error: 'axis must be oy or oz' });
      }

      const event = publishServo(axis, value);
      return res.json({ ok: true, event });
    } catch (error) {
      return res.status(503).json({ error: error.message });
    }
  });

  // ── Auto mode ────────────────────────────────────────────────────────────────
  // Switching mode tells the motion worker (robot/mode, retained) AND toggles the
  // always-on recording: auto records non-stop, manual hands recording back to the user.
  router.post('/mode', async (req, res) => {
    const mode = req.body?.mode;
    if (!['manual', 'auto'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be manual or auto' });
    }

    robotState.mode = mode;

    let warning;
    try {
      publishMode(mode);
    } catch (error) {
      warning = error.message;
      addEvent('error', `mode publish failed: ${error.message}`);
    }

    try {
      if (mode === 'auto') {
        const micWasEnabled = getMicState().enabled;
        await setMicEnabled(true);
        await startVideoRecording({ stopMicAfter: !micWasEnabled });
      } else {
        const stopMicAfter = shouldStopMicAfterVideo();
        await stopVideoRecording();
        if (stopMicAfter) await setMicEnabled(false);
      }
    } catch (error) {
      warning = warning || error.message;
      addEvent('error', `auto recording toggle failed: ${error.message}`);
    }

    io.emit('robot:mode', { mode });
    return res.json({ ok: true, mode, warning, video: getVideoState(), mic: getMicState() });
  });

  router.post('/auto/config', (req, res) => {
    const turnMs = Number(req.body?.turnMs);
    if (!Number.isFinite(turnMs) || turnMs < 200 || turnMs > 6000) {
      return res.status(400).json({ error: 'turnMs must be between 200 and 6000' });
    }

    robotState.auto = { ...robotState.auto, turnMs: Math.round(turnMs) };
    try { publishCommand(`auto:turn_ms:${robotState.auto.turnMs}`); } catch { /* MQTT down — UI value still saved */ }
    io.emit('robot:auto', robotState.auto);
    return res.json({ ok: true, auto: robotState.auto });
  });

  router.post('/auto/test-turn', (req, res) => {
    const turnMs = Number(req.body?.turnMs);
    if (Number.isFinite(turnMs) && turnMs >= 200 && turnMs <= 6000) {
      robotState.auto = { ...robotState.auto, turnMs: Math.round(turnMs) };
      io.emit('robot:auto', robotState.auto);
    }

    try {
      publishCommand(`auto:turn_ms:${robotState.auto.turnMs}`);
      publishCommand('auto:test_turn');
    } catch (error) {
      return res.status(503).json({ error: error.message });
    }
    return res.json({ ok: true, auto: robotState.auto });
  });

  return router;
}
