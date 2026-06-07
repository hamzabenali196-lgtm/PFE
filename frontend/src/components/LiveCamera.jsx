import { Camera, Clock3, Expand, Minimize2, Radio, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const ARROW_TO_CONTROL = {
  ArrowUp: 'Z',
  ArrowLeft: 'Q',
  ArrowDown: 'S',
  ArrowRight: 'D'
};

const KEY_TO_CONTROL = { z: 'Z', q: 'Q', s: 'S', d: 'D' };
const CODE_TO_CONTROL = { KeyZ: 'Z', KeyQ: 'Q', KeyS: 'S', KeyD: 'D' };

const CONTROL_COMMANDS = {
  Z: 'forward',
  Q: 'left',
  S: 'backward',
  D: 'right'
};

export default function LiveCamera({ frame, lastFrameAt, video, onDriveCommand }) {
  const recording = Boolean(video?.recording);
  const shellRef = useRef(null);
  const [isFullscreenFallback, setIsFullscreenFallback] = useState(false);
  const activeControlRef = useRef('');

  useEffect(() => {
    function handleKeyDown(event) {
      const control = getKeyboardControl(event);
      if (!control) return;
      event.preventDefault();
      if (activeControlRef.current === control) return;
      activeControlRef.current = control;
      onDriveCommand?.(`start:${CONTROL_COMMANDS[control]}`);
    }

    function handleKeyUp(event) {
      const control = getKeyboardControl(event);
      if (!control || activeControlRef.current !== control) return;
      event.preventDefault();
      activeControlRef.current = '';
      onDriveCommand?.('stand');
    }

    function handleWindowBlur() {
      if (!activeControlRef.current) return;
      activeControlRef.current = '';
      onDriveCommand?.('stand');
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
      if (!getFullscreenElement()) setIsFullscreenFallback(false);
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
    event.currentTarget.parentElement?.style.setProperty('--video-ratio', `${naturalWidth} / ${naturalHeight}`);
  }

  async function openFullscreen() {
    const shell = shellRef.current;
    if (!shell) return;
    if (isFullscreenFallback) { setIsFullscreenFallback(false); return; }
    const requestFullscreen = shell.requestFullscreen || shell.webkitRequestFullscreen;
    if (!requestFullscreen) { setIsFullscreenFallback(true); return; }
    try { await requestFullscreen.call(shell); } catch { setIsFullscreenFallback(true); }
  }

  const shellClassName = ['video-shell', isFullscreenFallback ? 'is-mobile-fullscreen' : ''].filter(Boolean).join(' ');

  return (
    <section className="tool-panel live-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Vision</p>
          <h2>Live Camera</h2>
        </div>
        <Camera size={22} aria-hidden="true" />
      </div>

      <div ref={shellRef} className={shellClassName} onContextMenu={(e) => e.preventDefault()}>
        <div className="video-topbar">
          <div className="video-status-group">
            <span className={frame ? 'video-state online' : 'video-state'}>
              <Radio size={14} aria-hidden="true" />
              {frame ? 'Live' : 'Offline'}
            </span>
            {recording ? (
              <span className="video-state recording">
                <Square size={13} aria-hidden="true" />
                Recording
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="video-fullscreen"
            onClick={openFullscreen}
            title={isFullscreenFallback ? 'Exit fullscreen' : 'Fullscreen'}
            aria-label={isFullscreenFallback ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreenFallback ? <Minimize2 size={15} /> : <Expand size={15} />}
          </button>
        </div>

        {frame ? (
          <img src={`data:image/jpeg;base64,${frame}`} alt="Robot live camera" draggable="false" onLoad={handleFrameLoad} />
        ) : (
          <div className="video-empty">
            <Camera size={36} aria-hidden="true" />
            <span>Waiting for live feed</span>
          </div>
        )}

        <div className="video-bottombar">
          <span>
            <Clock3 size={14} aria-hidden="true" />
            {formatTime(lastFrameAt)}
          </span>
        </div>
      </div>
    </section>
  );
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement;
}

function getKeyboardControl(event) {
  return ARROW_TO_CONTROL[event.key] || KEY_TO_CONTROL[event.key?.toLowerCase()] || CODE_TO_CONTROL[event.code];
}

function formatTime(value) {
  if (!value) return 'No frame yet';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
