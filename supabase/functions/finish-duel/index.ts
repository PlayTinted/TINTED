// Re-plays a player's shots on the server with the duel's seed, so scores can't be faked.
// Each player calls this when their own 90 seconds end (players can play at different times).
// When both have submitted, the duel closes and both are asked "Keep going?".
import { createClient } from "npm:@supabase/supabase-js@2";
import { replay, MAX_SHOTS } from "./engine.js";

const ROUND_SECONDS = 90;
const GRACE_SECONDS = 30; // slow phones, poor signal

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: "Sign in again" }, 401);

    const { duel_id, angles } = await req.json();
    if (!duel_id || !Array.isArray(angles) || angles.length > MAX_SHOTS || !angles.every((a) => typeof a === "number")) {
      return json({ error: "Bad shot list" }, 400);
    }

    const { data: duel } = await admin.from("duels").select("*, matches!inner(user_a, user_b, ended_at)").eq("id", duel_id).single();
    if (!duel || ![duel.matches.user_a, duel.matches.user_b].includes(user.id)) return json({ error: "Not your duel" }, 403);
    if (duel.status !== "open" || duel.matches.ended_at) return json({ error: "This duel has closed" }, 409);

    const { data: mine } = await admin.from("duel_results").select("*").eq("duel_id", duel_id).eq("user_id", user.id).single();
    if (!mine) return json({ error: "Start the duel before finishing it" }, 409);
    if (mine.submitted_at) return json({ score: mine.score, hearts: mine.hearts, shots: mine.shots });

    const elapsed = (Date.now() - new Date(mine.started_at).getTime()) / 1000;
    // Late submissions still count, but only shots that fit in a round are believable.
    const maxShots = Math.floor((Math.min(elapsed, ROUND_SECONDS + GRACE_SECONDS)) / 0.2);
    const result = replay(Number(duel.seed), angles.slice(0, maxShots));

    await admin.from("duel_results").update({
      score: result.score, hearts: result.hearts, shots: result.shots, submitted_at: new Date().toISOString(),
    }).eq("duel_id", duel_id).eq("user_id", user.id);

    const { data: all } = await admin.from("duel_results").select("user_id, score, submitted_at").eq("duel_id", duel_id);
    const done = (all ?? []).filter((r) => r.submitted_at);
    if (done.length === 2) {
      const [x, y] = done;
      const winner = x.score === y.score ? null : (x.score > y.score ? x.user_id : y.user_id);
      await admin.from("duels").update({ status: "done", winner, ended_at: new Date().toISOString() })
        .eq("id", duel_id).eq("status", "open");
    }
    return json({ score: result.score, hearts: result.hearts, shots: result.shots, both_played: done.length === 2 });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
