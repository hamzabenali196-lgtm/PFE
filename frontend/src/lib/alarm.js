// Self-contained two-tone siren built with the Web Audio API — no audio files.
// Browsers block sound until the user has interacted with the page; if that
// happens we retry on the next click/keypress while the alarm is still active.

let audio = null;
let retryHandler = null;

export function startAlarm() {
  if (audio) return;

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 800;
  gain.gain.value = 0.06;

  // LFO square wave shifts the pitch ±180 Hz twice a second -> "nee-naw" siren.
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = 'square';
  lfo.frequency.value = 2;
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  lfo.start();

  audio = { ctx, osc, lfo };

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
    retryHandler = () => {
      audio?.ctx.resume().catch(() => {});
      removeRetry();
    };
    window.addEventListener('pointerdown', retryHandler);
    window.addEventListener('keydown', retryHandler);
  }
}

export function stopAlarm() {
  removeRetry();
  if (!audio) return;
  try {
    audio.osc.stop();
    audio.lfo.stop();
    audio.ctx.close();
  } catch {
    // context already closed — nothing to do
  }
  audio = null;
}

function removeRetry() {
  if (!retryHandler) return;
  window.removeEventListener('pointerdown', retryHandler);
  window.removeEventListener('keydown', retryHandler);
  retryHandler = null;
}
