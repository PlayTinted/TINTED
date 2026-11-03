// Sign in with a one-time code sent by email. No passwords to forget or leak.
import { sb, LEGAL_BASE } from "../supa.js";
import { $, esc, errorText, haptic } from "../ui.js";
import { logo, wordmark, WELCOME_PHOTO, TAGLINE, PLAY_STORE_URL } from "../brand.js";
import { Capacitor } from "@capacitor/core";
import { signInWithGoogle } from "../oauth.js";

const GAMEPLAY = new URL("../brand/gameplay.mp4", import.meta.url).href;
const GAMEPLAY_POSTER = new URL("../brand/gameplay-poster.webp", import.meta.url).href;
const HEART_AT = 0.52; // seconds into the clip where the cascade frees the hearts

// Real gameplay, with a little match card that reacts at the moment the hearts are freed.
function hero() {
  return `
    <figure class="gp" id="gp" aria-label="A real Tinted duel: a cascade frees two hearts and Mara's photo clears.">
      <video src="${GAMEPLAY}" poster="${GAMEPLAY_POSTER}" autoplay muted loop playsinline preload="auto" disablepictureinpicture></video>
      <span class="gp-live"><i></i>Live duel</span>
      <span class="gp-score" id="gpScore">1,240</span>
      <figcaption class="gp-card">
        <span class="gp-photo"><img src="${WELCOME_PHOTO}" alt="" draggable="false"></span>
        <span class="gp-meta"><b>Mara, 27</b><small>Leamington Spa</small></span>
        <span class="gp-fact"><span>Heart freed</span>Lighting designer</span>
      </figcaption>
    </figure>`;
}

const GOOGLE_G = `<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
// Website only: once the Android app is live, point people to it. Hidden inside the app itself.
const playBadge = () => PLAY_STORE_URL && !Capacitor.isNativePlatform() ? `
  <a class="play-badge" href="${PLAY_STORE_URL}" target="_blank" rel="noopener" aria-label="Get Tinted on Google Play">
    <img src="https://play.google.com/intl/en_gb/badges/static/images/badges/en_badge_web_generic.png" alt="Get it on Google Play" width="200" height="77">
  </a>` : "";
const CODE_LEN = 6;
const RESEND_S = 60;
const ambient = `<div class="aura" aria-hidden="true"><i></i><i></i><i></i></div><div class="grain" aria-hidden="true"></div>`;

export function authScreen(app, _params, nav) {
  let email = "", timer = null, resendTimer = null;
  const stopPeek = () => { if (timer) cancelAnimationFrame(timer); timer = null; };
  const stopAll = () => { stopPeek(); clearInterval(resendTimer); };
  function runPeek() {
    const fig = $("#gp", app), v = fig?.querySelector("video");
    if (!v) return;
    const sync = () => {
      const t = v.currentTime, on = t >= HEART_AT;
      fig.classList.toggle("freed", on);
      const score = on ? 2095 : 1240;
      $("#gpScore", fig).textContent = score.toLocaleString("en-GB");
      if (timer) timer = requestAnimationFrame(sync);
    };
    timer = requestAnimationFrame(sync);
    v.play?.().catch(() => {});
  }

  const legal = LEGAL_BASE
    ? `18+ only. By continuing you agree to the <a href="${esc(LEGAL_BASE)}/terms.html" target="_blank" rel="noopener">Terms</a> and <a href="${esc(LEGAL_BASE)}/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.`
    : "18+ only. By continuing you confirm you're 18 or over.";

  const arrow = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // Returning people see "Welcome back" by default (we remember how they last signed in on this device).
  let last = null; try { last = JSON.parse(localStorage.getItem("tinted:last-signin") || "null"); } catch { /* ignore */ }
  let mode = last ? "back" : "new";
  if (last?.email && !email) email = last.email;
  const remember = (how) => { try { localStorage.setItem("tinted:last-signin", JSON.stringify({ how, email: how === "email" ? email : "" })); } catch { /* ignore */ } };

  function stepEmail(msg = "", m = mode) {
    mode = m;
    stopAll();
    window.scrollTo(0, 0);
    if (mode === "back") return stepBack(msg);
    app.innerHTML = `${ambient}
      <div class="auth">
        <header class="auth-top">
          <div class="brand">${logo("sm")}${wordmark("sm")}</div>
          <p class="auth-tag">${TAGLINE}</p>
        </header>
        ${hero()}
        <div class="auth-copy">
          <h1 class="auth-h">Looks can <em>wait.</em></h1>
          <p class="auth-lede">Tinted is a dating app where you play before you see. You're matched with one person and you both play the same 90&#8209;second bubble board. Every heart you pop reveals something real about them, and their photo clears as you go.</p>
        </div>
        <button class="google-btn" id="google" type="button">
          ${GOOGLE_G}
          <span>Continue with Google</span>
        </button>
        <form class="auth-form" id="f" novalidate>
          <div class="pill-input ${msg ? "bad" : ""}">
            <label class="sr-only" for="email">Email address</label>
            <input id="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required value="${esc(email)}" placeholder="Or use your email">
            <button class="pill-go" id="go" aria-label="Send my sign-in code">${arrow}</button>
          </div>
          ${msg ? `<p class="auth-err" role="alert">${esc(msg)}</p>` : `<p class="auth-hint">We'll email you a code. No passwords, ever.</p>`}
        </form>
        <p class="auth-switch">Already on Tinted? <button type="button" class="link-btn" id="toBack">Sign in</button></p>
        <div class="auth-or"><span>or</span></div>
        <button class="auth-try" id="try" type="button">
          <span class="try-orb" aria-hidden="true"></span>
          <span><b>Try a board first</b><small>30 seconds, no sign-up</small></span>
          ${arrow}
        </button>
        ${playBadge()}
        <ol class="auth-steps" aria-label="How Tinted works">
          <li><b>Matched blind</b><span>A first name, one line and a tinted photo</span></li>
          <li><b>Play 90 seconds</b><span>Free hearts to unlock who they are</span></li>
          <li><b>Both keep going</b><span>Chat opens, then the full reveal</span></li>
        </ol>
        <p class="auth-legal">${legal}</p>
      </div>`;
    runPeek();
    wire();
    $("#toBack", app).onclick = () => stepEmail("", "back");
    $("#try", app).onclick = () => { stopAll(); nav.go("practice", { then: "auth" }); };
  }

  // Sign in for people who already have an account. Same Google / email-code flow; it logs them
  // straight into their existing account and skips profile setup.
  function stepBack(msg = "") {
    app.innerHTML = `${ambient}
      <div class="auth auth-back-screen">
        <header class="auth-top">
          <div class="brand">${logo("sm")}${wordmark("sm")}</div>
          <p class="auth-tag">${TAGLINE}</p>
        </header>
        <div class="auth-copy">
          <h1 class="auth-h">Welcome <em>back.</em></h1>
          <p class="auth-lede">Sign in with the Google account or email you used before. Your matches and duels are waiting.</p>
        </div>
        <button class="google-btn" id="google" type="button">${GOOGLE_G}<span>Continue with Google</span></button>
        <form class="auth-form" id="f" novalidate>
          <div class="pill-input ${msg ? "bad" : ""}">
            <label class="sr-only" for="email">Email address</label>
            <input id="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required value="${esc(email)}" placeholder="Your email">
            <button class="pill-go" id="go" aria-label="Send my sign-in code">${arrow}</button>
          </div>
          ${msg ? `<p class="auth-err" role="alert">${esc(msg)}</p>` : `<p class="auth-hint">We'll email you a code to sign in.</p>`}
        </form>
        <p class="auth-switch">New to Tinted? <button type="button" class="link-btn" id="toNew">Create an account</button></p>
        <p class="auth-legal">${legal}</p>
      </div>`;
    wire();
    $("#toNew", app).onclick = () => stepEmail("", "new");
  }

  function wire() {
    $("#google", app).onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.classList.add("busy"); haptic();
      remember("google");
      try { await signInWithGoogle(); } catch (err) { stepEmail(errorText(err)); }
      setTimeout(() => { b.disabled = false; b.classList.remove("busy"); }, 4000);
    };
    $("#f", app).onsubmit = async (e) => {
      e.preventDefault();
      email = $("#email", app).value.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) { haptic("warning"); return stepEmail("That doesn't look like an email address."); }
      const pill = $(".pill-input", app); pill.classList.add("busy"); $("#go", app).disabled = true;
      haptic();
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) return stepEmail(errorText(error));
      stepCode();
    };
  }

  function stepCode(msg = "") {
    stopAll();
    window.scrollTo(0, 0);
    const domain = email.split("@")[1] || "";
    const inbox = /gmail|googlemail/.test(domain) ? ["Open Gmail", "https://mail.google.com/mail/u/0/#inbox"]
      : /outlook|hotmail|live|msn/.test(domain) ? ["Open Outlook", "https://outlook.live.com/mail/"]
      : /yahoo/.test(domain) ? ["Open Yahoo Mail", "https://mail.yahoo.com/"]
      : /icloud|me\.com|mac\.com/.test(domain) ? ["Open iCloud Mail", "https://www.icloud.com/mail"] : null;
    app.innerHTML = `${ambient}
      <div class="auth auth-code">
        <button class="auth-back" id="back" aria-label="Use a different email"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <div class="mail-orb" aria-hidden="true"></div>
        <div class="auth-copy center">
          <h1 class="auth-h">Check your <em>inbox</em></h1>
          <p class="auth-lede">Enter the ${CODE_LEN}-digit code we sent to<br><b class="auth-email">${esc(email)}</b></p>
        </div>
        <form id="f" class="otp-wrap ${msg ? "bad" : ""}" novalidate>
          <div class="otp" aria-hidden="true">${Array.from({ length: CODE_LEN }, () => "<i></i>").join("")}</div>
          <input id="code" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="${CODE_LEN}" pattern="[0-9]*" aria-label="${CODE_LEN}-digit code">
        </form>
        ${msg ? `<p class="auth-err center" role="alert">${esc(msg)}</p>` : `<p class="auth-hint center">It works for an hour. Check spam if it's shy.</p>`}
        <div class="code-actions">
          ${inbox ? `<a class="btn quiet small" href="${inbox[1]}" target="_blank" rel="noopener">${inbox[0]}</a>` : ""}
          <button class="text-btn" id="resend" disabled>Send a new code in ${RESEND_S}s</button>
        </div>
      </div>`;
    const input = $("#code", app), cells = [...app.querySelectorAll(".otp i")], wrap = $("#f", app);
    const paint = () => {
      const v = input.value;
      cells.forEach((c, i) => { c.textContent = v[i] || ""; c.classList.toggle("on", i === Math.min(v.length, CODE_LEN - 1) && document.activeElement === input); c.classList.toggle("filled", !!v[i]); });
    };
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, CODE_LEN);
      wrap.classList.remove("bad"); paint();
      if (input.value.length === CODE_LEN) submit();
    });
    input.addEventListener("focus", paint); input.addEventListener("blur", paint);
    wrap.addEventListener("click", () => input.focus());
    input.focus({ preventScroll: true }); paint();

    let left = RESEND_S; const rb = $("#resend", app);
    resendTimer = setInterval(() => {
      left -= 1;
      if (left > 0) { rb.textContent = `Send a new code in ${left}s`; return; }
      clearInterval(resendTimer); rb.disabled = false; rb.textContent = "Send a new code";
    }, 1000);
    rb.onclick = async () => {
      rb.disabled = true; rb.textContent = "Sending";
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      stepCode(error ? errorText(error) : "");
      if (!error) $(".auth-hint", app).textContent = "New code sent. Use the newest email.";
    };
    $("#back", app).onclick = () => stepEmail();

    let checking = false;
    async function submit() {
      if (checking) return; checking = true;
      wrap.classList.add("busy"); input.blur();
      const { error } = await sb.auth.verifyOtp({ email, token: input.value, type: "email" });
      if (error) { haptic("warning"); checking = false; return stepCode("That code didn't match. Try the newest email."); }
      wrap.classList.remove("busy"); wrap.classList.add("ok");
      remember("email");
      haptic("success");
    }
    wrap.onsubmit = (e) => { e.preventDefault(); if (input.value.length === CODE_LEN) submit(); };
  }

  stepEmail();
  return stopAll;
}
