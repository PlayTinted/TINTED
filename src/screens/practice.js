// First-time practice board: teaches aim, swap, shatter and freeing a heart in about 30 seconds.
// No timer, no opponent, nothing sent anywhere.
import { createGame, preview, neighbours, SWAP, MIN_ANGLE, MAX_ANGLE } from "../../shared/engine.js";
import { createBoard } from "../board.js";
import { $, haptic } from "../ui.js";
import { sfx, unlockAudio } from "../sound.js";

const KEY = "tinted:practised";
export const hasPractised = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return true; } };
const markPractised = () => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } };

const STEPS = [
  { title: "Drag to aim, let go to shoot", body: "The dotted line shows exactly where your orb will land. A gold ring means it'll shatter. Drag below the launcher to cancel." },
  { title: "Match three to shatter them", body: "Three or more of one colour shatters them. Chain shatters in a row for a combo bonus." },
  { title: "Tap your orb to swap", body: "Not the colour you need? Tap it to swap with the next one." },
  { title: "Free a heart", body: "Shatter a heart, or knock it loose. In a real duel, each heart reveals something about your match and clears their photo a little." },
];

// A board where the first lesson is easy: pick a seed whose opening orb can shatter something.
function friendlySeed() {
  for (let s = 1; s < 500; s++) {
    const g = createGame(s * 7919);
    for (let a = MIN_ANGLE; a <= MAX_ANGLE; a += 0.05) if (preview(g, a).wouldPop) return s * 7919;
  }
  return 7919;
}

// Put one heart in easy reach: a bottom-row orb of your current colour that already has a matching neighbour.
function easyHeart(game) {
  for (const row of game.grid) for (const b of row) if (b) b.heart = false;
  for (let r = 5; r >= 3; r--) {
    for (let c = 0; c < game.grid[r].length; c++) {
      const b = game.grid[r][c];
      if (b && b.colour === game.nxt && neighbours(r, c).some(([a, cc]) => game.grid[a][cc]?.colour === b.colour)) { b.heart = true; return; }
    }
  }
  const b = game.grid[5].find(Boolean); if (b) b.heart = true;
}

export function practiceScreen(app, { then } = {}, nav) {
  const leave = () => then === "auth" ? nav.go("auth") : nav.go("play", then === "find" ? { autofind: true } : {});
  const game = createGame(friendlySeed());
  easyHeart(game);
  let step = 0, done = false;

  app.innerHTML = `
    <div class="spread"><h2>How to play</h2><button class="text-btn" id="skip">Skip</button></div>
    <div class="dots" id="dots">${STEPS.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>
    <div class="coach" id="coach" aria-live="polite"></div>
    <div class="board"><canvas id="cv" aria-label="Practice board. Drag to aim, let go to shoot, tap your orb to swap."></canvas>
      <div class="overlay" id="ov" hidden></div></div>`;

  const showStep = () => {
    const s = STEPS[step];
    $("#coach", app).innerHTML = `<span class="step">${step + 1}</span><div><b>${s.title}</b><span>${s.body}</span></div>`;
    [...$("#dots", app).children].forEach((d, i) => d.classList.toggle("on", i <= step));
  };
  const advance = (to) => {
    if (done || to <= step) return;
    step = to; sfx.go(); haptic("success"); showStep();
  };
  const finish = () => {
    if (done) return;
    done = true; markPractised(); sfx.heart();
    const ov = $("#ov", app);
    ov.hidden = false;
    ov.innerHTML = `<h2>You're ready</h2><p class="muted">In a real duel you get 90 seconds on the same board as your match. Free as many hearts as you can.</p>
      <button class="btn" id="go">${then === "find" ? "Find my match" : then === "auth" ? "Now play someone real" : "Done"}</button>`;
    $("#go", ov).onclick = leave;
  };

  const board = createBoard($("#cv", app), game, {
    canPlay: () => !done,
    onInput: (x) => { if (x === SWAP && step === 2) advance(3); },
    onShot: (res) => {
      if (step === 0) advance(res.popped.length ? 2 : 1);   // a first-shot shatter also covers lesson 2
      else if (step === 1 && res.popped.length) advance(2);
      if (res.heartsFound) { board.text("Heart freed", { col: "#ffc2d3" }); setTimeout(finish, 900); }
      if (game.over) { board.text("The ceiling caught you. Try again", { size: 0.8 }); setTimeout(() => { board.destroy(); nav.go("practice", { then }); }, 1400); }
    },
  });
  app.addEventListener("pointerdown", unlockAudio, { once: true });
  $("#skip", app).onclick = () => { markPractised(); leave(); };
  showStep();
  return () => board.destroy();
}
