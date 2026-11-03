// Round length: 90 seconds in the app. The investor demo can shorten it.
export const roundMs = () => globalThis.__ROUND_MS ?? 90_000;

// Free launch: Plus subscriptions are hidden everywhere. Flip to true (and restore match_limit in the database) to sell Plus.
export const SUBSCRIPTIONS_ON = false;
