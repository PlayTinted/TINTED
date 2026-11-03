// Brand pieces. The logo lives in src/brand/ (the build copies it to www/brand/).
// Resolved against this module, so it works in the bundled app and in the browser demo alike.
export const LOGO = new URL("./brand/logo.webp", import.meta.url).href;
export const LOGO_SMALL = new URL("./brand/logo-256.webp", import.meta.url).href;
export const WELCOME_PHOTO = new URL("./brand/welcome.jpg", import.meta.url).href;
export const NAME = "Tinted";
// Paste the Play Store link here once the Android app is live (e.g. "https://play.google.com/store/apps/details?id=com.edenos.tinted").
// While it's empty, no store badge is shown anywhere.
export const PLAY_STORE_URL = "";
export const TAGLINE = "Play first. <em>See later.</em>";
export const TAGLINE_TEXT = "Play first. See later.";

// The app-icon tile. "lg" is the welcome screen hero; "sm" sits in the top bar beside the wordmark.
// "lg" is the animated welcome logo: it starts behind tinted glass, the tint wipes clear, then it lives
// (light sweep, sparkles, pulsing heart, flickering flame, bubbles rising). Effects sit over the
// artwork at the positions of its own sparkle, heart and flame, so it reads as one animated logo.
export const logo = (size = "md") => size === "lg" ? `
  <div class="logo-anim" role="img" aria-label="${NAME}">
    <div class="la-bubbles" aria-hidden="true">${[[12,0,14],[26,1.3,10],[74,.6,16],[88,2.1,11],[58,2.8,9],[40,3.6,13]].map(([x,d,s]) => `<i style="--x:${x}%;--d:${d}s;--s:${s}px"></i>`).join("")}</div>
    <div class="la-tile">
      <img src="${LOGO}" alt="" draggable="false">
      <span class="la-glow la-heart"></span><span class="la-glow la-flame"></span>
      <span class="la-spark" style="--x:81%;--y:37%;--d:.2s"></span><span class="la-spark" style="--x:16%;--y:30%;--d:1.4s;--k:.7"></span>
      <span class="la-spark" style="--x:90%;--y:62%;--d:2.3s;--k:.6"></span><span class="la-spark" style="--x:34%;--y:11%;--d:3.1s;--k:.8"></span>
      <span class="la-sheen"></span><span class="la-tint"></span>
    </div>
  </div>`
  : `<span class="logo-mini"><img class="logo logo-${size}" src="${LOGO_SMALL}" alt="${NAME}" draggable="false"></span>`;
export const wordmark = (size = "sm") => `<span class="wordmark wordmark-${size}">${NAME}</span>`;

// The signature visual: a portrait behind tinted glass, with the tint lifting where hearts are freed.
// Pure CSS, so it works offline and before any photos exist.
export const heroGlass = () => `
  <div class="hero-glass" aria-hidden="true">
    <svg class="hero-person" viewBox="0 0 200 160" preserveAspectRatio="xMidYMax meet">
      <defs><radialGradient id="hp" cx="50%" cy="30%" r="70%"><stop offset="0" stop-color="#ffe3f1"/><stop offset="1" stop-color="#ff7ac0"/></radialGradient></defs>
      <circle cx="100" cy="72" r="30" fill="url(#hp)"/>
      <path d="M70 62c0-24 14-36 32-36s30 12 30 34c-6-10-16-15-30-15s-24 6-32 17z" fill="#3a145e"/>
      <path d="M44 160c4-34 26-52 56-52s52 18 56 52z" fill="url(#hp)"/>
    </svg>
    <div class="hero-tint"></div>
    <div class="hero-sheen"></div>
    <div class="hero-orbs">
      <i style="--c:#ff4fa3;--x:14%;--y:70%;--d:0s"></i>
      <i style="--c:#4f93ff;--x:78%;--y:62%;--d:.6s"></i>
      <i class="heart" style="--x:62%;--y:24%;--d:1.2s"></i>
      <i style="--c:#a855f7;--x:28%;--y:20%;--d:1.8s"></i>
      <i style="--c:#ffb020;--x:86%;--y:30%;--d:2.4s"></i>
    </div>
  </div>`;
