import { Mic, MicOff, RadioTower } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export default function MicPanel({
  mic,
  socket,
  onToggle,
  onVoiceCommand
}) {
  const [listening, setListening] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef(null);
  const audioContextRef = useRef(null);
  const nextPlayTimeRef = useRef(0);
  const enabled = Boolean(mic?.enabled);
  const speechSupported = Boolean(SpeechRecognition);

  useEffect(() => {
    if (!enabled) {
      setMonitoring(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !speechSupported) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onstart = () => setListening(true);
    recognition.onend = () => {
      setListening(false);
      if (enabled && recognitionRef.current === recognition) {
        recognition.start();
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event) => {
      const text = event.results[event.results.length - 1][0].transcript.trim();
      setTranscript(text);
      onVoiceCommand(text);
    };

    recognitionRef.current = recognition;
    recognition.start();

    return () => {
      recognitionRef.current = null;
      recognition.stop();
    };
  }, [enabled, onVoiceCommand, speechSupported]);

  useEffect(() => {
    if (!socket || !enabled || !monitoring) return undefined;

    const playAudioChunk = async (chunk) => {
      const audioContext = await getAudioContext();
      if (!audioContext) return;

      const bytes = await toUint8Array(chunk);
      const sampleCount = Math.floor(bytes.byteLength / 2);
      if (!sampleCount) return;

      const buffer = audioContext.createBuffer(1, sampleCount, 16000);
      const channel = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      for (let index = 0; index < sampleCount; index += 1) {
        channel[index] = view.getInt16(index * 2, true) / 32768;
      }

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);

      const startAt = Math.max(audioContext.currentTime + 0.03, nextPlayTimeRef.current);
      source.start(startAt);
      nextPlayTimeRef.current = startAt + buffer.duration;
    };

    socket.on('robot:mic:audio', playAudioChunk);

    return () => {
      socket.off('robot:mic:audio', playAudioChunk);
    };
  }, [enabled, monitoring, socket]);

  async function getAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    return audioContextRef.current;
  }

  return (
    <section className="tool-panel mic-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Audio</p>
          <h2>USB Microphone</h2>
        </div>
        {enabled ? <Mic size={22} aria-hidden="true" /> : <MicOff size={22} aria-hidden="true" />}
      </div>

      <button
        type="button"
        className={enabled ? 'mic-toggle active' : 'mic-toggle'}
        onClick={() => {
          const nextEnabled = !enabled;
          onToggle(nextEnabled);
          if (nextEnabled) setMonitoring(true);
        }}
        aria-pressed={enabled}
      >
        {enabled ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
        <span>{enabled ? 'Deactivate mic' : 'Activate mic & monitor'}</span>
      </button>

      <div className="mic-meter" aria-label="Microphone level">
        <span style={{ width: `${Math.round((mic?.level || 0) * 100)}%` }} />
      </div>

      <div className="mic-status">
        <div>
          <RadioTower size={17} aria-hidden="true" />
          <span>{mic?.device || 'No USB device selected'}</span>
        </div>
        <strong>{enabled ? 'Monitoring audio' : 'Mic off'}</strong>
      </div>

      {transcript ? <p className="mic-transcript">{transcript}</p> : null}
      {mic?.error ? <p className="mic-error">{mic.error}</p> : null}
      {!speechSupported ? <p className="mic-error">Speech commands are not supported by this browser.</p> : null}
    </section>
  );
}

async function toUint8Array(chunk) {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (chunk instanceof Blob) return new Uint8Array(await chunk.arrayBuffer());
  return new Uint8Array(chunk);
}
