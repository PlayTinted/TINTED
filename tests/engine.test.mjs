// Engine tests: replays must be exact (the server depends on it), and boards should be fair to play.
import { createGame, fire, swap, preview, replay, applyInput, SWAP, MIN_ANGLE, MAX_ANGLE } from "../shared/engine.js";

let failures = 0;
const fail = (m) => { console.error("FAIL:", m); failures++; };
const rng = (seed) => { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };

// 1. Random play with swaps: the replay must match the live game exactly.
let mism = 0;
for (let g = 0; g < 300; g++) {
  const seed = (g * 2654435761) >>> 0, r = rng(g + 7);
  const st = createGame(seed); const inputs = [];
  while (!st.over && inputs.length < 80) {
    const x = r() < 0.15 ? SWAP : MIN_ANGLE + r() * (MAX_ANGLE - MIN_ANGLE);
    inputs.push(x); applyInput(st, x);
  }
  const rep = replay(seed, inputs);
  if (rep.score !== st.score || rep.hearts !== st.hearts || rep.swaps !== st.swaps) mism++;
}
if (mism) fail(`${mism} replays did not match`);

// 2. A tampered seed or input list changes the result.
{
  const s = createGame(7); const inputs = [];
  for (let i = 0; i < 25 && !s.over; i++) { const a = -1.2 - i * 0.04; inputs.push(a); fire(s, a); }
  if (replay(7, inputs).score !== s.score) fail("fixed game replay mismatch");
  if (replay(8, inputs).score === s.score && s.score > 0) fail("different seed gave identical score");
}

// 3. Swap swaps, and the preview never changes the board.
{
  const s = createGame(42); const [c, n] = [s.cur, s.nxt]; swap(s);
  if (s.cur !== n || s.nxt !== c) fail("swap did not exchange orbs");
  const before = JSON.stringify(s.grid); preview(s, -1.3);
  if (JSON.stringify(s.grid) !== before) fail("preview changed the board");
}

// 4. Fairness: a player who aims for pops (using the preview, swapping when it helps) should score well.
const scores = [], heartsFound = [], streaks = [];
for (let g = 0; g < 120; g++) {
  const seed = (g * 40503 + 11) >>> 0;
  const st = createGame(seed);
  for (let t = 0; t < 45 && !st.over; t++) {
    let best = null;
    for (let tries = 0; tries < 2 && !best; tries++) {
      for (let a = MIN_ANGLE; a <= MAX_ANGLE; a += 0.05) { if (preview(st, a).wouldPop) { best = a; break; } }
      if (!best && tries === 0) swap(st);
    }
    fire(st, best ?? -Math.PI / 2 + (t % 7 - 3) * 0.2);
  }
  scores.push(st.score); heartsFound.push(st.hearts); streaks.push(st.bestStreak);
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log({ replayMismatches: mism, aimedPlayer: { medianScore: med(scores), avgHearts: +avg(heartsFound).toFixed(2), avgBestStreak: +avg(streaks).toFixed(2) } });
if (avg(heartsFound) < 1) fail("an aimed player frees fewer than 1 heart per duel on average");

if (failures) process.exit(1);
console.log("Engine tests passed");
