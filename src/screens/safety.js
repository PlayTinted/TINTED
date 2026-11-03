// Report and block, available on every profile and chat.
import { sb, me, rpc } from "../supa.js";
import { $, esc, toast, errorText, sheet, confirmSheet } from "../ui.js";

const REASONS = [
  ["fake", "Fake profile or scam"],
  ["harassment", "Harassment or threats"],
  ["inappropriate_photo", "Inappropriate photo"],
  ["underage", "Might be under 18"],
  ["spam", "Spam or selling"],
  ["other", "Something else"],
];

// Returns true if a report was sent.
export function reportSheet(userId, name, matchId) {
  return sheet((card, close) => {
    let reason = null;
    card.innerHTML = `<h3>Report ${esc(name)}</h3>
      <p class="small muted">${esc(name)} won't know you reported them. We review every report.</p>
      <div class="chips" id="r">${REASONS.map(([k, l]) => `<button type="button" class="chip" data-v="${k}">${l}</button>`).join("")}</div>
      <label class="field">Anything else we should know?<textarea id="d" maxlength="1000"></textarea></label>
      <label class="row" style="color:var(--ivory)"><input type="checkbox" id="b" checked style="width:auto"> Also block ${esc(name)}</label>
      <button class="btn wide" id="send" disabled>Send report</button><button class="btn quiet wide" id="x">Cancel</button>`;
    $("#r", card).onclick = (e) => {
      const b = e.target.closest("[data-v]"); if (!b) return;
      reason = b.dataset.v;
      card.querySelectorAll("#r .chip").forEach((c) => c.classList.toggle("on", c === b));
      $("#send", card).disabled = false;
    };
    $("#x", card).onclick = () => close(false);
    $("#send", card).onclick = async () => {
      const { error } = await sb.from("reports").insert({ reporter: me.id, reported: userId, match_id: matchId, reason, details: $("#d", card).value.trim() || null });
      if (error) return toast(errorText(error));
      if ($("#b", card).checked) await sb.from("blocks").insert({ blocker: me.id, blocked: userId });
      toast("Report sent. Thank you.");
      close(true);
    };
  });
}

export async function blockFlow(userId, name) {
  const ok = await confirmSheet({ title: `Block ${name}?`, text: `You won't see each other again and your chat will close. ${name} isn't told.`, ok: "Block" });
  if (!ok) return false;
  const { error } = await sb.from("blocks").insert({ blocker: me.id, blocked: userId });
  if (error && error.code !== "23505") { toast(errorText(error)); return false; }
  toast(`${name} is blocked`);
  return true;
}

export async function unmatchFlow(matchId, name) {
  const ok = await confirmSheet({ title: `Unmatch ${name}?`, text: "Your chat and duels with them will disappear for both of you.", ok: "Unmatch" });
  if (!ok) return false;
  try { await rpc("unmatch", { m: matchId }); toast("Unmatched"); return true; }
  catch (e) { toast(errorText(e)); return false; }
}
