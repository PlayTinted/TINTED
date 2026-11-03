// Tinted — deterministic orb engine.
// Runs identically on the phone (to play) and in the finish-duel edge function (to re-check scores).
// Units: orb radius = 1. No timers, no Math.random: everything comes from the seed and the input list.
// Input list: each entry is either a shot angle (radians, -π..0) or SWAP (swap current and next orb).

export const COLS = 9;
export const ROWS = 12;
export const START_ROWS = 7; // one row deeper than v1: less room before the ceiling catches you
export const COLOURS = 5;
export const HEARTS_PER_BOARD = 3;
export const RH = Math.sqrt(3);
export const WIDTH = 2 * COLS + 1;
export const HEIGHT = ROWS * RH + 7;
export const LAUNCH = { x: WIDTH / 2, y: HEIGHT - 2.2 };
export const DEATH_Y = HEIGHT - 4.6;
export const MIN_ANGLE = -Math.PI + 0.17;
export const MAX_ANGLE = -0.17;
export const SWAP = 9; // outside the angle range, so it can never be mistaken for a shot
export const POINTS = { pop: 10, drop: 20, bigCombo: 40, heart: 75, clear: 250 };
export const MAX_STREAK_BONUS = 6; // multiplier tops out at 1 + 6 × 0.5 = 4×, so skilled streaks pull away
export const MISSES_PER_DROP = 4; // ceiling drops after this many shots in a row that don't pop
export const CREEP_EVERY = 12;    // and creeps down every this many shots regardless

export function makeRng(seed) {
  let s = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const cellX = (r, c) => 1 + c * 2 + (r & 1 ? 1 : 0);
export const cellY = (state, r) => state.topY + 1 + r * RH;
export const multiplierFor = (streak) => 1 + Math.min(Math.max(streak - 1, 0), MAX_STREAK_BONUS) * 0.5;

function emptyGrid() {
  return Array.from({ length: ROWS + 2 }, () => Array(COLS).fill(null));
}

function fillBoard(state) {
  const { rnd } = state;
  state.grid = emptyGrid();
  state.topY = 0;
  for (let r = 0; r < START_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const left = c > 0 && state.grid[r][c - 1];
      const up = r > 0 && state.grid[r - 1][c];
      let colour = Math.floor(rnd() * COLOURS);
      const roll = rnd();
      if (left && roll < 0.45) colour = left.colour;
      else if (up && roll < 0.8) colour = up.colour;
      state.grid[r][c] = { colour, heart: false };
    }
  }
  // Fair boards: hearts sit in the middle rows (reachable, never buried at the top),
  // and never two in the same row, so each one is a separate goal.
  const usedRows = new Set();
  let placed = 0, guard = 0;
  while (placed < HEARTS_PER_BOARD && guard++ < 300) {
    const r = 2 + Math.floor(rnd() * (START_ROWS - 2));
    const c = Math.floor(rnd() * COLS);
    if (usedRows.has(r) && guard < 200) continue;
    if (!state.grid[r][c].heart) { state.grid[r][c].heart = true; usedRows.add(r); placed++; }
  }
}

export function neighbours(r, c) {
  const off = r & 1 ? [[-1, 0], [-1, 1], [1, 0], [1, 1]] : [[-1, -1], [-1, 0], [1, -1], [1, 0]];
  const out = [];
  for (const [dr, dc] of [[0, -1], [0, 1], ...off]) {
    const a = r + dr, b = c + dc;
    if (a >= 0 && a < ROWS + 2 && b >= 0 && b < COLS) out.push([a, b]);
  }
  return out;
}

function coloursPresent(state) {
  const set = new Set();
  for (const row of state.grid) for (const b of row) if (b) set.add(b.colour);
  return [...set].sort((a, b) => a - b);
}

// Colours of orbs the player can actually hit: ones with an empty cell below them.
function exposedColours(state) {
  const set = new Set();
  for (let r = 0; r < ROWS + 1; r++) {
    for (let c = 0; c < COLS; c++) {
      const b = state.grid[r][c];
      if (!b) continue;
      const below = neighbours(r, c).filter(([a]) => a > r);
      if (below.some(([a, cc]) => !state.grid[a][cc])) set.add(b.colour);
    }
  }
  return [...set].sort((a, b) => a - b);
}

// Next orb: usually a colour you can use right now, sometimes any colour still on the board.
function pickColour(state) {
  const present = coloursPresent(state);
  const exposed = exposedColours(state);
  const roll = state.rnd();
  const pool = exposed.length && roll < 0.6 ? exposed : present.length ? present : [0, 1, 2, 3, 4];
  return pool[Math.floor(state.rnd() * pool.length)];
}

export function createGame(seed) {
  const state = {
    seed: Number(seed) >>> 0,
    rnd: makeRng(seed),
    grid: null,
    topY: 0,
    score: 0,
    hearts: 0,
    shots: 0,
    swaps: 0,
    streak: 0,
    bestStreak: 0,
    sincePop: 0,
    over: false,
    cur: 0,
    nxt: 0,
  };
  fillBoard(state);
  state.cur = pickColour(state);
  state.nxt = pickColour(state);
  return state;
}

export function clampAngle(a) {
  const q = Math.round(Number(a) * 1e4) / 1e4;
  if (!Number.isFinite(q)) return -Math.PI / 2;
  return Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, q));
}

function snapCell(state, px, py) {
  const r0 = Math.max(0, Math.round((py - state.topY - 1) / RH));
  let best = null, bestD = Infinity;
  for (let r = Math.max(0, r0 - 1); r <= Math.min(ROWS + 1, r0 + 1); r++) {
    for (let c = 0; c < COLS; c++) {
      if (state.grid[r][c]) continue;
      const attached = r === 0 || neighbours(r, c).some(([a, b]) => state.grid[a][b]);
      if (!attached) continue;
      const d = Math.hypot(cellX(r, c) - px, cellY(state, r) - py);
      if (d < bestD) { bestD = d; best = [r, c]; }
    }
  }
  return best;
}

// Trace a shot without changing anything. Returns the flight path and the cell it would land in.
function trace(state, angle) {
  let x = LAUNCH.x, y = LAUNCH.y;
  let vx = Math.cos(angle), vy = Math.sin(angle);
  const step = 0.35;
  const path = [{ x, y }];
  for (let i = 0; i < 4000; i++) {
    x += vx * step; y += vy * step;
    if (x < 1) { x = 2 - x; vx = -vx; path.push({ x, y }); }
    if (x > WIDTH - 1) { x = 2 * (WIDTH - 1) - x; vx = -vx; path.push({ x, y }); }
    let hit = y - 1 <= state.topY;
    if (!hit) {
      outer: for (let r = 0; r < ROWS + 2; r++) {
        for (let c = 0; c < COLS; c++) {
          if (state.grid[r][c] && Math.hypot(cellX(r, c) - x, cellY(state, r) - y) < 1.72) { hit = true; break outer; }
        }
      }
    }
    if (hit) {
      path.push({ x, y });
      return { path, cell: snapCell(state, x, y) };
    }
  }
  path.push({ x, y });
  return { path, cell: null };
}

// For the aiming preview: where would a shot at this angle land, and would it pop?
export function preview(state, rawAngle) {
  const angle = clampAngle(rawAngle);
  const { path, cell } = trace(state, angle);
  if (!cell) return { path, cell: null, wouldPop: false };
  const [r, c] = cell;
  const colour = state.cur;
  let same = 1;
  const seen = new Set([`${r},${c}`]);
  const queue = [[r, c]];
  for (let i = 0; i < queue.length; i++) {
    for (const [a, b] of neighbours(queue[i][0], queue[i][1])) {
      const k = `${a},${b}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (state.grid[a][b] && state.grid[a][b].colour === colour) { same++; queue.push([a, b]); }
    }
  }
  return { path, cell, wouldPop: same >= 3 };
}

export function swap(state) {
  if (state.over) return false;
  [state.cur, state.nxt] = [state.nxt, state.cur];
  state.swaps++;
  return true;
}

// Fire the current orb. Mutates state and returns what happened.
export function fire(state, rawAngle) {
  if (state.over) return null;
  const angle = clampAngle(rawAngle);
  const colour = state.cur;
  const { path, cell } = trace(state, angle);
  const result = { angle, colour, path, cell, popped: [], dropped: [], heartsFound: 0, base: 0, multiplier: 1, gained: 0, streak: 0, cleared: false, ceilingDropped: false, over: false };
  state.shots++;
  if (!cell) { state.over = true; result.over = true; return result; }

  const [r, c] = cell;
  state.grid[r][c] = { colour, heart: false };

  const group = [[r, c]];
  const seen = new Set([`${r},${c}`]);
  for (let i = 0; i < group.length; i++) {
    for (const [a, b] of neighbours(group[i][0], group[i][1])) {
      const k = `${a},${b}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (state.grid[a][b] && state.grid[a][b].colour === colour) group.push([a, b]);
    }
  }

  if (group.length >= 3) {
    state.sincePop = 0;
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    for (const [a, b] of group) {
      const bub = state.grid[a][b];
      result.popped.push({ r: a, c: b, colour: bub.colour, heart: bub.heart });
      if (bub.heart) result.heartsFound++;
      state.grid[a][b] = null;
      result.base += POINTS.pop;
    }
    if (group.length >= 5) result.base += POINTS.bigCombo;

    const keep = new Set();
    const queue = [];
    for (let cc = 0; cc < COLS; cc++) if (state.grid[0][cc]) { queue.push([0, cc]); keep.add(`0,${cc}`); }
    for (let i = 0; i < queue.length; i++) {
      for (const [a, b] of neighbours(queue[i][0], queue[i][1])) {
        const k = `${a},${b}`;
        if (!keep.has(k) && state.grid[a][b]) { keep.add(k); queue.push([a, b]); }
      }
    }
    for (let a = 0; a < ROWS + 2; a++) {
      for (let b = 0; b < COLS; b++) {
        const bub = state.grid[a][b];
        if (bub && !keep.has(`${a},${b}`)) {
          result.dropped.push({ r: a, c: b, colour: bub.colour, heart: bub.heart });
          if (bub.heart) result.heartsFound++;
          state.grid[a][b] = null;
          result.base += POINTS.drop;
        }
      }
    }
    result.base += result.heartsFound * POINTS.heart;
    result.multiplier = multiplierFor(state.streak);
  } else {
    state.streak = 0;
    state.sincePop++;
    if (state.sincePop >= MISSES_PER_DROP) { state.sincePop = 0; state.topY += RH * 0.5; result.ceilingDropped = true; }
  }
  // The ceiling creeps whatever you do, so slow, safe play loses to fast, accurate play.
  if (state.shots % CREEP_EVERY === 0 && !result.ceilingDropped) { state.topY += RH * 0.5; result.ceilingDropped = true; }
  result.streak = state.streak;
  state.hearts += result.heartsFound;

  const empty = state.grid.every(row => row.every(b => !b));
  if (empty) {
    result.cleared = true;
    result.base += POINTS.clear;
    fillBoard(state);
  }
  result.gained = Math.round(result.base * result.multiplier);
  state.score += result.gained;

  for (let a = 0; a < ROWS + 2 && !state.over; a++) {
    for (let b = 0; b < COLS; b++) {
      if (state.grid[a][b] && cellY(state, a) + 1 > DEATH_Y) { state.over = true; break; }
    }
  }
  result.over = state.over;

  const present = coloursPresent(state);
  let next = state.nxt;
  if (present.length && !present.includes(next)) next = pickColour(state);
  state.cur = next;
  state.nxt = pickColour(state);
  return result;
}

// One entry from the input list: a swap or a shot.
export function applyInput(state, input) {
  if (input === SWAP) { swap(state); return { swapped: true }; }
  return fire(state, input);
}

// Server-side check: replay the input list and return the true score.
export const MAX_SHOTS = 400; // inputs, swaps included
export function replay(seed, inputs) {
  const state = createGame(seed);
  let used = 0;
  for (const x of inputs) {
    if (state.over || used >= MAX_SHOTS) break;
    applyInput(state, x);
    used++;
  }
  return { score: state.score, hearts: state.hearts, shots: state.shots, swaps: state.swaps, bestStreak: state.bestStreak, over: state.over };
}

// Clone the grid for drawing while a shot is still animating.
export function snapshotGrid(state) {
  return { grid: state.grid.map(row => row.map(b => (b ? { ...b } : null))), topY: state.topY };
}
