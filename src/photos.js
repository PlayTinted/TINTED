// Photo versions. Your phone makes four copies of each photo: three blurred (g1 heaviest → g3 lightest)
// and the full one. The server only lets a match load the copy they've earned, so a blurred photo
// can't be "un-blurred" by anyone poking at the app.
import { photoUrl } from "./supa.js";

const LEVELS = [
  { name: "g1", width: 320, blur: 16 },
  { name: "g2", width: 320, blur: 9 },
  { name: "g3", width: 480, blur: 4 },
  { name: "full", width: 1080, blur: 0 },
];

async function render(img, width, blur) {
  const scale = Math.min(1, width / img.width);
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  if (blur) {
    // Draw slightly oversized so the blur doesn't leave soft see-through edges.
    ctx.filter = `blur(${blur}px)`;
    const pad = blur * 2;
    ctx.drawImage(img, -pad, -pad, w + pad * 2, h + pad * 2);
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }
  return new Promise((res) => c.toBlob(res, "image/jpeg", blur ? 0.7 : 0.85));
}

export async function makeVersions(file) {
  const img = await createImageBitmap(file);
  const out = {};
  for (const l of LEVELS) out[l.name] = await render(img, l.width, l.blur);
  return out;
}

// level: 0 nothing · 1–3 blurred · 4 full
export function fileFor(dir, level) {
  if (!dir || !level) return null;
  return `${dir}/${level >= 4 ? "full" : "g" + level}.jpg`;
}

export async function photoFor(dir, level) {
  const path = fileFor(dir, level);
  return path ? photoUrl(path) : "";
}

export const STAGES = ["Glimpse", "Chatting", "Revealed"];
