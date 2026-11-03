// Small DOM helpers shared by every screen: query, escaping, toast, bottom sheets, haptics, icons.
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer;
export function toast(text, ms = 2800) {
  const el = $("#toast");
  el.hidden = true;
  void el.offsetWidth; // restart the entrance animation
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function errorText(e) {
  if (!e) return "That didn't work. Try again.";
  if (typeof e === "string") return e;
  if (/Failed to fetch|NetworkError/.test(e.message || "")) return "You're offline. Check your connection and try again.";
  return e.message || "That didn't work. Try again.";
}

// Taps you can feel. Light for UI, medium for pops, success for unlocks.
export async function haptic(kind = "light") {
  try {
    if (kind === "success") return await Haptics.notification({ type: NotificationType.Success });
    if (kind === "warning") return await Haptics.notification({ type: NotificationType.Warning });
    await Haptics.impact({ style: kind === "heavy" ? ImpactStyle.Heavy : kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light });
  } catch {
    try { navigator.vibrate?.(kind === "success" ? [12, 40, 18] : kind === "medium" ? 14 : 8); } catch { /* no vibration */ }
  }
}

// Bottom sheet. `build(panel, close)` fills it; resolves with whatever close() is given.
export function sheet(build) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "sheet";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    const panel = document.createElement("div");
    panel.className = "panel";
    wrap.appendChild(panel);
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    const close = (v) => { document.removeEventListener("keydown", onKey); wrap.remove(); resolve(v); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(null); });
    document.addEventListener("keydown", onKey);
    build(panel, close);
    document.body.appendChild(wrap);
    panel.querySelector("button, input, textarea")?.focus({ preventScroll: true });
  });
}

export function confirmSheet({ title, text, ok = "Confirm", cancel = "Cancel" }) {
  return sheet((p, close) => {
    p.innerHTML = `<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>
      <div class="stack"><button class="btn wide" data-ok>${esc(ok)}</button><button class="btn quiet wide" data-no>${esc(cancel)}</button></div>`;
    $("[data-ok]", p).onclick = () => close(true);
    $("[data-no]", p).onclick = () => close(false);
  });
}

export function ageFrom(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// Inline icons (stroke = currentColor).
const P = {
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  matches: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  send: '<path d="M4 12l16-8-6 16-2-7z"/>',
};
export const icon = (name, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
