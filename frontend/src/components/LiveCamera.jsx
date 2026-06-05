import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Clock3, Expand, Minimize2, Radio, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const DRIVE_CONTROLS = {
  Z: { label: 'Forward', command: 'run', icon: <ArrowUp size={14} aria-hidden="true" /> },
  Q: { label: 'Left', command: 'left', icon: <ArrowLeft size={14} aria-hidden="true" /> },
  S: { label: 'Back', command: 'backward', icon: <ArrowDown size={14} aria-hidden="true" /> },
  D: { label: 'Right', command: 'right', icon: <ArrowRight size={14} aria-hidden="true" /> }
};

const ARROW_TO_CONTROL = {
  ArrowUp: 'Z',
  ArrowLeft: 'Q',
  ArrowDown: 'S',
  ArrowRight: 'D'
};

const KEY_TO_CONTROL = {
  z: 'Z',
  q: 'Q',
  s: 'S',
  d: 'D'
};

const CODE_TO_CONTROL = {
  KeyZ: 'Z',
  KeyQ: 'Q',
  KeyS: 'S',
  KeyD: 'D'
};

export default function LiveCamera({
  frame,
  lastFrameAt,
  video,
  onDriveCommand
}) {
  const recording = Boolean(video?.recording);
  const shellRef = useRef(null);
  const [isFullscreenFallback, setIsFullscreenFallback] = useState(false);
  const [activeControl, setActiveControl] = useState('');
  const activeControlRef = useRef('');

  useEffect(() => {
    function handleKeyDown(event) {
      const control = getKeyboardControl(event);
      if (!control) return;

      event.preventDefault();
      startControl(control);
    }

    function handleKeyUp(event) {
      const control = getKeyboardControl(event);
      if (!control) return;

      event.preventDefault();
      stopControl(control);
    }

    function handleWindowBlur() {
      if (!activeControlRef.current || !onDriveCommand) return;

      activeControlRef.current = '';
      setActiveControl('');
      onDriveCommand('stand');
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [onDriveCommand]);

  useEffect(() => {
    function handleFullscreenChange() {
      if (!getFullscreenElement()) {
        setIsFullscreenFallback(false);
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  function handleFrameLoad(event) {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (!naturalWidth || !naturalHeight) return;

    event.currentTarget.parentElement?.style.setProperty(
      '--video-ratio',
      `${naturalWidth} / ${naturalHeight}`
    );
  }

  async function openFullscreen() {
    const shell = shellRef.current;
    if (!shell) return;

    if (isFullscreenFallback) {
      setIsFullscreenFallback(false);
      return;
    }

    const requestFullscreen = shell.requestFullscreen || shell.webkitRequestFullscreen;
    if (!requestFullscreen) {
      setIsFullscreenFallback(true);
      return;
    }

    try {
      await requestFullscreen.call(shell);
    } catch {
      setIsFullscreenFallback(true);
    }
  }

  function handleContextMenu(event) {
    if (getFullscreenElement() === shellRef.current || isFullscreenFallback) {
      event.preventDefault();
    }
  }

  async function startControl(control) {
    const command = DRIVE_CONTROLS[control]?.command;
    if (!command || !onDriveCommand) return;

    if (activeControlRef.current === control) return;

    activeControlRef.current = control;
    setActiveControl(control);
    await onDriveCommand(`start:${command}`);
  }

  async function stopControl(control) {
    if (!onDriveCommand || activeControlRef.current !== control) return;

    activeControlRef.current = '';
    setActiveControl('');
    await onDriveCommand('stand');
  }

  const shellClassName = [
    'video-shell',
    frame ? 'is-live' : '',
    isFullscreenFallback ? 'is-mobile-fullscreen' : ''
  ].filter(Boolean).join(' ');

  return (
    <section className="tool-panel live-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Vision</p>
          <h2>Live Camera</h2>
        </div>
        <Camera size={22} aria-hidden="true" />
      </div>

      <div
        ref={shellRef}
        className={shellClassName}
        onContextMenu={handleContextMenu}
      >
        <div className="video-topbar">
          <div className="video-status-group">
            <span className={frame ? 'video-state online' : 'video-state'}>
              <Radio size={15} aria-hidden="true" />
              {frame ? 'Live' : 'Offline'}
            </span>
            {recording ? (
              <span className="video-state recording">
                <Square size={14} aria-hidden="true" />
                Recording
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="video-fullscreen"
            onClick={openFullscreen}
            title={isFullscreenFallback ? 'Exit fullscreen' : 'Fullscreen video'}
            aria-label={isFullscreenFallback ? 'Exit fullscreen' : 'Fullscreen video'}
          >
            {isFullscreenFallback ? <Minimize2 size={16} aria-hidden="true" /> : <Expand size={16} aria-hidden="true" />}
          </button>
        </div>

        {frame ? (
          <img
            src={`data:image/jpeg;base64,${frame}`}
            alt="Robot live camera"
            draggable="false"
            onLoad={handleFrameLoad}
          />
        ) : (
          <div className="video-empty">
            <Camera size={38} aria-hidden="true" />
            <span>Waiting for live feed</span>
          </div>
        )}

        <div className="video-bottombar">
          <div className="drive-pad" aria-label="Robot direction controls">
            {Object.entries(DRIVE_CONTROLS).map(([code, control]) => (
              <DriveButton
                key={code}
                code={code}
                label={control.label}
                icon={control.icon}
                active={activeControl === code}
                onStart={startControl}
                onStop={stopControl}
              />
            ))}
          </div>
          <span>
            <Clock3 size={15} aria-hidden="true" />
            {formatTime(lastFrameAt)}
          </span>
        </div>
      </div>
    </section>
  );
}

function DriveButton({ code, label, icon, active, onStart, onStop }) {
  function start(event) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onStart(code);
  }

  function stop(event) {
    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onStop(code);
  }

  return (
    <button
      type="button"
      className={active ? 'drive-button active' : 'drive-button'}
      data-active={active ? 'true' : 'false'}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onContextMenu={(event) => event.preventDefault()}
      draggable="false"
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {icon}
      <strong>{code}</strong>
    </button>
  );
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement;
}

function getKeyboardControl(event) {
  return (
    ARROW_TO_CONTROL[event.key] ||
    KEY_TO_CONTROL[event.key?.toLowerCase()] ||
    CODE_TO_CONTROL[event.code]
  );
}

function formatTime(value) {
  if (!value) return 'No frame yet';
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
