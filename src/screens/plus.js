// Tinted Plus: what it adds, the plans, and buying, restoring or managing it.
import { LEGAL_BASE } from "../supa.js";
import { $, $$, esc, toast, errorText, haptic, icon } from "../ui.js";
import { billingAvailable, getPlans, myPlan, subscribe, restore, manageUrl } from "../billing.js";

const dateFmt = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

export async function plusScreen(app, params, nav) {
  const back = () => nav.go(params.from || "me");
  const header = `<div class="spread"><button class="text-btn" id="back" style="display:flex;align-items:center;gap:4px">${icon("back", 20)} Back</button></div>`;
  const perks = `
    <ul class="perks">
      <li><b>Three matches at once</b><span>Free accounts play one match at a time. Keep three games going and see who you click with.</span></li>
      <li><b>First in line</b><span>When you look for a match, you're paired before people without Plus.</span></li>
    </ul>
    <p class="small muted">Reveals, chat and safety tools are the same for everyone.</p>`;
  const legal = LEGAL_BASE ? ` <a class="text-btn tiny" style="padding:0;text-decoration:underline" href="${esc(LEGAL_BASE)}/terms.html#subscriptions" target="_blank" rel="noopener">Subscription terms</a>` : "";

  app.innerHTML = `${header}<div class="stack-lg"><h1>Plus</h1><p class="muted">Loading plans</p></div>`;
  $("#back", app).onclick = back;

  const plan = await myPlan().catch(() => ({ plus: false }));

  if (plan.plus) {
    const renews = plan.will_renew && plan.status !== "cancelled";
    const url = await manageUrl();
    app.innerHTML = `${header}
      <div class="stack-lg">
        <div class="plus-badge">Plus</div>
        <h1>You're on Plus</h1>
        <p class="lede">${plan.expires_at ? (renews ? `Renews on ${dateFmt(plan.expires_at)}.` : `Ends on ${dateFmt(plan.expires_at)}. You won't be charged again.`) : "Active."}${plan.status === "grace" ? " Google Play couldn't take your last payment. Update your payment method to keep Plus." : ""}</p>
        ${perks}
        <a class="btn line wide" href="${esc(url)}" target="_blank" rel="noopener">Manage in Google Play</a>
      </div>`;
    $("#back", app).onclick = back;
    return;
  }

  if (!billingAvailable()) {
    app.innerHTML = `${header}<div class="stack-lg"><div class="plus-badge">Plus</div><h1>Play more games at once</h1>${perks}
      <div class="locked-note">${icon("lock")}<span>Subscriptions are available in the Android app.</span></div></div>`;
    $("#back", app).onclick = back;
    return;
  }

  let plans = [];
  try { plans = await getPlans(); } catch (e) { toast(errorText(e)); }
  if (!plans.length) {
    app.innerHTML = `${header}<div class="stack-lg"><h1>Plus isn't on sale right now</h1><p class="lede">Google Play didn't return any plans. Check your connection and try again in a moment.</p>
      <button class="btn quiet" id="retry">Try again</button></div>`;
    $("#back", app).onclick = back;
    $("#retry", app).onclick = () => plusScreen(app, params, nav);
    return;
  }
  let chosen = plans[0];

  const render = () => {
    app.innerHTML = `${header}
      <div class="stack-lg">
        <div class="plus-badge">Plus</div>
        <h1>Play more games at once</h1>
        ${perks}
        <div class="plans" role="radiogroup" aria-label="Choose a plan">
          ${plans.map((p) => `
            <button class="plan ${p === chosen ? "on" : ""}" role="radio" aria-checked="${p === chosen}" data-id="${esc(p.id)}">
              <span class="plan-name">${p.period === "year" ? "Yearly" : "Monthly"}</span>
              <span class="plan-price">${esc(p.price)}<small> a ${p.period}</small></span>
              ${p.perMonth ? `<span class="plan-note">Works out at ${esc(p.perMonth)} a month</span>` : `<span class="plan-note">Cancel any time</span>`}
            </button>`).join("")}
        </div>
        <button class="btn wide" id="buy">Subscribe for ${esc(chosen.price)} a ${chosen.period}</button>
        <p class="tiny muted">Paid through Google Play. Renews automatically each ${chosen.period} until you cancel in Google Play; cancel at least 24 hours before renewal to avoid the next charge. You keep Plus until the end of the period you've paid for.${legal}</p>
        <button class="text-btn" id="restore">Restore a purchase</button>
      </div>`;
    $("#back", app).onclick = back;
    $$(".plan", app).forEach((b) => (b.onclick = () => { chosen = plans.find((p) => p.id === b.dataset.id); haptic(); render(); }));
    $("#buy", app).onclick = buy;
    $("#restore", app).onclick = doRestore;
  };

  async function buy() {
    const btn = $("#buy", app);
    btn.disabled = true; btn.textContent = "Opening Google Play";
    try {
      const r = await subscribe(chosen);
      if (r === "cancelled") return render();
      haptic("success");
      toast(r === "subscribed" ? "Welcome to Plus" : "Payment received. Plus will switch on in a moment.");
      nav.go(params.from || "play");
    } catch (e) { toast(errorText(e)); render(); }
  }

  async function doRestore() {
    const btn = $("#restore", app);
    btn.disabled = true; btn.textContent = "Checking Google Play";
    try {
      if (await restore()) { haptic("success"); toast("Plus restored"); nav.go(params.from || "play"); }
      else { toast("No active Plus subscription found on this Google account."); render(); }
    } catch (e) { toast(errorText(e)); render(); }
  }

  render();
}
