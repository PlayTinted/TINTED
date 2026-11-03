// You: how a new match first sees you, editing, safety advice, legal, sign out, delete account.
import { SUBSCRIPTIONS_ON } from "../config.js";
import { sb, me, callFn, LEGAL_BASE } from "../supa.js";
import { $, esc, toast, errorText, sheet, ageFrom, haptic } from "../ui.js";
import { photosStep } from "./profile.js";
import { photoFor } from "../photos.js";
import { myPlan } from "../billing.js";

export async function meScreen(app, _params, nav) {
  const p = me.profile;
  const { data: photos } = await sb.from("photos").select("dir,status").eq("user_id", me.id).order("position").limit(1);
  const [frosted, plan] = await Promise.all([photoFor(photos?.[0]?.dir, 1), myPlan().catch(() => ({ plus: false }))]);
  const link = (page, label) => LEGAL_BASE ? `<a class="text-btn" href="${esc(LEGAL_BASE)}/${page}" target="_blank" rel="noopener">${label}</a>` : "";

  app.innerHTML = `
    <h1>You</h1>
    <div class="stack">
      <p class="small muted">How a new match first sees you</p>
      <div class="frost">${frosted ? `<img src="${esc(frosted)}" alt="Your first photo, tinted">` : ""}
        <div class="caption"><h2>${esc(p.display_name)}, ${ageFrom(p.birthdate)}</h2>${p.city ? `<span class="small muted">${esc(p.city)}</span>` : ""}</div></div>
      <p class="quote">${esc(p.glimpse)}</p>
    </div>
    ${SUBSCRIPTIONS_ON || plan.plus ? `<button class="upsell" id="plus">${plan.plus
      ? `<span><b>You're on Plus</b><span>Three matches at once, first in line. Manage your subscription.</span></span>`
      : `<span><b>Get Plus</b><span>Play three matches at once and get paired first.</span></span>`}<span class="plus-badge">Plus</span></button>` : ""}
    <div class="stack">
      <button class="btn quiet wide" id="edit">Edit profile and reveals</button>
      <button class="btn quiet wide" id="photos">Manage photos</button>
    </div>
    <div class="surface stack">
      <h3>Before you meet</h3>
      <p class="muted small">Meet somewhere public, tell a friend where you'll be, and never send money to someone you haven't met. If anyone makes you uncomfortable, report them from their match page.</p>
    </div>
    <div class="stack" style="gap:0;align-items:flex-start">
      ${link("privacy.html", "Privacy Policy")}
      ${link("terms.html", "Terms of Use")}
      <button class="text-btn" id="out">Sign out</button>
      <button class="text-btn danger" id="del">Delete my account</button>
    </div>`;

  $("#edit", app).onclick = () => nav.go("profile", {});
  $("#plus", app)?.addEventListener("click", () => nav.go("plus", { from: "me" }));
  $("#photos", app).onclick = () => { app.innerHTML = ""; photosStep(app, nav, false); };
  $("#out", app).onclick = async () => { await sb.from("profiles").update({ push_token: null }).eq("id", me.id); await sb.auth.signOut(); };
  $("#del", app).onclick = () => sheet((panel, close) => {
    panel.innerHTML = `<h3>Delete your account?</h3>
      <p class="muted">This permanently removes your profile, photos, matches, messages and duel history. It can't be undone.</p>
      ${plan.plus ? `<p class="error">Deleting your account doesn't cancel Plus. Cancel it in Google Play first, or you'll keep being charged.</p>` : ""}
      <label class="field">Type DELETE to confirm<input id="c" autocomplete="off" autocapitalize="characters"></label>
      <button class="btn wide" id="yes" disabled>Delete my account</button><button class="btn quiet wide" id="no">Keep my account</button>`;
    const yes = $("#yes", panel);
    $("#c", panel).oninput = (e) => (yes.disabled = e.target.value.trim().toUpperCase() !== "DELETE");
    $("#no", panel).onclick = () => close();
    yes.onclick = async () => {
      yes.disabled = true; yes.textContent = "Deleting";
      try {
        await callFn("delete-account", {});
        haptic("success");
        close();
        toast("Your account has been deleted.");
        await sb.auth.signOut({ scope: "local" }); // the user no longer exists on the server
      } catch (e) { toast(errorText(e)); yes.disabled = false; yes.textContent = "Delete my account"; }
    };
  });
}
