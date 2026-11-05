// Home: find a match (or wait in the queue), and jump to whoever's waiting on you.
import { rpc, sb, me } from "../supa.js";
import { $, esc, toast, errorText, haptic, sheet } from "../ui.js";
import { photoFor } from "../photos.js";
import { myPlan } from "../billing.js";
import { hasPractised } from "./practice.js";
import { SUBSCRIPTIONS_ON } from "../config.js";
import { logo, wordmark, heroGlass, TAGLINE } from "../brand.js";

export async function playScreen(app, params = {}, nav) {
  let matches = [], queued = false, busy = false, plan = { plus: false, match_limit: 1 };

  async function load() {
    [matches, queued, plan] = await Promise.all([rpc("my_matches").catch(() => []), rpc("in_queue").catch(() => false), myPlan().catch(() => plan)]);
    render();
  }

  function render() {
    const active = matches.filter((m) => !m.ended_reason);
    const myTurn = active.filter((m) => m.duel_status === "open" && !m.i_played);
    const full = active.length >= plan.match_limit;

    app.innerHTML = `
      <div class="topbar"><div class="brand">${logo("sm")}${wordmark("sm")}</div><button class="avatar-chip" id="meBtn" aria-label="Your profile"></button></div>
      ${queued ? `
        <div class="stack-lg" style="align-items:flex-start">
          <div class="orb" aria-hidden="true"></div>
          <h1>Looking for your match</h1>
          <p class="lede">You're one of the first people on Tinted. We're in pre-launch testing, so it may take a while for someone who fits to join. You're in the queue and will be paired as soon as they do, so check back soon.</p>
          <a class="btn wide" href="${location.hostname === "localhost" ? "https://playtinted.com/play" : "/play"}">Try a practice duel while you wait</a>
          <button class="btn line" id="invite">Invite a single friend</button>
          <p class="small muted">Every friend who joins near you means more people to match with, for both of you.</p>
          <button class="btn line" id="stop">Stop looking</button>
          <p class="small muted">The practice duel uses Mara and Jake, our AI demo profiles.</p>
        </div>`
      : `
        <div class="stack-lg">
          <div style="position:relative">${heroGlass()}
            <div class="hero-caption"><span class="clarity"><i><b style="width:35%"></b></i>Clearing</span></div></div>
          <p class="tagline">${TAGLINE}</p>
          <p class="lede">Get paired blind. You see a first name, one line and a tinted photo. Play them, and the glass clears.</p>
          <div class="early" role="note"><b>Pre-launch test · you're early</b><span>Tinted has only just opened, so there aren't many people on it yet and finding a match can take a while. Thanks for being one of the first to try it.</span></div>
          <button class="btn wide" id="find" ${full ? "disabled" : ""}>Find my match</button>
          ${full ? `<p class="small muted">You have ${plan.match_limit} matches on the go. Finish or pass on one to meet someone new.</p>` : ""}
          ${SUBSCRIPTIONS_ON && !plan.plus ? `<button class="upsell" id="plus"><span><b>Play three matches at once</b><span>Plus also puts you first in line when you look for a match.</span></span><span class="plus-badge">Plus</span></button>` : ""}
        </div>`}
      ${myTurn.length ? `<div class="stack"><h3>Waiting on you</h3><div class="list" id="turns">${myTurn.map((m) => `
        <button data-m="${m.match_id}"><div class="frost sm" data-dir="${esc(m.photo_dir)}" data-level="${m.photo_level}"></div>
          <span class="meta"><b>${esc(m.display_name)}</b><span>${m.they_played ? "Played your duel. Your turn." : `Duel ${m.duel_round} is ready`}</span></span>
          <span class="pill turn">Play</span></button>`).join("")}</div></div>` : ""}
      <hr>
      <div class="stack">
        <div class="spread"><h3>How it works</h3><button class="text-btn" id="howto">Practice board</button></div>
        <ol class="steps">
          <li><div><b>Glimpse</b><span class="muted">You're paired. Play a 90-second duel on the same board. Every heart you free unlocks something about them and clears their photo a little.</span></div></li>
          <li><div><b>Chat</b><span class="muted">If you both choose to keep going, chat opens and you play a second duel.</span></div></li>
          <li><div><b>Reveal</b><span class="muted">Keep going again and you see each other properly: every photo, every answer.</span></div></li>
        </ol>
      </div>`;

    app.querySelectorAll(".frost.sm[data-dir]").forEach(async (el) => {
      const src = await photoFor(el.dataset.dir, +el.dataset.level);
      if (src) el.innerHTML = `<img src="${esc(src)}" alt="">`;
    });
    $("#turns", app)?.addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (b) nav.go("match", { match_id: b.dataset.m }); });
    $("#invite", app)?.addEventListener("click", async () => {
      const text = "I'm on Tinted, a dating app where you play a 90-second bubble duel before you see who you matched with. It's brand new, so come and try it 🫧";
      const url = "https://playtinted.com/play";
      try {
        if (navigator.share) await navigator.share({ text, url });
        else { await navigator.clipboard.writeText(`${text} ${url}`); toast("Link copied. Send it to a friend"); }
      } catch (e) { if (e?.name !== "AbortError") toast("Couldn't share, try again"); }
    });
    $("#stop", app)?.addEventListener("click", async () => { await rpc("leave_queue").catch(() => {}); queued = false; render(); });
    $("#find", app)?.addEventListener("click", find);
    $("#howto", app)?.addEventListener("click", () => nav.go("practice", {}));
    $("#meBtn", app)?.addEventListener("click", () => nav.go("me"));
    sb.from("photos").select("dir").eq("user_id", me.id).order("position").limit(1).then(async ({ data }) => {
      const src = await photoFor(data?.[0]?.dir, 4); const b = $("#meBtn", app);
      if (src && b) b.innerHTML = `<img src="${esc(src)}" alt="">`;
    });
    $("#plus", app)?.addEventListener("click", () => nav.go("plus", { from: "play" }));
  }

  async function find() {
    if (!hasPractised()) return nav.go("practice", { then: "find" });
    if (busy) return; busy = true;
    haptic("medium");
    try {
      const m = await rpc("find_match");
      if (m?.id) { await paired(m.id); return; }
      queued = true; render();
    } catch (e) {
      if (e?.hint === "upgrade" && SUBSCRIPTIONS_ON) nav.go("plus", { from: "play" });
      else toast(errorText(e));
    } finally { busy = false; }
  }

  async function paired(matchId) {
    haptic("success");
    const [o] = await rpc("match_profile", { m: matchId }).catch(() => []);
    if (!o) return nav.go("match", { match_id: matchId });
    const src = await photoFor(o.photo_dirs?.[0], o.photo_level);
    const go = await sheet((p, close) => {
      p.innerHTML = `
        <p class="small muted">You've been paired</p>
        <div class="frost">${src ? `<img src="${esc(src)}" alt="A tinted photo of ${esc(o.display_name)}">` : ""}
          <div class="caption"><h2>${esc(o.display_name)}, ${o.age}</h2>${o.city ? `<span class="small muted">${esc(o.city)}</span>` : ""}</div></div>
        <p class="quote">${esc(o.glimpse)}</p>
        <button class="btn wide" data-go>Play your first duel</button>
        <button class="btn quiet wide" data-later>Later</button>`;
      p.querySelector("[data-go]").onclick = () => close(true);
      p.querySelector("[data-later]").onclick = () => close(false);
    });
    nav.go("match", { match_id: matchId, autoplay: !!go });
  }

  const off = nav.onPaired((m) => { if (queued) { queued = false; paired(m.id); } });
  app.innerHTML = `<div class="stack-lg"><h1 class="muted">…</h1></div>`;
  await load();
  if (params.autofind && !queued) find();
  return off;
}
