// Sends push notifications through Firebase Cloud Messaging (HTTP v1).
// Triggered by database webhooks on INSERT into messages, matches and duels.
// Needs FIREBASE_SERVICE_ACCOUNT (the service-account JSON, as one secret). Without it, notifications are skipped.
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Calls from the database carry a secret it generated and keeps in Supabase Vault.
async function fromDatabase(req: Request, admin: any) {
  const s = req.headers.get("x-webhook-secret");
  if (!s) return false;
  const { data } = await admin.rpc("check_webhook_secret", { s });
  return data === true;
}

function b64url(bytes: ArrayBuffer | Uint8Array | string) {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cached: { token: string; exp: number } | null = null;
async function accessToken(sa: any) {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(sig)}`,
    }),
  });
  const out = await res.json();
  cached = { token: out.access_token, exp: Date.now() + out.expires_in * 1000 };
  return cached.token;
}

async function push(userId: string, title: string, body: string, data: Record<string, string>) {
  const { data: p } = await admin.from("profiles").select("push_token").eq("id", userId).single();
  if (!p?.push_token || !Deno.env.get("FIREBASE_SERVICE_ACCOUNT")) return;
  const sa = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
  const token = await accessToken(sa);
  await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { token: p.push_token, notification: { title, body }, data } }),
  });
}

async function nameOf(id: string) {
  const { data } = await admin.from("profiles").select("display_name").eq("id", id).single();
  return data?.display_name ?? "Someone";
}

async function membersOf(matchId: string) {
  const { data } = await admin.from("matches").select("user_a,user_b").eq("id", matchId).single();
  return data ? [data.user_a, data.user_b] : [];
}

Deno.serve(async (req) => {
  if (!(await fromDatabase(req, admin))) {
    return new Response("Forbidden", { status: 403 });
  }
  const { table, type, record, old_record } = await req.json();

  if (table === "matches" && type === "INSERT") {
    // Names only: at this stage that's all either person is allowed to know.
    await push(record.user_a, "You've been paired", `Meet ${await nameOf(record.user_b)}. Play your first duel to see more.`, { match_id: record.id });
    await push(record.user_b, "You've been paired", `Meet ${await nameOf(record.user_a)}. Play your first duel to see more.`, { match_id: record.id });
  } else if (table === "matches" && type === "UPDATE" && record.stage > (old_record?.stage ?? record.stage) && !record.ended_at) {
    const title = record.stage === 2 ? "Chat is open" : "Fully revealed";
    for (const [to, other] of [[record.user_a, record.user_b], [record.user_b, record.user_a]]) {
      const body = record.stage === 2
        ? `You and ${await nameOf(other)} both kept going. Say hello, then play duel 2.`
        : `You and ${await nameOf(other)} can now see each other properly.`;
      await push(to, title, body, { match_id: record.id });
    }
  } else if (table === "messages" && type === "INSERT" && record.kind === "chat") {
    const [a, b] = await membersOf(record.match_id);
    const to = a === record.sender ? b : a;
    if (to) {
      const preview = record.body.length > 80 ? record.body.slice(0, 77) + "…" : record.body;
      await push(to, await nameOf(record.sender), preview, { match_id: record.match_id });
    }
  } else if (table === "duel_results" && type === "UPDATE" && record.submitted_at && !old_record?.submitted_at) {
    const { data: d } = await admin.from("duels").select("match_id,status").eq("id", record.duel_id).single();
    if (d && d.status === "open") {
      const [a, b] = await membersOf(d.match_id);
      const to = a === record.user_id ? b : a;
      await push(to, "Your turn", `${await nameOf(record.user_id)} just played your duel. Beat ${record.score}.`, { match_id: d.match_id });
    }
  } else if (table === "duels" && type === "UPDATE" && record.status === "done" && old_record?.status !== "done") {
    const [a, b] = await membersOf(record.match_id);
    for (const to of [a, b]) await push(to, "Results are in", "See who won, then choose whether to keep going.", { match_id: record.match_id });
  }
  return new Response("ok");
});
