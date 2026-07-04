import { Mic, MicOff, PhoneCall, PhoneOff, RadioTower } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const TALK_SAMPLE_RATE = 16000;

export default function MicPanel({
  mic,
  socket,
  onToggle,
  onVoiceCommand
}) {
  const [listening, setListening] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [talking, setTalking] = useState(false);
  const [talkError, setTalkError] = useState('');
  const recognitionRef = useRef(null);
  const audioContextRef = useRef(null);
  const nextPlayTimeRef = useRef(0);
  const talkRef = useRef(null);
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

  // ── Talk: stream the operator's mic to the robot's Bluetooth speaker ──
  useEffect(() => () => stopTalk(), []); // release the mic on unmount

  async function startTalk() {
    if (!socket) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setTalkError(
        'Browser mic needs a secure context. Open the dashboard over HTTPS, or in Chrome add '
        + 'this URL under chrome://flags/#unsafely-treat-insecure-origin-as-secure.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext({ sampleRate: TALK_SAMPLE_RATE });
      if (ctx.state === 'suspended') await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        const input = downsample(event.inputBuffer.getChannelData(0), ctx.sampleRate);
        const pcm = new Int16Array(input.length);
        for (let index = 0; index < input.length; index += 1) {
          const sample = Math.max(-1, Math.min(1, input[index]));
          pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        socket.emit('robot:talk:audio', pcm.buffer);
      };

      source.connect(processor);
      processor.connect(ctx.destination); // required for onaudioprocess; outputs silence

      socket.emit('robot:talk:start', (response) => {
        if (response && !response.ok) {
          setTalkError(response.error || 'Robot speaker unavailable');
          stopTalk();
        }
      });

      talkRef.current = { ctx, stream, source, processor };
      setTalking(true);
      setTalkError('');
    } catch (error) {
      setTalkError(`Browser mic unavailable: ${error.message}`);
    }
  }

  function stopTalk() {
    const talk = talkRef.current;
    talkRef.current = null;
    setTalking(false);
    if (!talk) return;

    socket?.emit('robot:talk:stop');
    talk.processor.disconnect();
    talk.source.disconnect();
    talk.stream.getTracks().forEach((track) => track.stop());
    talk.ctx.close();
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

      <button
        type="button"
        className={talking ? 'mic-toggle talking' : 'mic-toggle'}
        onClick={() => (talking ? stopTalk() : startTalk())}
        aria-pressed={talking}
      >
        {talking ? <PhoneOff size={18} aria-hidden="true" /> : <PhoneCall size={18} aria-hidden="true" />}
        <span>{talking ? 'Stop talking' : 'Talk through robot'}</span>
      </button>

      <div className="mic-meter" aria-label="Microphone level">
        <span style={{ width: `${Math.round((mic?.level || 0) * 100)}%` }} />
      </div>

      <div className="mic-status">
        <div>
          <RadioTower size={17} aria-hidden="true" />
          <span>{mic?.device || 'No USB device selected'}</span>
        </div>
        <strong>
          {talking
            ? 'Your voice → robot speaker'
            : enabled ? 'Monitoring audio' : 'Mic off'}
        </strong>
      </div>

      {transcript ? <p className="mic-transcript">{transcript}</p> : null}
      {mic?.error ? <p className="mic-error">{mic.error}</p> : null}
      {talkError ? <p className="mic-error">{talkError}</p> : null}
      {!speechSupported ? <p className="mic-error">Speech commands are not supported by this browser.</p> : null}
    </section>
  );
}

// Most browsers honor the 16 kHz AudioContext and this is a no-op; if the
// context runs at its hardware rate instead, decimate down to 16 kHz.
function downsample(input, fromRate) {
  if (fromRate === TALK_SAMPLE_RATE) return input;
  const ratio = fromRate / TALK_SAMPLE_RATE;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = input[Math.floor(index * ratio)];
  }
  return output;
}

async function toUint8Array(chunk) {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (chunk instanceof Blob) return new Uint8Array(await chunk.arrayBuffer());
  return new Uint8Array(chunk);
}
