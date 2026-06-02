import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { getHistoryItems, initHistoryStore, screenshotsDir } from './historyStore.js';
import { initMic, recordingsDir } from './micService.js';
import { initMqtt, publishCommand, publishServo } from './mqttClient.js';
import { robotRoutes } from './routes/robotRoutes.js';
import { robotState } from './state.js';
import { initVideoRecorder, videosDir } from './videoService.js';

const app = express();
const httpServer = createServer(app);

const corsOrigin = config.frontendOrigin === '*'
  ? true
  : config.frontendOrigin.split(',').map((origin) => origin.trim());

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST']
  }
});

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '2mb' }));
app.use('/screenshots', express.static(screenshotsDir));
app.use('/recordings', express.static(recordingsDir));
app.use('/videos', express.static(videosDir));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mqttConnected: robotState.mqttConnected,
    uptime: process.uptime()
  });
});

app.use('/api/robot', robotRoutes);

io.on('connection', (socket) => {
  socket.emit('robot:state', robotState);

  socket.on('robot:command', (command, callback) => {
    try {
      const event = publishCommand(command);
      callback?.({ ok: true, event });
      io.emit('robot:event', event);
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on('robot:servo', ({ axis, value }, callback) => {
    try {
      const event = publishServo(axis, value);
      callback?.({ ok: true, event });
      io.emit('robot:event', event);
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });
});

await initHistoryStore();
robotState.history = getHistoryItems();
await initMic(io);
await initVideoRecorder(io);
initMqtt(io);

httpServer.listen(config.port, '0.0.0.0', () => {
  console.log(`Robot Spider backend listening on http://localhost:${config.port}`);
});
