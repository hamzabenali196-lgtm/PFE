import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Cpu, Server } from 'lucide-react';
import { io } from 'socket.io-client';
import AlertPanel from './components/AlertPanel.jsx';
import DetectionHistory from './components/DetectionHistory.jsx';
import LiveCamera from './components/LiveCamera.jsx';
import LocationPanel from './components/LocationPanel.jsx';
import MicPanel from './components/MicPanel.jsx';
import ServoControls from './components/ServoControls.jsx';
import StatusBadge from './components/StatusBadge.jsx';
import VideoRecorder from './components/VideoRecorder.jsx';
import {
  API_URL,
  deleteHistoryItem,
  deleteVideoRecording,
  getRobotState,
  postMicEnabled,
  postRobotCommand,
  startVideoRecording,
  stopVideoRecording
} from './lib/api.js';

const initialRobotState = {
  mqttConnected: false,
  liveFrame: null,
  lastPhoto: null,
  lastAlert: null,
  location: null,
  frameCount: 0,
  lastFrameAt: null,
  history: [],
  videoRecordings: [],
  video: {
    recording: false,
    error: null,
    startedAt: null
  },
  mic: {
    enabled: false,
    device: null,
    level: 0,
    error: null
  }
};

export default function App() {
  const [robot, setRobot] = useState(initialRobotState);
  const [socketConnected, setSocketConnected] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [notice, setNotice] = useState('');
  const lastSpokenRef = useRef('');

  const socket = useMemo(() => io(API_URL, { autoConnect: false }), []);

  useEffect(() => {
    getRobotState()
      .then((payload) => setRobot((current) => ({ ...current, ...payload })))
      .catch((error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));

    socket.on('robot:state', (payload) => {
      setRobot((current) => ({ ...current, ...payload }));
    });

    socket.on('robot:frame', ({ image, frameCount, receivedAt }) => {
      setRobot((current) => ({
        ...current,
        liveFrame: image,
        frameCount,
        lastFrameAt: receivedAt
      }));
    });

    socket.on('robot:photo', ({ image }) => {
      setRobot((current) => ({ ...current, lastPhoto: image }));
    });

    socket.on('robot:mic', (mic) => {
      setRobot((current) => ({ ...current, mic }));
    });

    socket.on('robot:video', (video) => {
      setRobot((current) => ({ ...current, video }));
    });

    socket.on('robot:videos', (videoRecordings) => {
      setRobot((current) => ({ ...current, videoRecordings }));
    });

    socket.on('robot:location', (location) => {
      setRobot((current) => ({ ...current, location }));
    });

    socket.on('robot:alert', (alert) => {
      setRobot((current) => ({
        ...current,
        lastAlert: alert,
        lastAlertAt: alert.receivedAt
      }));
    });

    socket.on('robot:history:add', (item) => {
      setRobot((current) => ({
        ...current,
        history: [item, ...(current.history || [])].slice(0, 30)
      }));
    });

    socket.on('robot:history:clear', () => {
      setRobot((current) => ({ ...current, history: [] }));
    });

    socket.on('robot:error', ({ message }) => setNotice(message));

    socket.connect();

    return () => {
      socket.off();
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    const text = robot.lastAlert?.text;
    if (!voiceEnabled || !text || robot.lastAlert?.detected === false || lastSpokenRef.current === `${text}-${robot.lastAlertAt}`) return;
    lastSpokenRef.current = `${text}-${robot.lastAlertAt}`;

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  }, [robot.lastAlert, robot.lastAlertAt, voiceEnabled]);

  async function runAction(action) {
    try {
      setNotice('');
      await action();
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function removeHistoryItem(id) {
    await runAction(async () => {
      await deleteHistoryItem(id);
      setRobot((current) => ({
        ...current,
        history: (current.history || []).filter((item) => item.id !== id)
      }));
    });
  }

  async function toggleMic(enabled) {
    await runAction(async () => {
      const payload = await postMicEnabled(enabled);
      setRobot((current) => ({ ...current, mic: payload.mic }));
    });
  }

  async function startVideo() {
    await runAction(async () => {
      const payload = await startVideoRecording();
      setRobot((current) => ({ ...current, video: payload.state, mic: payload.mic || current.mic }));
    });
  }

  async function stopVideo() {
    await runAction(async () => {
      const payload = await stopVideoRecording();
      setRobot((current) => ({
        ...current,
        video: payload.state,
        mic: payload.mic || current.mic,
        videoRecordings: payload.videos || current.videoRecordings
      }));
    });
  }

  async function removeVideo(id) {
    await runAction(async () => {
      const payload = await deleteVideoRecording(id);
      setRobot((current) => ({
        ...current,
        videoRecordings: payload.videos || (current.videoRecordings || []).filter((item) => item.id !== id)
      }));
    });
  }

  const handleDriveCommand = useCallback(async (command) => {
    await runAction(() => postRobotCommand(command));
  }, []);

  const handleVoiceCommand = useCallback(async (text) => {
    const normalized = text.toLowerCase();

    if (normalized.includes('saluer') || normalized.includes('hello') || normalized.includes('bonjour')) {
      await runAction(() => postRobotCommand('HELLO'));
      return;
    }

    if (normalized.includes('gauche') || normalized.includes('left')) {
      await handleDriveCommand('left');
      return;
    }

    if (normalized.includes('droite') || normalized.includes('right')) {
      await handleDriveCommand('right');
      return;
    }
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <div className="header-logo">
            <Bot size={22} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">Master&apos;s Project</p>
            <h1>Spider Robot</h1>
          </div>
        </div>
        <div className="header-status">
          <ConnectionPill icon={<Server size={14} />} label="Backend" connected={socketConnected} />
          <ConnectionPill icon={<Cpu size={14} />} label="MQTT" connected={robot.mqttConnected} />
          <StatusBadge socketConnected={socketConnected} mqttConnected={robot.mqttConnected} />
        </div>
      </header>

      {notice ? <div className="notice">{notice}</div> : null}

      <main className="dashboard-grid">
        <div className="primary-stack">
          <LiveCamera
            frame={robot.liveFrame}
            lastFrameAt={robot.lastFrameAt}
            video={robot.video}
            onDriveCommand={handleDriveCommand}
          />
          <LocationPanel location={robot.location} />
        </div>

        <div className="side-stack">
          <ServoControls
            onHello={() => runAction(() => postRobotCommand('HELLO'))}
            onDriveCommand={handleDriveCommand}
          />
          <AlertPanel
            alert={robot.lastAlert}
            photo={robot.lastPhoto}
            voiceEnabled={voiceEnabled}
            onToggleVoice={() => setVoiceEnabled((value) => !value)}
          />
          <MicPanel
            mic={robot.mic}
            socket={socket}
            onToggle={toggleMic}
            onVoiceCommand={handleVoiceCommand}
          />
          <VideoRecorder
            video={robot.video}
            videos={robot.videoRecordings}
            onStart={startVideo}
            onStop={stopVideo}
            onDelete={removeVideo}
          />
          <DetectionHistory history={robot.history} onDelete={removeHistoryItem} />
        </div>
      </main>
    </div>
  );
}

function ConnectionPill({ icon, label, connected }) {
  return (
    <div className={`connection-pill${connected ? ' online' : ' offline'}`}>
      {icon}
      <span>{label}</span>
      <strong>{connected ? 'Connected' : 'Offline'}</strong>
    </div>
  );
}
