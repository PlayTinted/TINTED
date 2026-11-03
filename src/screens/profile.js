// Create or edit a profile: the glimpse a new match sees, who you'd like to meet, six reveals, photos.
import { sb, me } from "../supa.js";
import { $, $$, esc, toast, errorText, ageFrom, haptic } from "../ui.js";
import { makeVersions, photoFor } from "../photos.js";

const SHOW_ME = [["woman", "Women"], ["man", "Men"], ["nonbinary", "Non-binary people"]];
const I_AM = [["woman", "Woman"], ["man", "Man"], ["nonbinary", "Non-binary"]];
const FACT_IDEAS = [["Job", "What you actually do all day"], ["Sunday", "Your ideal one"], ["Hot take", "Something you'll defend"],
  ["Reading", "Or watching, or listening to"], ["Looking for", "In a person, honestly"], ["Secret skill", "The surprising one"]];

export async function profileForm(app, params, nav) {
  const onboarding = !!params.onboarding;
  if (params.step === "photos") return photosStep(app, nav, onboarding);

  const p = me.profile || { display_name: "", birthdate: "", gender: "", interested_in: [], min_age: 18, max_age: 99, city: "", glimpse: "", bio: "" };
  const { data: factRows } = me.profile ? await sb.from("profile_facts").select("*").eq("user_id", me.id).order("idx") : { data: [] };
  const facts = Array.from({ length: 6 }, (_, i) => factRows?.find((f) => f.idx === i) || { label: "", body: "" });
  let gender = p.gender;
  const interested = new Set(p.interested_in);

  app.innerHTML = `
    <div class="spread">
      <h1>${onboarding ? "Who's playing?" : "Edit profile"}</h1>
      ${onboarding ? "" : '<button class="text-btn" id="cancel">Cancel</button>'}
    </div>
    ${onboarding ? '<p class="lede">A match first sees only your name, age, town, one line and a tinted photo. The rest they earn.</p>' : ""}
    <form class="stack-lg" id="f" novalidate>
      <div class="stack">
        <label class="field">First name<input id="name" maxlength="40" required autocomplete="given-name" value="${esc(p.display_name)}"></label>
        <label class="field">Date of birth<input id="dob" type="date" required value="${esc(p.birthdate)}" max="${new Date().toISOString().slice(0, 10)}"></label>
        <label class="field">Town or city<input id="city" maxlength="60" value="${esc(p.city)}"></label>
        <label class="field">Your one line<input id="glimpse" maxlength="80" required placeholder="Ceramicist with a soft spot for terrible puns" value="${esc(p.glimpse)}">
          <span class="tiny muted" style="font-weight:400">The first thing a match reads about you. 80 characters.</span></label>
      </div>
      <div class="stack">
        <span class="small muted" style="font-weight:600">I'm a</span>
        <div class="chips" id="g" role="radiogroup">${I_AM.map(([k, l]) => `<button type="button" role="radio" aria-checked="${gender === k}" class="chip ${gender === k ? "on" : ""}" data-v="${k}">${l}</button>`).join("")}</div>
      </div>
      <div class="stack">
        <span class="small muted" style="font-weight:600">Pair me with</span>
        <div class="chips" id="i">${SHOW_ME.map(([k, l]) => `<button type="button" aria-pressed="${interested.has(k)}" class="chip ${interested.has(k) ? "on" : ""}" data-v="${k}">${l}</button>`).join("")}</div>
        <div class="row" style="flex-wrap:nowrap">
          <label class="field" style="flex:1">Aged from<input id="minAge" type="number" min="18" max="99" value="${p.min_age}"></label>
          <label class="field" style="flex:1">to<input id="maxAge" type="number" min="18" max="99" value="${p.max_age}"></label>
        </div>
      </div>
      <div class="stack">
        <h3>Your six reveals</h3>
        <p class="small muted">Hidden until your match pops hearts in a duel. Fill at least three.</p>
        ${facts.map((f, i) => `
          <div class="stack" style="gap:6px">
            <input data-label="${i}" maxlength="24" placeholder="${FACT_IDEAS[i][0]}" value="${esc(f.label)}" aria-label="Reveal ${i + 1} title">
            <input data-body="${i}" maxlength="140" placeholder="${FACT_IDEAS[i][1]}" value="${esc(f.body)}" aria-label="Reveal ${i + 1}">
          </div>`).join("")}
      </div>
      <label class="field">About you, shown once you're fully revealed<textarea id="bio" maxlength="300">${esc(p.bio)}</textarea></label>
      <p class="error" id="err" role="alert" hidden></p>
      <button class="btn wide" id="save">${onboarding ? "Continue to photos" : "Save changes"}</button>
    </form>`;

  $("#g", app).onclick = (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    gender = b.dataset.v; haptic();
    $$("#g .chip", app).forEach((c) => { c.classList.toggle("on", c === b); c.setAttribute("aria-checked", c === b); });
  };
  $("#i", app).onclick = (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    interested.has(b.dataset.v) ? interested.delete(b.dataset.v) : interested.add(b.dataset.v);
    b.classList.toggle("on"); b.setAttribute("aria-pressed", interested.has(b.dataset.v)); haptic();
  };
  $("#cancel", app)?.addEventListener("click", () => nav.go("me"));

  $("#f", app).onsubmit = async (e) => {
    e.preventDefault();
    const err = $("#err", app);
    const fail = (m) => { err.textContent = m; err.hidden = false; haptic("warning"); err.scrollIntoView({ block: "center", behavior: "smooth" }); };
    const name = $("#name", app).value.trim();
    const dob = $("#dob", app).value;
    const glimpse = $("#glimpse", app).value.trim();
    const minAge = Math.max(18, +$("#minAge", app).value || 18), maxAge = Math.min(99, +$("#maxAge", app).value || 99);
    if (!name) return fail("Add your first name.");
    if (!dob || ageFrom(dob) < 18) return fail("Tinted is for adults 18 and over.");
    if (!glimpse) return fail("Write your one line. It's the first thing a match reads.");
    if (!gender) return fail("Choose what you are.");
    if (!interested.size) return fail("Choose who you'd like to be paired with.");
    if (minAge > maxAge) return fail("The lower age needs to be below the upper age.");
    const filled = facts.map((_, i) => ({
      user_id: me.id, label: $(`[data-label="${i}"]`, app).value.trim(), body: $(`[data-body="${i}"]`, app).value.trim(),
    })).filter((f) => f.label && f.body);
    if (filled.length < 3) return fail("Fill in at least three reveals, each with a title and a line.");

    const btn = $("#save", app); btn.disabled = true; btn.textContent = "Saving";
    const cols = { display_name: name, birthdate: dob, gender, interested_in: [...interested], min_age: minAge, max_age: maxAge,
      city: $("#city", app).value.trim() || null, glimpse, bio: $("#bio", app).value.trim() || null };
    const { error } = me.profile
      ? await sb.from("profiles").update(cols).eq("id", me.id)
      : await sb.from("profiles").insert({ id: me.id, ...cols });
    if (error) { btn.disabled = false; btn.textContent = "Save changes"; return fail(errorText(error)); }
    await sb.from("profile_facts").delete().eq("user_id", me.id);
    const { error: fe } = await sb.from("profile_facts").insert(filled.map((f, i) => ({ ...f, idx: i })));
    if (fe) { btn.disabled = false; return fail(errorText(fe)); }
    await nav.loadProfile();
    haptic("success");
    if (onboarding) nav.go("profile", { onboarding: true, step: "photos" });
    else { toast("Profile saved"); nav.go("me"); }
  };
}

export async function photosStep(app, nav, onboarding) {
  async function render() {
    const { data: photos } = await sb.from("photos").select("*").eq("user_id", me.id).order("position");
    const urls = await Promise.all((photos || []).map((p) => photoFor(p.dir, 4)));
    const label = { pending: "Being checked", approved: "Live", rejected: "Not allowed" };
    const n = photos?.length || 0;
    app.innerHTML = `
      <div class="spread"><h1>${onboarding ? "Add your photos" : "Your photos"}</h1>
        ${onboarding ? "" : '<button class="text-btn" id="done">Done</button>'}</div>
      <p class="lede">Matches see the first one tinted at first. It clears as they play you. Up to 6, and every one is checked before anyone sees it.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${(photos || []).map((p, i) => `
          <div class="stack" style="gap:8px">
            <div class="frost"><img src="${esc(urls[i])}" alt="Your photo ${i + 1}"></div>
            <div class="spread tiny"><span class="${p.status === "rejected" ? "danger" : "muted"}">${label[p.status]}</span>
              <button class="text-btn tiny danger" data-del="${p.id}" data-dir="${esc(p.dir)}" style="padding:0">Remove</button></div>
          </div>`).join("")}
        ${n < 6 ? `<label class="frost" style="display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:inset 0 0 0 1.5px var(--haze);background:transparent">
            <span class="stack" style="align-items:center;gap:4px;z-index:2"><span class="display" style="font-size:44px;line-height:1">+</span><span class="small muted">Add photo</span></span>
            <input type="file" accept="image/*" id="file" hidden></label>` : ""}
      </div>
      ${onboarding ? `<button class="btn wide" id="finish" ${n ? "" : "disabled"}>Start playing</button>` : ""}`;

    $("#file", app)?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      toast("Uploading", 15000);
      try {
        const versions = await makeVersions(file);
        const dir = `${me.id}/${crypto.randomUUID()}`;
        for (const [name, blob] of Object.entries(versions)) {
          const { error } = await sb.storage.from("photos").upload(`${dir}/${name}.jpg`, blob, { contentType: "image/jpeg" });
          if (error) throw error;
        }
        const { error: e2 } = await sb.from("photos").insert({ user_id: me.id, dir, position: n });
        if (e2) throw e2;
        haptic("success");
        toast("Added. It goes live once it's been checked.");
      } catch (err) { toast(errorText(err)); }
      render();
    });
    $$("[data-del]", app).forEach((b) => b.addEventListener("click", async () => {
      await sb.from("photos").delete().eq("id", b.dataset.del);
      await sb.storage.from("photos").remove(["g1", "g2", "g3", "full"].map((v) => `${b.dataset.dir}/${v}.jpg`));
      render();
    }));
    $("#done", app)?.addEventListener("click", () => nav.go("me"));
    $("#finish", app)?.addEventListener("click", () => nav.enterApp());
  }
  await render();
}
