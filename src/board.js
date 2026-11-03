// The playing board: draws the ice orbs, handles aiming, swapping and shooting, and all the feedback
// (landing preview, shatter shards, screen shake, combo text, sound, haptics).
// Used by the live duel and by the practice board, so both feel identical.
import { fire, swap, preview, snapshotGrid, cellX, WIDTH, HEIGHT, LAUNCH, DEATH_Y, RH, COLS, ROWS, MIN_ANGLE, MAX_ANGLE, SWAP } from "../shared/engine.js";
import { haptic } from "./ui.js";
import { sfx, unlockAudio } from "./sound.js";

// Glacier-tinted jewel tones: ruby, amber, mint, sapphire, violet.
export const ORB_COLOURS = ["#ef5a7a", "#f5b94f", "#3fd1a6", "#4f93ff", "#a585ff"];
const FONT = '"Geist Variable", "Geist", system-ui, sans-serif';
const NEXT_POS = { x: LAUNCH.x + 3.4, y: LAUNCH.y + 0.7 };

const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const mix = (hex, t, k) => { const [r, g, b] = hexRgb(hex); const m = (v, w) => Math.round(v + (w - v) * k); return `rgb(${m(r, t[0])},${m(g, t[1])},${m(b, t[2])})`; };

export function createBoard(canvas, game, opts = {}) {
  const { canPlay = () => true, onInput = () => {}, onShot = () => {}, onFrame = () => {} } = opts;
  const ctx = canvas.getContext("2d");
  let S = 1, cssW = 0, cssH = 0, dpr = 1;
  let aim = -Math.PI / 2, aiming = false, cancelZone = false;
  let anim = null, swapAnim = 0;
  let shards = [], falling = [], texts = [], rings = [], shake = 0;
  let previewCache = { key: "", data: null };
  let raf = 0, last = performance.now(), destroyed = false, t0 = performance.now();
  const sprites = new Map();

  // ── Sprites: each orb is drawn once per size and colour, then stamped. Keeps 60fps on cheap phones. ──
  function orbSprite(colour, heart) {
    const key = `${colour}:${heart ? 1 : 0}:${S.toFixed(2)}`;
    if (sprites.has(key)) return sprites.get(key);
    const R = S, size = Math.ceil(R * 2.4 * dpr), c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    const X = R * 1.2, Y = R * 1.2, rr = R * 0.93;
    const base = heart ? "#cfe6ff" : ORB_COLOURS[colour];
    // Body: a glassy sphere, lighter top-left, deep bottom-right.
    const body = g.createRadialGradient(X - rr * 0.35, Y - rr * 0.45, rr * 0.05, X, Y, rr);
    body.addColorStop(0, mix(base, [255, 255, 255], 0.75));
    body.addColorStop(0.35, base);
    body.addColorStop(0.9, mix(base, [10, 20, 40], 0.45));
    body.addColorStop(1, mix(base, [10, 20, 40], 0.6));
    g.fillStyle = body; g.beginPath(); g.arc(X, Y, rr, 0, Math.PI * 2); g.fill();
    // Glassy rim.
    g.strokeStyle = "rgba(235,248,255,.55)"; g.lineWidth = Math.max(1, R * 0.08);
    g.beginPath(); g.arc(X, Y, rr - R * 0.04, 0, Math.PI * 2); g.stroke();
    // Ice facets: two pale shards of light.
    g.fillStyle = "rgba(255,255,255,.55)";
    g.beginPath(); g.moveTo(X - rr * 0.55, Y - rr * 0.15); g.lineTo(X - rr * 0.2, Y - rr * 0.62); g.lineTo(X - rr * 0.05, Y - rr * 0.5); g.lineTo(X - rr * 0.42, Y - rr * 0.02); g.closePath(); g.fill();
    g.fillStyle = "rgba(255,255,255,.25)";
    g.beginPath(); g.moveTo(X + rr * 0.25, Y + rr * 0.45); g.lineTo(X + rr * 0.55, Y + rr * 0.15); g.lineTo(X + rr * 0.6, Y + rr * 0.3); g.closePath(); g.fill();
    if (heart) {
      // A rose heart behind tinted glass, with a couple of hairline cracks.
      const s = R * 0.44, hx = X, hy = Y + s * 0.05;
      g.fillStyle = "#f2668b";
      g.beginPath();
      g.moveTo(hx, hy + s * 0.78);
      g.bezierCurveTo(hx - s * 1.3, hy - s * 0.1, hx - s * 0.6, hy - s * 1.15, hx, hy - s * 0.4);
      g.bezierCurveTo(hx + s * 0.6, hy - s * 1.15, hx + s * 1.3, hy - s * 0.1, hx, hy + s * 0.78);
      g.fill();
      g.fillStyle = "rgba(225,242,255,.38)"; g.beginPath(); g.arc(X, Y, rr * 0.92, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = Math.max(0.6, R * 0.04);
      g.beginPath(); g.moveTo(X + rr * 0.1, Y - rr * 0.85); g.lineTo(X + rr * 0.25, Y - rr * 0.4); g.lineTo(X + rr * 0.05, Y - rr * 0.15); g.stroke();
      g.beginPath(); g.moveTo(X - rr * 0.8, Y + rr * 0.3); g.lineTo(X - rr * 0.45, Y + rr * 0.35); g.stroke();
    }
    sprites.set(key, c);
    return c;
  }
  function stamp(x, y, colour, heart, alpha = 1, scale = 1) {
    const spr = orbSprite(colour, heart);
    const w = (spr.width / dpr) * scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(spr, x * S - w / 2, y * S - w / 2, w, w);
    ctx.globalAlpha = 1;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = canvas.parentElement.clientWidth; S = cssW / WIDTH; cssH = Math.round(HEIGHT * S);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr); canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sprites.clear();
  }
  resize();
  window.addEventListener("resize", resize);

  // ── Input: drag to aim, release to shoot. Tap your orb (or the next one) to swap. Drag below to cancel. ──
  const toBoard = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / S, y: (e.clientY - r.top) / S }; };
  function setAim(p) {
    cancelZone = p.y > LAUNCH.y + 0.6;
    let a = Math.atan2(p.y - LAUNCH.y, p.x - LAUNCH.x);
    if (a > 0) a = p.x < LAUNCH.x ? MIN_ANGLE : MAX_ANGLE;
    aim = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, a));
  }
  function doSwap() {
    if (!canPlay() || anim || game.over) return;
    if (swap(game)) { onInput(SWAP); swapAnim = 1; sfx.swap(); haptic(); }
  }
  function onDown(e) {
    unlockAudio();
    if (!canPlay() || anim || game.over) return;
    const p = toBoard(e);
    if (Math.hypot(p.x - LAUNCH.x, p.y - LAUNCH.y) < 1.7 || Math.hypot(p.x - NEXT_POS.x, p.y - NEXT_POS.y) < 1.5) { doSwap(); return; }
    aiming = true;
    canvas.setPointerCapture(e.pointerId);
    setAim(p);
  }
  function onMove(e) { if (aiming) setAim(toBoard(e)); }
  function onUp(e) {
    if (!aiming) return;
    aiming = false;
    setAim(toBoard(e));
    if (cancelZone) { cancelZone = false; return; }
    shoot();
  }
  function onKey(e) {
    if (!canPlay()) return;
    if (e.key === "ArrowLeft") aim = Math.max(MIN_ANGLE, aim - 0.04);
    else if (e.key === "ArrowRight") aim = Math.min(MAX_ANGLE, aim + 0.04);
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); shoot(); }
    else if (e.key.toLowerCase() === "s") doSwap();
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", () => { aiming = false; cancelZone = false; });
  canvas.tabIndex = 0;
  canvas.addEventListener("keydown", onKey);

  function shoot() {
    if (!canPlay() || anim || game.over) return;
    const before = snapshotGrid(game);
    const colour = game.cur;
    const res = fire(game, aim);
    if (!res) return;
    onInput(res.angle);
    sfx.shoot(); haptic();
    const pts = res.path, lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    anim = { pts, lens, total: lens.at(-1), d: 0, colour, before, res };
  }

  function burst(x, y, colour, heart) {
    const col = heart ? "#ffd6e2" : ORB_COLOURS[colour];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5, sp = 6 + Math.random() * 7;
      shards.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, size: 0.25 + Math.random() * 0.3, col, life: 0, max: 0.6 + Math.random() * 0.35 });
    }
    for (let i = 0; i < 4; i++) shards.push({ x, y, vx: (Math.random() - 0.5) * 10, vy: -4 - Math.random() * 6, rot: 0, vr: 0, size: 0.12, col: "#ffffff", life: 0, max: 0.5, spark: true });
    rings.push({ x, y, t: 0, col });
  }

  function landShot() {
    const { res, before } = anim;
    anim = null;
    const rowY = (r) => before.topY + 1 + r * RH;
    for (const p of res.popped) burst(cellX(p.r, p.c), rowY(p.r), p.colour, p.heart);
    for (const p of res.dropped) falling.push({ x: cellX(p.r, p.c), y: rowY(p.r), vy: -3 - Math.random() * 2, vx: (Math.random() - 0.5) * 3, colour: p.colour, heart: p.heart });
    const n = res.popped.length + res.dropped.length;
    if (res.popped.length) {
      sfx.shatter(n, res.streak);
      haptic(n >= 6 ? "heavy" : "medium");
      shake = Math.min(1, 0.25 + n * 0.06);
      const end = res.path.at(-1);
      if (!res.heartsFound) texts.push({ x: end.x, y: end.y - 1, t: 0, txt: `+${res.gained}`, size: 0.85 }); // hearts get their own label
      if (res.multiplier > 1) texts.push({ x: WIDTH / 2, y: HEIGHT * 0.62, t: 0, txt: `Combo ×${res.multiplier}`, size: 1.15, col: "#9fe3ff" });
    } else {
      sfx.stick();
    }
    if (res.heartsFound) { sfx.heart(); haptic("success"); shake = Math.max(shake, 0.6); }
    if (res.ceilingDropped) { sfx.ceiling(); haptic("warning"); shake = Math.max(shake, 0.4); texts.push({ x: WIDTH / 2, y: game.topY + 3, t: 0, txt: "The ceiling drops", size: 0.75, col: "#bfe6ff" }); }
    if (res.cleared) texts.push({ x: WIDTH / 2, y: HEIGHT / 2, t: 0, txt: "Board cleared", size: 1.4, col: "#e9c98e" });
    onShot(res);
  }

  function currentPreview() {
    const key = `${aim.toFixed(3)}:${game.shots}:${game.swaps}:${game.topY}`;
    if (previewCache.key !== key) previewCache = { key, data: preview(game, aim) };
    return previewCache.data;
  }

  // ── Loop ──
  function frame(t) {
    if (destroyed) return;
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    onFrame(dt);
    if (anim) { anim.d += 40 * dt; if (anim.d >= anim.total) landShot(); }
    swapAnim = Math.max(0, swapAnim - dt * 7);
    shake = Math.max(0, shake - dt * 2.8);
    for (const s of shards) { s.life += dt; s.vy += 22 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.rot += s.vr * dt; }
    shards = shards.filter((s) => s.life < s.max);
    for (const f of falling) { f.vy += 40 * dt; f.y += f.vy * dt; f.x += f.vx * dt; }
    falling = falling.filter((f) => f.y < HEIGHT + 1.5);
    texts.forEach((x) => (x.t += dt)); texts = texts.filter((x) => x.t < 1.3);
    rings.forEach((r) => (r.t += dt)); rings = rings.filter((r) => r.t < 0.45);
    draw(t);
    raf = requestAnimationFrame(frame);
  }

  function draw(t) {
    const view = anim ? anim.before : { grid: game.grid, topY: game.topY };
    ctx.save();
    ctx.clearRect(0, 0, cssW, cssH);
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * S * 0.5, (Math.random() - 0.5) * shake * S * 0.5);

    // The ceiling: a smoky tint that grows down from the top as it drops.
    const frostH = (view.topY + 0.4) * S;
    const fg = ctx.createLinearGradient(0, 0, 0, frostH + S);
    fg.addColorStop(0, "rgba(214,238,255,.38)"); fg.addColorStop(1, "rgba(214,238,255,0)");
    ctx.fillStyle = fg; ctx.fillRect(0, 0, cssW, frostH + S);
    if (view.topY > 0) { ctx.fillStyle = "rgba(220,242,255,.65)"; ctx.fillRect(0, view.topY * S - 1, cssW, 2); }

    // The line the orbs mustn't cross: a row of faint dots.
    ctx.fillStyle = "rgba(190,225,255,.28)";
    for (let x = 0.6; x < WIDTH; x += 1.1) { ctx.beginPath(); ctx.arc(x * S, DEATH_Y * S, S * 0.07, 0, Math.PI * 2); ctx.fill(); }

    const pulse = 0.5 + 0.5 * Math.sin((t - t0) / 320);
    for (let r = 0; r < ROWS + 2; r++) for (let c = 0; c < COLS; c++) {
      const b = view.grid[r][c];
      if (!b) continue;
      const x = cellX(r, c), y = view.topY + 1 + r * RH;
      if (b.heart) { // a soft glow so hearts read as the goal
        ctx.fillStyle = `rgba(242,102,139,${0.12 + pulse * 0.16})`;
        ctx.beginPath(); ctx.arc(x * S, y * S, S * 1.25, 0, Math.PI * 2); ctx.fill();
      }
      stamp(x, y, b.colour, b.heart);
    }
    for (const f of falling) stamp(f.x, f.y, f.colour, f.heart, 0.85);

    // Aiming: dotted path along the real trajectory, and a ghost orb where it will land.
    if (canPlay() && !anim && !game.over) {
      const pv = currentPreview();
      if (pv) {
        const pts = pv.path; let acc = 0, dash = 0;
        ctx.fillStyle = cancelZone ? "rgba(255,255,255,.12)" : "rgba(235,246,255,.75)";
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y);
          for (let d = (0.9 - (acc % 0.9)); d < len; d += 0.9) {
            const k = d / len, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
            if (Math.hypot(x - LAUNCH.x, y - LAUNCH.y) < 1.2) continue;
            dash++;
            ctx.globalAlpha = Math.max(0.15, 1 - dash / 34);
            ctx.beginPath(); ctx.arc(x * S, y * S, S * 0.09, 0, Math.PI * 2); ctx.fill();
          }
          acc += len;
        }
        ctx.globalAlpha = 1;
        if (pv.cell && !cancelZone) {
          const [r, c] = pv.cell, x = cellX(r, c), y = game.topY + 1 + r * RH;
          stamp(x, y, game.cur, false, 0.32);
          ctx.strokeStyle = pv.wouldPop ? `rgba(233,201,142,${0.6 + pulse * 0.4})` : "rgba(235,246,255,.45)";
          ctx.lineWidth = pv.wouldPop ? 2.2 : 1.2;
          ctx.beginPath(); ctx.arc(x * S, y * S, S * 0.98, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }

    // Launcher and next orb (they slide past each other when you swap).
    ctx.strokeStyle = "rgba(220,240,255,.16)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(LAUNCH.x * S, LAUNCH.y * S, S * 1.45, 0, Math.PI * 2); ctx.stroke();
    const k = swapAnim;
    const lerp = (a, b) => a + (b - a) * k;
    if (!anim) stamp(lerp(LAUNCH.x, NEXT_POS.x), lerp(LAUNCH.y, NEXT_POS.y), game.cur, false, 1, lerp(1, 0.8));
    stamp(lerp(NEXT_POS.x, LAUNCH.x), lerp(NEXT_POS.y, LAUNCH.y), anim ? game.cur : game.nxt, false, 0.6, lerp(0.8, 1));
    ctx.fillStyle = "rgba(200,190,215,.85)"; ctx.font = `600 ${Math.max(11, S * 0.5)}px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("Tap to swap", (NEXT_POS.x + 1.25) * S, NEXT_POS.y * S);
    ctx.textBaseline = "alphabetic";
    if (game.streak > 1 && !anim) {
      ctx.fillStyle = "#9fe3ff"; ctx.font = `800 ${Math.max(12, S * 0.62)}px ${FONT}`; ctx.textAlign = "left";
      ctx.fillText(`×${Math.min(3, 1 + (game.streak - 1) * 0.5)} streak`, 0.8 * S, (LAUNCH.y - 0.9) * S);
    }

    if (anim) {
      let i = 1; while (i < anim.lens.length - 1 && anim.lens[i] < anim.d) i++;
      const a = anim.pts[i - 1], b = anim.pts[i];
      const seg = anim.lens[i] - anim.lens[i - 1] || 1, kk = Math.min(1, (anim.d - anim.lens[i - 1]) / seg);
      stamp(a.x + (b.x - a.x) * kk, a.y + (b.y - a.y) * kk, anim.colour, false);
    }

    for (const r of rings) {
      const kk = r.t / 0.45; ctx.strokeStyle = r.col; ctx.globalAlpha = 1 - kk; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(r.x * S, r.y * S, S * (1 + kk * 1.1), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (const s of shards) {
      ctx.globalAlpha = 1 - s.life / s.max; ctx.fillStyle = s.col;
      ctx.save(); ctx.translate(s.x * S, s.y * S); ctx.rotate(s.rot);
      const z = s.size * S;
      if (s.spark) { ctx.fillRect(-z / 2, -z * 1.5, z, z * 3); ctx.fillRect(-z * 1.5, -z / 2, z * 3, z); }
      else { ctx.beginPath(); ctx.moveTo(0, -z); ctx.lineTo(z * 0.7, z * 0.6); ctx.lineTo(-z * 0.6, z * 0.4); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    for (const x of texts) {
      const kk = x.t / 1.3; ctx.globalAlpha = 1 - kk * kk;
      ctx.fillStyle = x.col || "#f6eee4"; ctx.font = `800 ${S * x.size}px ${FONT}`; ctx.textAlign = "center";
      ctx.fillText(x.txt, x.x * S, (x.y - kk * 1.6) * S);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  raf = requestAnimationFrame(frame);

  return {
    get busy() { return !!anim; },
    shoot, swap: doSwap,
    // Banner messages stack downwards while earlier ones are still showing, so they never overlap.
    text(txt, opts2 = {}) {
      const live = texts.filter((x) => x.banner && x.t < 1.0).length;
      texts.push({ x: WIDTH / 2, y: HEIGHT * 0.42 + live * 1.9, t: 0, txt, size: opts2.size || 1.2, col: opts2.col || "#e9c98e", banner: true });
    },
    shake(n = 0.6) { shake = Math.max(shake, n); },
    destroy() { destroyed = true; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); },
  };
}
