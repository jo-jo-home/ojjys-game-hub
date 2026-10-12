import { equal, ok } from "node:assert/strict";
import { createStatisticsStore } from "./statistics.ts";
const DAY = 86_400_000;
async function setup(run: (kv: Deno.Kv, store: ReturnType<typeof createStatisticsStore>, setTime: (time: number) => void) => Promise<void>) {
  const kv = await Deno.openKv(":memory:"); let now = Date.UTC(2026, 9, 11, 12);
  try { await run(kv, createStatisticsStore(() => Promise.resolve(kv), () => now), t => now = t); }
  finally { kv.close(); }
}
Deno.test("existing playtime contributes to totals without inventing daily history", async () => {
  await setup(async (kv, store) => {
    await kv.set(["hub_playtime", "sam", "snake"], { ms: 3600000, opens: 5, first: 1, last: 100 });
    const stats = await store.summary("sam"); equal(stats.totalMs, 3600000); equal(stats.totalOpens, 5);
    equal(stats.tried, 1); equal(stats.averageMs, 3600000); equal(stats.activeDays, 0); equal(stats.currentStreak, 0);
    equal(stats.activity.length, 14); equal(stats.recentMs, 0); equal(stats.activitySince, null);
    equal((await kv.get<{retained: boolean}>(["hub_playtime", "sam", "snake"])).value!.retained, true);
  });
});
Deno.test("daily totals cap background gaps and activity is separated by account", async () => {
  await setup(async (kv, store, time) => {
    const now = Date.UTC(2026, 9, 11, 12);
    await store.recordOpen("sam", "snake"); time(now + 15000); await store.recordPlaying("sam", "snake");
    time(now + 3 * 3600000); await store.recordPlaying("sam", "snake");
    const stats = await store.summary("sam"); equal(stats.totalMs, 30000); equal(stats.recentMs, 30000);
    equal(stats.activeDays, 1); equal(stats.totalOpens, 1); equal((await store.summary("alex")).totalMs, 0);
    let legacyRows = 0; for await (const _row of kv.list({ prefix: ["hub_activity"] })) legacyRows++;
    equal(legacyRows, 0, "daily tracking must not pollute the admin's recent-open event log");
  });
});
Deno.test("current and longest streaks handle yesterday, gaps, and UTC midnight", async () => {
  await setup(async (_kv, store, time) => {
    const start = Date.UTC(2026, 9, 1, 23, 59);
    for (const offset of [0, 1, 2, 5, 6]) { time(start + offset * DAY); await store.recordOpen("sam", "snake"); }
    let stats = await store.summary("sam"); equal(stats.currentStreak, 2); equal(stats.longestStreak, 3); equal(stats.activeDays, 5);
    time(start + 7 * DAY); equal((await store.summary("sam")).currentStreak, 2);
    time(start + 8 * DAY); equal((await store.summary("sam")).currentStreak, 0);
    await store.recordOpen("sam", "pong"); stats = await store.summary("sam"); equal(stats.tried, 2); equal(stats.currentStreak, 1);
  });
});
Deno.test("concurrent opens are atomic and do not lose counts", async () => {
  await setup(async (_kv, store) => {
    await Promise.all(Array.from({ length: 5 }, () => store.recordOpen("sam", "snake")));
    const stats = await store.summary("sam"); equal(stats.totalOpens, 5); equal(stats.activity.at(-1)!.opens, 5); ok(stats.since);
  });
});
