// Launch intro, AAA-style: from black, a light bloom swells behind the animated logo, rays turn,
// bokeh orbs drift past at different depths, the camera pushes in, the tagline tracks into place,
// then a flash and the camera flies through the logo into the app. The logo video keeps its sound
// (unless the player has muted the game). Android's launch screen shows the still first frame on
// the same background a moment earlier, so the hand-over is seamless. Tap anywhere skips.
import { NAME, TAGLINE } from "./brand.js";
import { isMuted } from "./sound.js";

const VIDEO = new URL("./brand/splash.mp4", import.meta.url).href;
const POSTER = new URL("./brand/splash-poster.webp", import.meta.url).href;
const MAX_MS = 4400; // safety net if the video stalls
const ORB_COLOURS = ["255,79,163", "168,85,247", "79,147,255", "255,200,87", "255,140,200"];

// Bokeh: soft glowing orbs drifting upwards. Big and blurry = near, small and sharp = far.
function bokeh(canvas) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  let w = 0, h = 0, raf = 0;
  const size = () => { w = canvas.clientWidth; h = canvas.clientHeight; canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  size();
  const orbs = Array.from({ length: 34 }, () => {
    const z = Math.random(); // 0 far … 1 near
    return { x: Math.random() * w, y: h * (0.2 + Math.random()), r: 2 + z * z * 26, z, c: ORB_COLOURS[(Math.random() * ORB_COLOURS.length) | 0],
      vy: 8 + z * 34, vx: (Math.random() - 0.5) * 8, a: 0.15 + (1 - z) * 0.35, ph: Math.random() * 6.28 };
  });
  const t0 = performance.now();
  const frame = (now) => {
    const t = (now - t0) / 1000, dt = 1 / 60;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    const fade = Math.min(1, t / 0.9);
    for (const o of orbs) {
      o.y -= o.vy * dt; o.x += o.vx * dt + Math.sin(t * 0.8 + o.ph) * 0.15;
      if (o.y < -40) { o.y = h + 40; o.x = Math.random() * w; }
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
      const al = o.a * fade * (0.75 + 0.25 * Math.sin(t * 2 + o.ph));
      g.addColorStop(0, `rgba(${o.c},${al})`); g.addColorStop(o.z > 0.6 ? 0.55 : 0.3, `rgba(${o.c},${al * 0.45})`); g.addColorStop(1, `rgba(${o.c},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 6.283); ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

export function splash() {
  // Once per app launch. The demo sets __ALWAYS_SPLASH so it plays every time the page opens.
  if (!globalThis.__ALWAYS_SPLASH) {
    try { if (sessionStorage.getItem("tinted:splashed")) return Promise.resolve(); sessionStorage.setItem("tinted:splashed", "1"); } catch { /* play it anyway */ }
  }
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = document.createElement("div");
  el.className = "splash"; el.setAttribute("role", "img"); el.setAttribute("aria-label", NAME);
  el.innerHTML = `
    <canvas class="splash-bokeh" aria-hidden="true"></canvas>
    <div class="splash-rays" aria-hidden="true"></div>
    <div class="splash-bloom" aria-hidden="true"></div>
    <div class="splash-stage">
      <div class="splash-logo"><video src="${VIDEO}" poster="${POSTER}" playsinline preload="auto"></video></div>
      <p class="splash-tag">${TAGLINE}</p>
    </div>
    <div class="splash-vignette" aria-hidden="true"></div>
    <div class="splash-flash" aria-hidden="true"></div>`;
  document.body.appendChild(el);
  const v = el.querySelector("video");
  const stopBokeh = reduce ? () => {} : bokeh(el.querySelector(".splash-bokeh"));

  return new Promise((done) => {
    let gone = false;
    const leave = () => {
      if (gone) return; gone = true;
      el.classList.add("out");
      setTimeout(() => { v.pause(); stopBokeh(); el.remove(); done(); }, reduce ? 0 : 700);
    };
    el.addEventListener("click", leave);
    v.addEventListener("ended", leave);
    v.addEventListener("error", leave);
    setTimeout(leave, reduce ? 900 : MAX_MS);
    if (reduce) return;
    requestAnimationFrame(() => el.classList.add("go"));
    // Try with sound; browsers that block sound before a tap get it silent instead.
    v.muted = isMuted();
    v.play().catch(() => { v.muted = true; v.play().catch(leave); });
  });
}
