// A duel round. Both players get the same board from the duel's seed. Each plays their own 90 seconds,
// whenever suits them; if both are on at once, scores show live. The server re-plays every shot to check scores.
import { sb, me, rpc, callFn } from "../supa.js";
import { $, esc, toast, errorText, haptic } from "../ui.js";
import { photoFor } from "../photos.js";
import { roundMs } from "../config.js";
import { createGame, applyInput } from "../../shared/engine.js";
import { createBoard } from "../board.js";
import { sfx, unlockAudio, isMuted, setMuted } from "../sound.js";

const COUNTDOWN_MS = 3000;
const PROMPTS = [
  { at: 0.2, q: "Beach or mountains?", a: ["Mountains", "Beach"] },
  { at: 0.53, q: "Worst first-date idea?", a: ["Mini golf", "Escape room"] },
  { at: 0.8, q: "Early bird or night owl?", a: ["Early bird", "Night owl"] },
];

export async function duelScreen(app, { duel_id, match_id }, nav) {
  const ROUND = roundMs();
  let start;
  try { [start] = await rpc("start_duel", { d: duel_id }); } catch (e) { toast(errorText(e)); nav.go("match", { match_id }); return; }
  if (!start || start.submitted) { toast("You've already played this duel."); nav.go("match", { match_id }); return; }
  const [o] = await rpc("match_profile", { m: match_id }).catch(() => []);
  if (!o) { nav.go("matches"); return; }
  const name = esc(o.display_name);

  // Resume after an app restart: replay saved shots, keep the original start time.
  const key = `duel:${duel_id}`;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* none */ }
  const game = createGame(start.seed);
  const inputs = []; // shot angles and swaps, in order: the server replays exactly these
  for (const a of saved?.inputs || saved?.angles || []) { inputs.push(a); applyInput(game, a); }
  const serverStart = new Date(start.started_at).getTime();
  const fresh = !saved && Date.now() - serverStart < 8000;
  let startAt = saved?.startAt ?? (fresh ? Date.now() + COUNTDOWN_MS : serverStart);
  const save = () => { try { localStorage.setItem(key, JSON.stringify({ startAt, inputs })); } catch { /* full */ } };
  save();

  // Their score so far, if they've already played this duel.
  const { data: theirRow } = await sb.from("duel_results").select("score,submitted_at").eq("duel_id", duel_id).eq("user_id", o.id).maybeSingle();
  let oppScore = theirRow?.submitted_at ? theirRow.score : 0, oppLive = false, oppDone = !!theirRow?.submitted_at;

  let phase = Date.now() < startAt ? "countdown" : "playing";
  let promptIdx = 0, ended = false, board = null;
  const reveals = [];
  let level = o.photo_level;
  while (promptIdx < PROMPTS.length && (Date.now() - startAt) / ROUND > PROMPTS[promptIdx].at) promptIdx++;

  app.innerHTML = `
    <div class="scoreboard">
      <div class="side you"><span class="who">You</span><span class="pts" id="you">0</span><span class="tiny muted">Your round</span></div>
      <div class="clock" id="clock" aria-live="off">1:30</div>
      <div class="side them"><span class="who">${name}</span><span class="pts" id="opp">${oppDone ? oppScore : "–"}</span><span class="tiny muted" id="oppState">${oppDone ? "Score to beat" : "Plays later"}</span></div>
    </div>
    <div class="tug" aria-hidden="true"><i id="tug"></i></div>
    <div class="board" id="board">
      <canvas id="cv" aria-label="Glass orbs. Drag to aim, let go to shoot, tap your orb to swap."></canvas>
      <div class="overlay" id="ov" ${phase === "countdown" ? "" : "hidden"}><div class="count" id="count">3</div><p class="muted">Free the hearts to clear ${name}'s photo</p></div>
      <button class="sound-btn" id="snd" aria-label="Sound">${isMuted() ? "Sound off" : "Sound on"}</button>
    </div>
    <div id="prompt"></div>
    <div class="surface stack">
      <div class="row" style="flex-wrap:nowrap;gap:14px">
        <div class="frost sm" id="thumb"><span class="crack" aria-hidden="true"></span></div>
        <div class="stack" style="gap:2px;min-width:0"><span class="display" style="font-size:22px">${name}</span><span class="small muted" id="revc">Every heart reveals something</span></div>
      </div>
      <ul class="reveals" id="reveals"></ul>
    </div>`;

  async function paintThumb(thaw = false) {
    const src = await photoFor(o.photo_dirs?.[0], level);
    const t = $("#thumb", app);
    if (!t || !src) return;
    const img = document.createElement("img");
    const had = t.querySelectorAll("img").length;
    img.src = src; img.alt = ""; img.className = had ? "next" : "";
    t.insertBefore(img, t.querySelector(".crack"));
    await img.decode().catch(() => {});
    requestAnimationFrame(() => img.classList.remove("next"));
    const imgs = t.querySelectorAll("img"); if (imgs.length > 2) imgs[0].remove();
    if (thaw) { t.classList.remove("thaw"); void t.offsetWidth; t.classList.add("thaw"); }
  }
  paintThumb();

  // ── Live link (only matters if they're playing at the same moment) ──
  const ch = sb.channel(`duel-${duel_id}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
  ch.on("presence", { event: "sync" }, () => {
    const here = Object.keys(ch.presenceState()).includes(o.id);
    if (here && !oppLive && !oppDone) toast(`${o.display_name} is playing right now`);
    oppLive = here && !oppDone;
    hud();
  });
  ch.on("broadcast", { event: "score" }, ({ payload }) => { oppScore = Math.max(oppScore, payload.score | 0); if (payload.final) { oppDone = true; oppLive = false; } hud(); });
  ch.on("broadcast", { event: "heart" }, ({ payload }) => toast(`${o.display_name} just unlocked your “${payload.label}”`));
  ch.subscribe(async (s) => { if (s === "SUBSCRIBED") await ch.track({ at: Date.now() }); });

  // ── Reveals ──
  function renderReveals(freshIdx = -1) {
    $("#reveals", app).innerHTML = reveals.map((f) => `<li class="${f.idx === freshIdx ? "fresh" : ""}"><span class="k">${esc(f.label)}</span>${esc(f.body)}</li>`).join("");
    $("#revc", app).textContent = reveals.length ? `${reveals.length} unlocked this round` : "Every heart reveals something";
  }
  async function unlock() {
    try {
      const [f] = await rpc("reveal_fact", { d: duel_id });
      if (!f) return;
      reveals.push(f);
      renderReveals(f.idx);
      haptic("success");
      if (!unlock.quiet) board?.text(`Heart freed · ${f.label}`, { size: 1.05, col: "#ffc2d3" });
      ch.send({ type: "broadcast", event: "heart", payload: { label: f.label } });
      if (f.photo_level > level) { level = f.photo_level; paintThumb(true); board?.text("Their photo is clearing", { size: 0.8, col: "#bfe6ff" }); }
    } catch { /* round may have just ended */ }
  }

  // ── Quick questions: answers go into your conversation ──
  function showPrompt(p) {
    const box = $("#prompt", app);
    box.innerHTML = `<div class="prompt-card"><span class="small muted">Quick one for ${name}</span><span class="display" style="font-size:22px">${esc(p.q)}</span>
      <div class="replies">${p.a.map((a) => `<button class="btn quiet small">${esc(a)}</button>`).join("")}</div></div>`;
    box.querySelectorAll("button").forEach((b) => (b.onclick = async () => {
      haptic();
      box.innerHTML = `<div class="prompt-card"><span class="small muted">Sent to ${name}</span><span>${esc(p.q)} ${esc(b.textContent)}</span></div>`;
      await sb.from("messages").insert({ match_id, sender: me.id, kind: "prompt", body: `${p.q} ${b.textContent}` });
      setTimeout(() => { if (box.textContent.includes("Sent to")) box.innerHTML = ""; }, 3500);
    }));
  }

  // ── The board ──
  board = createBoard($("#cv", app), game, {
    canPlay: () => phase === "playing" && !ended,
    onInput: (x) => { inputs.push(x); save(); },
    onShot: (res) => {
      if (res.heartsFound > 1) board.text(`${res.heartsFound} hearts freed`, { size: 1.1, col: "#ffc2d3" });
      unlock.quiet = res.heartsFound > 1;
      for (let i = 0; i < res.heartsFound; i++) unlock();
      ch.send({ type: "broadcast", event: "score", payload: { score: game.score } });
      hud();
      if (game.over) end();
    },
    onFrame: () => {
      const now = Date.now();
      if (phase === "countdown") {
        const left = Math.ceil((startAt - now) / 1000);
        const c = $("#count", app);
        if (c && c.textContent !== String(left) && left > 0) { c.textContent = left; sfx.tick(); haptic(); }
        if (now >= startAt) { phase = "playing"; $("#ov", app).hidden = true; sfx.go(); haptic("medium"); }
      }
      if (phase === "playing") {
        const frac = (now - startAt) / ROUND;
        if (promptIdx < PROMPTS.length && frac >= PROMPTS[promptIdx].at) showPrompt(PROMPTS[promptIdx++]);
        if (now - startAt >= ROUND && !board.busy) end();
      }
      hud();
    },
  });
  $("#snd", app).onclick = (e) => { unlockAudio(); setMuted(!isMuted()); e.target.textContent = isMuted() ? "Sound off" : "Sound on"; };
  app.addEventListener("pointerdown", unlockAudio, { once: true });

  // Rivalry: call out lead changes, show exactly what it takes to win, and mark the final ten seconds.
  let leading = null, finalCalled = false;
  function rivalry(s) {
    const showOpp = oppLive || oppDone;
    if (phase !== "playing" || !showOpp || (!oppScore && !game.score)) return;
    const now = game.score > oppScore ? true : game.score < oppScore ? false : leading;
    if (leading !== null && now !== leading) {
      if (now) { board?.text("You're ahead", { size: 1.2, col: "#ffd27a" }); sfx.heart(); haptic("success"); }
      else if (oppLive) { board?.text(`${name} took the lead`, { size: 1, col: "#ff9db8" }); haptic("warning"); }
    }
    leading = now;
    if (!finalCalled && s <= 10) { finalCalled = true; board?.text(game.score > oppScore ? "Hold on. 10 seconds" : `10 seconds. ${oppScore - game.score + 1} to win`, { size: 0.9, col: "#ffd27a" }); }
  }

  function hud() {
    const clock = $("#clock", app);
    if (!clock) return;
    const left = phase === "countdown" ? ROUND : Math.max(0, ROUND - (Date.now() - startAt));
    const s = Math.ceil(left / 1000);
    const txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (clock.textContent !== txt) clock.textContent = txt;
    clock.classList.toggle("low", phase === "playing" && s <= 10);
    $("#you", app).textContent = game.score;
    const showOpp = oppLive || oppDone;
    $("#opp", app).textContent = showOpp ? oppScore : "–";
    const gap = oppScore - game.score;
    const st = oppLive ? '<span class="live">Playing now</span>'
      : oppDone ? (phase === "countdown" || !game.score ? "Score to beat" : gap >= 0 ? `<b class="need">${gap + 1} to win</b>` : `<b class="ahead">Ahead by ${-gap}</b>`)
      : "Plays later";
    if ($("#oppState", app).innerHTML !== st) $("#oppState", app).innerHTML = st;
    const total = game.score + (showOpp ? oppScore : 0);
    $("#tug", app).style.width = (showOpp && total ? (game.score / total) * 100 : 50) + "%";
    rivalry(s);
  }

  // ── End ──
  async function end() {
    if (ended) return;
    ended = true;
    phase = "done";
    const ov = $("#ov", app);
    ov.hidden = false;
    ov.innerHTML = `<h2>${game.over ? "The ceiling caught you" : "Time"}</h2><p class="muted">Checking your score</p>`;
    haptic("heavy"); sfx.end();
    let r;
    try { r = await callFn("finish-duel", { duel_id, angles: inputs }); }
    catch (e) { ov.innerHTML = `<h2>Couldn't send your score</h2><p class="muted">${esc(errorText(e))}</p><button class="btn" id="retry">Try again</button>`; $("#retry", ov).onclick = () => { ended = false; end(); }; return; }
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    ch.send({ type: "broadcast", event: "score", payload: { score: r.score, final: true } });
    let best = 0; try { best = +localStorage.getItem("tinted:best") || 0; if (r.score > best) localStorage.setItem("tinted:best", r.score); } catch { /* ignore */ }
    const pb = r.score > best && best > 0 ? `<p class="pb">New personal best</p>` : "";
    if (r.both_played) {
      const { data: theirs } = await sb.from("duel_results").select("score").eq("duel_id", duel_id).eq("user_id", o.id).maybeSingle();
      if (theirs?.score != null) oppScore = theirs.score;
      const m = Math.abs(r.score - oppScore);
      ov.innerHTML = `<h2>${r.score > oppScore ? "You won" : r.score < oppScore ? `${name} won` : "Dead heat"}</h2>
        <p class="display num" style="font-size:44px;line-height:1">${r.score} <span class="muted">–</span> ${oppScore}</p>
        <p class="margin">${r.score > oppScore ? (m < 200 ? `By ${m}. That was close.` : `By ${m}.`) : r.score < oppScore ? (m < 200 ? `Just ${m} in it. So close.` : `By ${m}. They'll be smug about that.`) : "Neither of you gave an inch."}</p>${pb}
        <p class="muted">${reveals.length ? `You freed ${reveals.length} heart${reveals.length > 1 ? "s" : ""} and learned ${reveals.length} thing${reveals.length > 1 ? "s" : ""} about ${name}.` : `No hearts freed this time.`}${game.bestStreak > 2 ? ` Best streak: ${game.bestStreak}.` : ""}</p>
        <button class="btn" id="next">Keep going or pass</button>`;
    } else {
      ov.innerHTML = `<h2>${r.score} points</h2>${pb}
        <p class="muted">That's the score ${name} has to beat. When ${name} plays, you'll both see who won and choose whether to keep going.</p>
        <button class="btn" id="next">Back to ${name}</button>`;
    }
    $("#next", ov).onclick = () => nav.go("match", { match_id });
  }

  renderReveals();
  if (Date.now() - startAt >= ROUND) end();

  return () => {
    board.destroy();
    sb.removeChannel(ch);
  };
}
