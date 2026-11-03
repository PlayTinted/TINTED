// Everyone you're playing with, and what each one is waiting for.
import { rpc } from "../supa.js";
import { $, esc, toast, errorText } from "../ui.js";
import { photoFor, STAGES } from "../photos.js";

export function statusOf(m) {
  if (m.ended_reason) return { pill: "ended", text: "Ended", line: m.ended_reason === "pass" ? "Not taking this further" : "This match has ended" };
  if (m.duel_status === "open" && !m.i_played) return { pill: "turn", text: "Your turn", line: m.they_played ? `${m.display_name} has played. Beat their score.` : `Duel ${m.duel_round} is ready` };
  if (m.duel_status === "open") return { pill: "wait", text: "Waiting", line: `Waiting for ${m.display_name} to play` };
  if (m.duel_status === "done" && m.stage === m.duel_round && m.stage < 3 && m.my_keep == null) return { pill: "decide", text: "Decide", line: "Results are in. Keep going?" };
  if (m.duel_status === "done" && m.stage === m.duel_round && m.stage < 3) return { pill: "wait", text: "Waiting", line: `Waiting for ${m.display_name} to decide` };
  return { pill: "wait", text: STAGES[m.stage - 1], line: m.last_message || "Say something" };
}

export async function matchesScreen(app, _params, nav) {
  app.innerHTML = `<h1>Matches</h1>`;
  let list = [];
  try { list = await rpc("my_matches"); } catch (e) { toast(errorText(e)); }
  if (!list.length) {
    app.innerHTML = `<h1>Matches</h1><div class="empty"><p class="lede">No one yet. When you're paired, they'll appear here, tinted, until you play.</p>
      <button class="btn" id="go">Find my match</button></div>`;
    $("#go", app).onclick = () => nav.go("play");
    return;
  }
  app.innerHTML = `<h1>Matches</h1><div class="list" id="l">${list.map((m) => {
    const s = statusOf(m);
    return `<button data-m="${m.match_id}" ${m.ended_reason ? 'style="opacity:.55"' : ""}>
      <div class="frost sm" data-dir="${esc(m.photo_dir || "")}" data-level="${m.photo_level}"></div>
      <span class="meta"><b>${esc(m.display_name)}, ${m.age}</b><span>${esc(s.line)}</span></span>
      <span class="pill ${s.pill}">${esc(s.text)}</span></button>`;
  }).join("")}</div>`;
  app.querySelectorAll(".frost.sm[data-dir]").forEach(async (el) => {
    const src = await photoFor(el.dataset.dir, +el.dataset.level);
    if (src) el.innerHTML = `<img src="${esc(src)}" alt="">`;
  });
  $("#l", app).onclick = (e) => {
    const b = e.target.closest("[data-m]");
    if (!b) return;
    const m = list.find((x) => x.match_id === b.dataset.m);
    if (m?.ended_reason) return toast(m.ended_reason === "pass" ? `${m.display_name} isn't taking this further. On to the next one.` : "This match has ended.");
    nav.go("match", { match_id: b.dataset.m });
  };
}
