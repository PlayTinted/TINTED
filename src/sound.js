// Sounds made on the fly with Web Audio: no files to download. Starts on the first tap (browsers require it).
let ctx = null, master = null, muted = false;
try { muted = localStorage.getItem("tinted:muted") === "1"; } catch { /* storage blocked */ }

export function unlockAudio() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  } catch { ctx = null; }
}
export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("tinted:muted", m ? "1" : "0"); } catch { /* ignore */ }
  if (master) master.gain.value = m ? 0 : 0.5;
}

function tone(freq, { at = 0, dur = 0.15, type = "sine", vol = 0.3, slide = 0 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise({ at = 0, dur = 0.12, vol = 0.2, freq = 2000, q = 1 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf; f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

// Pentatonic so streaks always sound musical.
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

export const sfx = {
  shoot() { noise({ dur: 0.09, vol: 0.12, freq: 1400, q: 0.7 }); },
  swap() { tone(660, { dur: 0.06, type: "triangle", vol: 0.15 }); tone(880, { at: 0.05, dur: 0.06, type: "triangle", vol: 0.12 }); },
  stick() { tone(180, { dur: 0.08, type: "triangle", vol: 0.18, slide: 0.7 }); },
  shatter(count, streak) {
    const base = SCALE[Math.min(streak, SCALE.length - 1)];
    noise({ dur: 0.18, vol: 0.18, freq: 5200, q: 2.5 });
    tone(base, { dur: 0.22, type: "sine", vol: 0.22 });
    if (count >= 5) tone(base * 1.5, { at: 0.06, dur: 0.25, type: "sine", vol: 0.16 });
  },
  heart() { [0, 0.09, 0.18, 0.3].forEach((at, i) => tone([659.25, 783.99, 987.77, 1318.51][i], { at, dur: 0.5, type: "sine", vol: 0.18 })); },
  ceiling() { tone(110, { dur: 0.35, type: "sawtooth", vol: 0.08, slide: 0.6 }); },
  tick() { tone(1200, { dur: 0.04, type: "square", vol: 0.05 }); },
  go() { tone(784, { dur: 0.12, vol: 0.2 }); tone(1175, { at: 0.1, dur: 0.25, vol: 0.2 }); },
  end() { [523.25, 659.25, 783.99].forEach((f, i) => tone(f, { at: i * 0.12, dur: 0.4, vol: 0.16 })); },
};
