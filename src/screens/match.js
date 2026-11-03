// One match: the frosted portrait, where you are in the three stages, what to do next, reveals and chat.
import { sb, me, rpc } from "../supa.js";
import { $, esc, toast, errorText, sheet, haptic, icon, confirmSheet } from "../ui.js";
import { photoFor, STAGES } from "../photos.js";
import { statusOf } from "./matches.js";
import { reportSheet, blockFlow, unmatchFlow } from "./safety.js";

const CLARITY = ["", "Tinted", "Clearing", "Almost clear", "Clear"];

export async function matchScreen(app, { match_id, autoplay }, nav) {
  let m, o, facts = [], lastResult = null, shownLevel = 0;
  const seenMsgs = new Set();

  async function load() {
    const [list, prof] = await Promise.all([rpc("my_matches").catch(() => []), rpc("match_profile", { m: match_id }).catch(() => [])]);
    m = list.find((x) => x.match_id === match_id);
    o = prof[0];
    if (!m || !o || m.ended_reason) {
      toast(m?.ended_reason === "pass" ? `${m.display_name} isn't taking this further.` : "This match has ended.");
      nav.go("matches");
      return false;
    }
    const { data } = await sb.from("profile_facts").select("idx,label,body").eq("user_id", o.id).order("idx");
    facts = data || [];
    if (m.duel_status === "done") {
      const { data: rs } = await sb.from("duel_results").select("user_id,score").eq("duel_id", m.duel_id);
      lastResult = { mine: rs?.find((r) => r.user_id === me.id)?.score ?? 0, theirs: rs?.find((r) => r.user_id === o.id)?.score ?? 0 };
    } else lastResult = null;
    return true;
  }

  function actionHtml() {
    const s = statusOf(m);
    const name = esc(o.display_name);
    if (s.pill === "turn") {
      return `<div class="stack">
        <button class="btn wide" id="play">Play duel ${m.duel_round}</button>
        <p class="small muted">${m.they_played ? `${name} has already played. Your score is compared when you finish.` : `90 seconds on the same board as ${name}. If you're both playing at once, you'll see their score live.`}</p></div>`;
    }
    if (s.pill === "decide") {
      const won = lastResult.mine > lastResult.theirs, tie = lastResult.mine === lastResult.theirs;
      return `<div class="surface stack">
        <div class="spread"><span class="display" style="font-size:28px">${tie ? "Dead heat" : won ? "You won" : `${name} won`}</span>
          <span class="num muted">${lastResult.mine} – ${lastResult.theirs}</span></div>
        <p class="muted">${m.stage === 1 ? `Keep going to open chat with ${name} and play a second duel.` : `Keep going and you'll both be fully revealed.`} If either of you passes, the match ends quietly.</p>
        <div class="row" style="flex-wrap:nowrap"><button class="btn quiet" id="pass" style="flex:1">Pass</button><button class="btn" id="keep" style="flex:2">Keep going</button></div></div>`;
    }
    if (s.pill === "wait") {
      if (m.stage === 3 && m.duel_status !== "open") return `<button class="btn line wide" id="rematch">Challenge ${name} to a rematch</button>`;
      return `<div class="locked-note">${icon("lock")}<span>${esc(s.line)}. We'll let you know.</span></div>`;
    }
    return "";
  }

  function revealsHtml() {
    const left = 6 - facts.length;
    return `<ul class="reveals" id="reveals">${facts.map((f) => `<li><span class="k">${esc(f.label)}</span>${esc(f.body)}</li>`).join("")}
      ${left ? `<li class="locked" style="grid-column:1/-1;flex-direction:row;align-items:center;gap:12px">${icon("lock")}<span>${left} more to discover. Each heart you pop in a duel reveals one.</span></li>` : ""}</ul>`;
  }

  async function render() {
    const name = esc(o.display_name);
    const src = await photoFor(o.photo_dirs?.[0], o.photo_level);
    shownLevel = o.photo_level;
    app.innerHTML = `
      <div class="spread">
        <button class="text-btn" id="back" aria-label="Back to matches" style="display:flex;align-items:center;gap:4px">${icon("back", 20)} Matches</button>
        <button class="text-btn" id="more" aria-label="Safety options for ${name}">${icon("more")}</button>
      </div>
      <div class="frost" id="frost">
        ${src ? `<img src="${esc(src)}" alt="${o.photo_level < 4 ? "A tinted photo of " : "Photo of "}${name}">` : ""}
        <div class="clarity"><i><b style="width:${(o.photo_level / 4) * 100}%"></b></i>${CLARITY[o.photo_level]}</div>
        <div class="caption"><h2>${name}, ${o.age}</h2>${o.city ? `<span class="small muted">${esc(o.city)}</span>` : ""}</div>
      </div>
      ${o.stage === 3 && o.photo_dirs.length > 1 ? `<div style="display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory" id="more-photos"></div>` : ""}
      <p class="quote">${esc(o.glimpse)}</p>
      <div class="track" aria-label="Stage ${m.stage} of 3">${STAGES.map((s, i) => `<div class="${i + 1 < m.stage ? "done" : i + 1 === m.stage ? "now" : ""}">${s}</div>`).join("")}</div>
      <div id="action">${actionHtml()}</div>
      ${o.bio ? `<div class="stack"><h3>About ${name}</h3><p>${esc(o.bio)}</p></div>` : ""}
      <div class="stack"><div class="spread"><h3>What you've learned</h3><span class="small muted">${facts.length} of 6</span></div>${revealsHtml()}</div>
      <div class="stack"><h3>Conversation</h3>
        <div class="msgs" id="msgs"></div>
        ${m.stage < 2 ? `<div class="locked-note">${icon("lock")}<span>Chat opens when you both choose to keep going after your first duel. Until then, you can answer the quick questions during duels.</span></div>` : ""}
      </div>`;

    if (o.stage === 3 && o.photo_dirs.length > 1) {
      const urls = await Promise.all(o.photo_dirs.slice(1).map((d) => photoFor(d, 4)));
      $("#more-photos", app).innerHTML = urls.map((u) => `<div class="frost md" style="scroll-snap-align:start"><img src="${esc(u)}" alt="Another photo of ${name}"></div>`).join("");
    }

    const { data: history } = await sb.from("messages").select("*").eq("match_id", match_id).order("created_at").limit(300);
    seenMsgs.clear();
    history?.forEach(addMsg);
    if (!history?.length) $("#msgs", app).innerHTML = `<p class="small muted" id="hint">${m.stage < 2 ? "Your answers to the quick questions show up here." : `Nothing yet. Say hello to ${name}.`}</p>`;

    document.querySelector(".composer")?.remove();
    if (m.stage >= 2) {
      const c = document.createElement("div");
      c.className = "composer";
      c.innerHTML = `<form id="send"><input id="text" maxlength="1000" placeholder="Message ${name}" autocomplete="off" aria-label="Message ${name}"><button class="btn small" aria-label="Send">${icon("send", 18)}</button></form>`;
      document.body.appendChild(c);
      $("#send", c).onsubmit = send;
    }
    wire();
  }

  function addMsg(msg) {
    if (seenMsgs.has(msg.id)) return;
    seenMsgs.add(msg.id);
    $("#hint", app)?.remove();
    const d = document.createElement("div");
    d.className = "msg" + (msg.sender === me.id ? " mine" : "") + (msg.kind === "prompt" ? " prompt" : "");
    d.textContent = msg.body;
    $("#msgs", app)?.appendChild(d);
  }

  async function send(e) {
    e.preventDefault();
    const input = document.querySelector("#text");
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    const { data, error } = await sb.from("messages").insert({ match_id, sender: me.id, body }).select().single();
    if (error) { input.value = body; return toast(errorText(error)); }
    haptic();
    addMsg(data);
    data && document.querySelector(".msg:last-child")?.scrollIntoView({ block: "end", behavior: "smooth" });
  }

  function wire() {
    $("#back", app).onclick = () => nav.go("matches");
    $("#more", app).onclick = safety;
    $("#play", app)?.addEventListener("click", () => { haptic("medium"); nav.go("duel", { duel_id: m.duel_id, match_id }); });
    $("#keep", app)?.addEventListener("click", () => decide(true));
    $("#pass", app)?.addEventListener("click", async () => {
      const ok = await confirmSheet({ title: `Pass on ${o.display_name}?`, text: "The match ends for both of you. They won't be told why.", ok: "Pass", cancel: "Go back" });
      if (ok) decide(false);
    });
    $("#rematch", app)?.addEventListener("click", async () => {
      try { await rpc("rematch", { m: match_id }); haptic("medium"); await refresh(); } catch (e) { toast(errorText(e)); }
    });
  }

  async function decide(keep) {
    try {
      const r = await rpc("decide", { d: m.duel_id, keep });
      if (!keep) { toast("Passed. On to the next one."); return nav.go("matches"); }
      haptic("success");
      if (r?.stage > m.stage) toast(r.stage === 2 ? "You both kept going. Chat is open." : "You're both revealed.");
      else toast(`Kept. Waiting for ${o.display_name} to decide.`);
      await refresh();
    } catch (e) { toast(errorText(e)); }
  }

  async function safety() {
    const choice = await sheet((p, close) => {
      p.innerHTML = `<h3>${esc(o.display_name)}</h3>
        <button class="btn quiet wide" data-c="report">Report ${esc(o.display_name)}</button>
        <button class="btn quiet wide" data-c="block">Block ${esc(o.display_name)}</button>
        <button class="btn quiet wide" data-c="unmatch">End this match</button>`;
      p.onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) close(b.dataset.c); };
    });
    let left = false;
    if (choice === "report") left = await reportSheet(o.id, o.display_name, match_id);
    if (choice === "block") left = await blockFlow(o.id, o.display_name);
    if (choice === "unmatch") left = await unmatchFlow(match_id, o.display_name);
    if (left) nav.go("matches");
  }

  // Re-load and re-draw; if the photo got clearer, cross-fade to the sharper version.
  async function refresh() {
    const before = shownLevel;
    if (!(await load())) return;
    if (o.photo_level > before) {
      const frost = $("#frost", app);
      const src = await photoFor(o.photo_dirs?.[0], o.photo_level);
      if (frost && src) {
        const img = document.createElement("img");
        img.className = "next"; img.src = src; img.alt = "";
        frost.insertBefore(img, frost.querySelector(".clarity"));
        await img.decode().catch(() => {});
        requestAnimationFrame(() => img.classList.remove("next"));
        haptic("success");
        await new Promise((r) => setTimeout(r, 900));
      }
    }
    await render();
  }

  if (!(await load())) return;
  if (autoplay && m.duel_status === "open" && !m.i_played) return nav.go("duel", { duel_id: m.duel_id, match_id });
  await render();

  const ch = sb.channel(`match-${match_id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${match_id}` }, (p) => addMsg(p.new))
    .on("postgres_changes", { event: "*", schema: "public", table: "duels", filter: `match_id=eq.${match_id}` }, () => refresh())
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${match_id}` }, () => refresh())
    .subscribe();
  return () => { sb.removeChannel(ch); document.querySelector(".composer")?.remove(); };
}
