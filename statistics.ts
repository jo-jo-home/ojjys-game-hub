// Account-wide totals reuse existing playtime rows; daily activity is recorded
// from this update onward. Days and streaks use UTC consistently across devices.
export type GameStat = { ms: number; opens: number; first: number; last: number; retained?: boolean };
type Activity = { ms: number; opens: number };
const DAY = 86_400_000;
const BEAT = 15_000;
const dayKey = (time: number) => new Date(time).toISOString().slice(0, 10);

export function createStatisticsStore(getKv: () => Promise<Deno.Kv>, clock = () => Date.now()) {
  async function record(code: string, game: string, opening: boolean) {
    const kv = await getKv();
    const now = clock();
    const gameKey = ["hub_playtime", code, game];
    const dailyKey = ["hub_daily_activity", code, dayKey(now)];
    for (let tries = 0; tries < 8; tries++) {
      const [entry, daily] = await kv.getMany<[GameStat, Activity]>([gameKey, dailyKey]);
      const previous = entry.value;
      const added = opening ? 0 : previous && now - previous.last < BEAT * 3
        ? Math.max(0, now - previous.last) : BEAT;
      const value = { ms: (previous?.ms || 0) + added, opens: (previous?.opens || 0) + (opening ? 1 : 0),
        first: previous?.first || now, last: now, retained: true };
      const activity = { ms: (daily.value?.ms || 0) + added, opens: (daily.value?.opens || 0) + (opening ? 1 : 0) };
      // Keep lifetime totals rather than allowing an inactive game's row to expire.
      if ((await kv.atomic().check(entry, daily).set(gameKey, value).set(dailyKey, activity).commit()).ok) return;
    }
    throw new Error("playtime changed too often");
  }

  async function games(code: string): Promise<(GameStat & { game: string })[]> {
    const out = [];
    const kv = await getKv();
    for await (const row of kv.list<GameStat>({ prefix: ["hub_playtime", code] })) {
      // Old rows had a 90-day expiry. Upgrade once, with a version check so a
      // profile read can never overwrite a concurrent gameplay heartbeat.
      if (!row.value.retained) await kv.atomic().check(row).set(row.key, { ...row.value, retained: true }).commit();
      const { ms, opens, first, last } = row.value;
      out.push({ game: String(row.key[2]), ms, opens, first, last });
    }
    return out.sort((a, b) => b.ms - a.ms);
  }

  async function summary(code: string) {
    const played = await games(code);
    const totalMs = played.reduce((sum, g) => sum + g.ms, 0);
    const totalOpens = played.reduce((sum, g) => sum + g.opens, 0);
    const days: (Activity & { day: string })[] = [];
    for await (const row of (await getKv()).list<Activity>({ prefix: ["hub_daily_activity", code] })) {
      days.push({ day: String(row.key[2]), ...row.value });
    }
    const keys = new Set(days.map(d => d.day));
    const today = Math.floor(clock() / DAY) * DAY;
    let currentStreak = 0, longestStreak = 0, run = 0, previous = 0;
    let at = keys.has(dayKey(today)) ? today : today - DAY;
    while (keys.has(dayKey(at))) { currentStreak++; at -= DAY; }
    for (const day of days) {
      const time = Date.parse(day.day);
      run = previous && time - previous === DAY ? run + 1 : 1;
      longestStreak = Math.max(longestStreak, run); previous = time;
    }
    const activity = Array.from({ length: 14 }, (_, i) => {
      const day = dayKey(today - (13 - i) * DAY);
      return days.find(d => d.day === day) || { day, ms: 0, opens: 0 };
    });
    return { games: played, totalMs, totalOpens, tried: played.length,
      averageMs: played.length ? Math.round(totalMs / played.length) : 0,
      since: played.length ? Math.min(...played.map(g => g.first)) : 0,
      lastPlayed: played.length ? Math.max(...played.map(g => g.last)) : 0,
      top: played[0] ? { game: played[0].game, ms: played[0].ms } : null,
      activeDays: days.length, currentStreak, longestStreak, activity,
      recentMs: activity.reduce((sum, d) => sum + d.ms, 0),
      activitySince: days[0]?.day || null };
  }
  return { recordOpen: (code: string, game: string) => record(code, game, true),
    recordPlaying: (code: string, game: string) => record(code, game, false), games, summary };
}
