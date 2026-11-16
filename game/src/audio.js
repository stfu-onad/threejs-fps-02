// audio.js — every sound is synthesised with WebAudio; there are no files.
// One job: turn game events into noise bursts, thumps and beeps that read
// as gunfire, reloads, footsteps and the bomb, at a volume scaled by the
// distance to the listener so the yard feels three-dimensional.

let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}

function env(gain, t0, a, peak, d) {
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + a);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}

function noiseBuffer(seconds) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

let sharedNoise = null;
function noise() {
  if (!sharedNoise) sharedNoise = noiseBuffer(1);
  return sharedNoise;
}

// vol: 0..1 loudness after distance scaling (the caller computes it).
// A shot is three layers: a supersonic snap (band-passed noise, very
// short), the body (low-passed noise) and a low thump — plus a short
// yard echo so distance reads in the sound, not just the volume.
export function playShot(defId, vol) {
  if (!ctx || vol <= 0.01) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = defId === 'longbow' ? 2600 : defId === 'breacher' ? 1500 : 3400;
  const g = ctx.createGain();
  const peak = (defId === 'breacher' || defId === 'longbow' ? 0.85 : 0.55) * vol;
  env(g, t, 0.004, peak, defId === 'p9' ? 0.09 : 0.13);
  src.connect(filter); filter.connect(g); g.connect(master);
  src.start(t); src.stop(t + 0.25);
  // snap
  const snap = ctx.createBufferSource();
  snap.buffer = noise();
  const sf = ctx.createBiquadFilter();
  sf.type = 'bandpass'; sf.frequency.value = 2100; sf.Q.value = 0.7;
  const sg = ctx.createGain();
  env(sg, t, 0.002, 0.4 * vol, 0.045);
  snap.connect(sf); sf.connect(sg); sg.connect(master);
  snap.start(t); snap.stop(t + 0.08);
  // echo off the container stacks
  const echo = ctx.createBufferSource();
  echo.buffer = noise();
  const ef = ctx.createBiquadFilter();
  ef.type = 'lowpass'; ef.frequency.value = 900;
  const eg = ctx.createGain();
  env(eg, t + 0.11, 0.01, 0.13 * vol, 0.16);
  echo.connect(ef); ef.connect(eg); eg.connect(master);
  echo.start(t + 0.11); echo.stop(t + 0.45);
  // low thump under the crack
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(defId === 'breacher' ? 110 : 150, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + 0.1);
  const og = ctx.createGain();
  env(og, t, 0.003, 0.5 * vol, 0.11);
  osc.connect(og); og.connect(master);
  osc.start(t); osc.stop(t + 0.16);
}

export function playDryfire(vol) { blip(1900, 0.05, 0.12 * vol, 'square'); }
export function playReload(vol) {
  if (!ctx) return;
  blip(700, 0.04, 0.14 * vol, 'square');
  setTimeout(() => blip(480, 0.04, 0.14 * vol, 'square'), 160);
  setTimeout(() => blip(950, 0.05, 0.16 * vol, 'square'), 420);
}
export function playHitmarker(kill) { blip(kill ? 1560 : 1180, 0.05, 0.2, 'square'); }
export function playHurt() { blip(220, 0.12, 0.22, 'sawtooth'); }
export function playFootstep(vol) {
  if (!ctx || vol <= 0.02) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 480; f.Q.value = 0.8;
  const g = ctx.createGain();
  env(g, t, 0.005, 0.16 * vol, 0.07);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + 0.12);
}
export function playExplosion(vol) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise();
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 700;
  const g = ctx.createGain();
  env(g, t, 0.006, 0.95 * vol, 0.7);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + 0.9);
  // sub-bass drop and a long rumble tail under the blast
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(96, t);
  sub.frequency.exponentialRampToValueAtTime(28, t + 0.55);
  const sgb = ctx.createGain();
  env(sgb, t, 0.008, 0.8 * vol, 0.6);
  sub.connect(sgb); sgb.connect(master);
  sub.start(t); sub.stop(t + 0.8);
  const rum = ctx.createBufferSource();
  rum.buffer = noise();
  const rf = ctx.createBiquadFilter();
  rf.type = 'lowpass'; rf.frequency.value = 240;
  const rg = ctx.createGain();
  env(rg, t + 0.15, 0.05, 0.3 * vol, 1.1);
  rum.connect(rf); rf.connect(rg); rg.connect(master);
  rum.start(t + 0.15); rum.stop(t + 1.6);
}

// ------------------------------------------------------------- ambience
// The harbour under the fight: looped wind through a slow-breathing
// filter, water against the dock, and a gull every so often. Started
// once from initAudio's first user gesture (startMatch calls it).
let ambientOn = false;
export function startAmbient() {
  if (!ctx || ambientOn) return;
  ambientOn = true;
  const wind = ctx.createBufferSource();
  wind.buffer = noiseBuffer(3);
  wind.loop = true;
  const wf = ctx.createBiquadFilter();
  wf.type = 'lowpass'; wf.frequency.value = 420;
  const wg = ctx.createGain();
  wg.gain.value = 0.045;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.02;
  lfo.connect(lfoG); lfoG.connect(wg.gain);
  wind.connect(wf); wf.connect(wg); wg.connect(master);
  wind.start(); lfo.start();
  const gull = () => {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1350, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.28);
    const og = ctx.createGain();
    env(og, t, 0.03, 0.028, 0.3);
    o.connect(og); og.connect(master);
    o.start(t); o.stop(t + 0.4);
    setTimeout(gull, 6000 + Math.random() * 11000);
  };
  setTimeout(gull, 3500);
}
export function playBeep(freq = 1180, when = 0) { blip(freq, 0.07, 0.16, 'square', when); }
export function playClick() { blip(1250, 0.03, 0.1, 'square'); }
export function playBuy() { blip(880, 0.05, 0.14, 'square'); setTimeout(() => blip(1320, 0.06, 0.14, 'square'), 70); }
export function playSting(win) {
  if (!ctx) return;
  const notes = win ? [392, 523, 659] : [330, 262, 196];
  notes.forEach((n, i) => blip(n, 0.22, 0.13, 'triangle', i * 0.13));
}

function blip(freq, dur, vol, type = 'square', delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ctx.createGain();
  env(g, t, 0.005, vol, dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.05);
}

// Loudness of a sound at (x, z) for a listener at (lx, lz).
export function volumeAt(x, z, lx, lz, base = 1) {
  const d = Math.hypot(x - lx, z - lz);
  return base * Math.max(0, 1 - d / 46);
}
