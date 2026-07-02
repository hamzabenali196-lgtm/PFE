import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Bot, Cpu, Film, Gamepad2, Server } from 'lucide-react';
import { io } from 'socket.io-client';
import AlertPanel from './components/AlertPanel.jsx';
import AutoStatusPanel from './components/AutoStatusPanel.jsx';
import ControlPanel from './components/ControlPanel.jsx';
import DetectionHistory from './components/DetectionHistory.jsx';
import LiveCamera from './components/LiveCamera.jsx';
import LocationPanel from './components/LocationPanel.jsx';
import MicPanel from './components/MicPanel.jsx';
import ModeToggle from './components/ModeToggle.jsx';
import DriveModeToggle from './components/DriveModeToggle.jsx';
import StatusBadge from './components/StatusBadge.jsx';
import VideoRecorder from './components/VideoRecorder.jsx';
import {
  API_URL,
  deleteHistoryItem,
  deleteVideoRecording,
  getRobotState,
  postAutoTestTurn,
  postMicEnabled,
  postMode,
  postRobotCommand,
  postServo,
  startVideoRecording,
  stopVideoRecording
} from './lib/api.js';

const initialRobotState = {
  mode: 'manual',
  driveMode: 'legs',
  auto: { turnMs: 1500 },
  mqttConnected: false,
  liveFrame: null,
  lastPhoto: null,
  lastAlert: null,
  lastFireAlert: null,
  lastFirePhoto: null,
  lastObstacle: null,
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
  const [headPos, setHeadPos] = useState({ pan: 90, tilt: 60 });
  const [sideTab, setSideTab] = useState('controls');
  const [autoTurnMs, setAutoTurnMs] = useState(initialRobotState.auto.turnMs);
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

    socket.on('robot:mode', ({ mode }) => {
      setRobot((current) => ({ ...current, mode }));
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

    socket.on('robot:fire_alert', (alert) => {
      setRobot((current) => ({ ...current, lastFireAlert: alert }));
    });

    socket.on('robot:fire_photo', ({ image }) => {
      setRobot((current) => ({ ...current, lastFirePhoto: image }));
    });

    socket.on('robot:obstacle', (obstacle) => {
      setRobot((current) => ({ ...current, lastObstacle: obstacle }));
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

  const handleHeadMove = useCallback(async (axis, value) => {
    setHeadPos((p) => ({ ...p, [axis === 'oz' ? 'pan' : 'tilt']: value }));
    await runAction(() => postServo(axis, value));
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

  const handleSetMode = useCallback(async (mode) => {
    setRobot((current) => ({ ...current, mode })); // optimistic — backend confirms via robot:mode
    await runAction(() => postMode(mode));
  }, []);

  const handleSetDriveMode = useCallback(async (driveMode) => {
    setRobot((current) => ({ ...current, driveMode })); // optimistic — sends "legs"/"motors" command
    await runAction(() => postRobotCommand(driveMode));
  }, []);

  const handleTestTurn = useCallback(async () => {
    await runAction(() => postAutoTestTurn(autoTurnMs));
  }, [autoTurnMs]);

  const isAuto = robot.mode === 'auto';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <div className="header-logo">
            <Bot size={24} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">PFE — Masters Project</p>
            <h1>Spider Robot Control</h1>
          </div>
        </div>
        <ModeToggle mode={robot.mode} onChange={handleSetMode} />
        <DriveModeToggle driveMode={robot.driveMode} onChange={handleSetDriveMode} />

        <div className="header-status">
          <ConnectionPill icon={<Server size={14} />} label="Backend" connected={socketConnected} />
          <ConnectionPill icon={<Cpu size={14} />} label="MQTT" connected={robot.mqttConnected} />
          <StatusBadge socketConnected={socketConnected} mqttConnected={robot.mqttConnected} />
        </div>
      </header>

      {notice ? <div className="notice">{notice}</div> : null}

      {isAuto ? (
        <main className="dashboard-grid">
          <div className="primary-stack">
            <LiveCamera
              frame={robot.liveFrame}
              lastFrameAt={robot.lastFrameAt}
              video={robot.video}
              autoMode
            />
          </div>

          <div className="side-stack">
            <AutoStatusPanel
              alert={robot.lastAlert}
              fireAlert={robot.lastFireAlert}
              obstacle={robot.lastObstacle}
              recording={Boolean(robot.video?.recording)}
              turnMs={autoTurnMs}
              onTurnMsChange={setAutoTurnMs}
              onTestTurn={handleTestTurn}
            />
            <VideoRecorder
              video={robot.video}
              videos={robot.videoRecordings}
              onDelete={removeVideo}
              readOnly
            />
          </div>

          <div className="location-stack">
            <LocationPanel location={robot.location} />
          </div>
        </main>
      ) : (
      <main className="dashboard-grid">
        <div className="primary-stack">
          <LiveCamera
            frame={robot.liveFrame}
            lastFrameAt={robot.lastFrameAt}
            video={robot.video}
            onDriveCommand={handleDriveCommand}
          />
        </div>

        <div className="side-stack">
          <div className="side-tabs">
            <button
              className={`side-tab${sideTab === 'controls' ? ' active' : ''}`}
              onClick={() => setSideTab('controls')}
            >
              <Gamepad2 size={17} aria-hidden="true" />
              Controls
            </button>
            <button
              className={`side-tab${sideTab === 'alerts' ? ' active' : ''}`}
              onClick={() => setSideTab('alerts')}
            >
              <Bell size={17} aria-hidden="true" />
              Alerts
            </button>
            <button
              className={`side-tab${sideTab === 'media' ? ' active' : ''}`}
              onClick={() => setSideTab('media')}
            >
              <Film size={17} aria-hidden="true" />
              Media
            </button>
          </div>

          {sideTab === 'controls' && (
            <ControlPanel
              onHello={() => runAction(() => postRobotCommand('HELLO'))}
              onDriveCommand={handleDriveCommand}
              headPos={headPos}
              onHeadMove={handleHeadMove}
              driveMode={robot.driveMode}
            />
          )}

          {sideTab === 'alerts' && (
            <>
              <AlertPanel
                alert={robot.lastAlert}
                photo={robot.lastPhoto}
                fireAlert={robot.lastFireAlert}
                firePhoto={robot.lastFirePhoto}
                obstacle={robot.lastObstacle}
                voiceEnabled={voiceEnabled}
                onToggleVoice={() => setVoiceEnabled((value) => !value)}
              />
              <MicPanel
                mic={robot.mic}
                socket={socket}
                onToggle={toggleMic}
                onVoiceCommand={handleVoiceCommand}
              />
            </>
          )}

          {sideTab === 'media' && (
            <>
              <VideoRecorder
                video={robot.video}
                videos={robot.videoRecordings}
                onStart={startVideo}
                onStop={stopVideo}
                onDelete={removeVideo}
              />
              <DetectionHistory history={robot.history} onDelete={removeHistoryItem} />
            </>
          )}
        </div>

        <div className="location-stack">
          <LocationPanel location={robot.location} />
        </div>
      </main>
      )}
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
