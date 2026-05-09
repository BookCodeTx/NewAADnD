let ctx = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function noise(duration, volume = 0.3) {
  const ac = getCtx();
  const len = ac.sampleRate * duration;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * volume * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.start();
}

function tone(freq, dur, type = "sine", vol = 0.3) {
  const ac = getCtx();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur);
}

function sweep(startFreq, endFreq, dur, type = "sine", vol = 0.2) {
  const ac = getCtx();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(startFreq, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(endFreq, ac.currentTime + dur);
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur);
}

export function playDiceHit() {
  noise(0.06, 0.25);
  tone(700, 0.08, "square", 0.08);
}

export function playAttackHit() {
  noise(0.04, 0.4);
  tone(180, 0.15, "sawtooth", 0.25);
  tone(120, 0.2, "square", 0.15);
}

export function playCrit() {
  tone(440, 0.35, "sine", 0.25);
  setTimeout(() => tone(880, 0.3, "sine", 0.25), 80);
  setTimeout(() => tone(1320, 0.4, "sine", 0.2), 160);
  setTimeout(() => noise(0.05, 0.3), 50);
}

export function playMiss() {
  sweep(500, 150, 0.25, "sine", 0.15);
}

export function playSpellCast() {
  sweep(250, 1400, 0.35, "sine", 0.18);
  setTimeout(() => sweep(400, 1800, 0.25, "triangle", 0.1), 60);
}

export function playDamage() {
  tone(70, 0.2, "sawtooth", 0.35);
  noise(0.04, 0.3);
  setTimeout(() => tone(55, 0.15, "square", 0.2), 40);
}

export function playHeal() {
  tone(523, 0.2, "sine", 0.2);
  setTimeout(() => tone(659, 0.2, "sine", 0.2), 100);
  setTimeout(() => tone(784, 0.25, "sine", 0.15), 200);
}

const SFX_MAP = {
  "dice-hit": playDiceHit,
  "attack-hit": playAttackHit,
  crit: playCrit,
  miss: playMiss,
  spell: playSpellCast,
  damage: playDamage,
  heal: playHeal,
};

export function playSfx(name) {
  SFX_MAP[name]?.();
}
