// Sessions v2 — the properties that make "log in once" true.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createSessionStore,
  deriveSessionKey,
  isToken,
  TOKEN_LEGACY,
} from "./sessions.ts";

const KEY = "ab".repeat(32); // hex — an HMAC key for tests

function store(clock: { now: number }, kv?: () => Promise<Deno.Kv>) {
  return createSessionStore(
    kv || (() => Promise.resolve(undefined as unknown as Deno.Kv)),
    KEY,
    () => clock.now,
  );
}

Deno.test("a minted token verifies and round-trips its identity", async () => {
  const clock = { now: Date.now() };
  const s = store(clock);
  const { token, expiresAt } = await s.mint({
    code: "abc123", label: "sam", role: "user", account: "sam", accountVersion: "v1",
  });
  assert(isToken(token) && !TOKEN_LEGACY.test(token), "v2 token shape");
  const verified = await s.verify(token);
  assert(verified, "verifies");
  assertEquals(verified!.info.code, "abc123");
  assertEquals(verified!.info.account, "sam");
  assertEquals(verified!.expiresAt, expiresAt);
  assert(!verified!.rotate, "fresh tokens do not rotate");
});

Deno.test("tampered tokens, foreign keys and expired tokens are rejected", async () => {
  const clock = { now: Date.now() };
  const s = store(clock);
  const { token } = await s.mint({ code: "shared", label: "shared password", role: "user" });
  // flip a character in the body
  const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);
  assertEquals(await s.verify(tampered), null, "tamper");
  // a different key cannot verify it
  const other = createSessionStore(async () => undefined as unknown as Deno.Kv, "cd".repeat(32), () => clock.now);
  assertEquals(await (await other.mint({ code: "x", label: "x", role: "user" })).token === token, false);
  const foreign = await other.mint({ code: "shared", label: "shared password", role: "user" });
  assertEquals(await s.verify(foreign.token), null, "foreign key");
  // expiry
  const short = createSessionStore(async () => undefined as unknown as Deno.Kv, KEY, () => clock.now, 1_000, 500);
  const dying = await short.mint({ code: "shared", label: "x", role: "user" });
  assert(await short.verify(dying.token), "valid before expiry");
  clock.now += 2_000;
  assertEquals(await short.verify(dying.token), null, "expired");
});

Deno.test("tokens rotate once they are old, and stay valid while fresh", async () => {
  const clock = { now: Date.now() };
  const s = store(clock);
  const { token } = await s.mint({ code: "shared", label: "x", role: "user" });
  clock.now += 31 * 86_400_000;
  const verified = await s.verify(token);
  assert(verified, "still valid at 31 days");
  assert(verified!.rotate, "and asks for rotation");
  clock.now -= 2 * 86_400_000;
  assert(!(await s.verify(token))!.rotate, "no rotation at 29 days");
});

Deno.test("revocation tombstones end a token, by token and by code", async () => {
  const kv = await Deno.openKv(":memory:");
  const clock = { now: Date.now() };
  const s = createSessionStore(() => Promise.resolve(kv), KEY, () => clock.now);
  const mine = await s.mint({ code: "shared", label: "x", role: "user" });
  assert(await s.verify(mine.token), "valid before revocation");
  await s.revokeToken(mine.token);
  assertEquals(await s.verify(mine.token), null, "token tombstone kills it");

  const second = await s.mint({ code: "shared", label: "x", role: "user" });
  await s.revokeCode("shared");
  assertEquals(await s.verify(second.token), null, "code tombstone kills it");
  kv.close();
});

Deno.test("policy is enforced when rows exist and fails open when they are gone", async () => {
  const kv = await Deno.openKv(":memory:");
  const clock = { now: Date.now() };
  const s = createSessionStore(() => Promise.resolve(kv), KEY, () => clock.now);
  const identity = {
    code: "id123", label: "sam", role: "user", account: "sam", accountVersion: "v1",
  };

  // missing account row (a wiped database): the signature still stands
  const wiped = await s.mint(identity);
  assert(await s.verify(wiped.token), "missing row fails open");

  // an account that exists and matches: valid
  await kv.set(["hub_accounts", "sam"], {
    id: "id123", version: "v1", label: "sammy", disabled: false, suspendedUntil: 0,
  });
  const good = await s.mint(identity);
  const verified = await s.verify(good.token);
  assert(verified, "matching account is valid");
  assertEquals(verified!.info.label, "sammy", "label refreshes from the account row");

  // disabled: dead
  await kv.set(["hub_accounts", "sam"], {
    id: "id123", version: "v1", label: "sammy", disabled: true, suspendedUntil: 0,
  });
  const banned = await s.mint(identity);
  assertEquals(await s.verify(banned.token), null, "disabled account is signed out");

  // suspended until the future: dead; until the past: alive again
  await kv.set(["hub_accounts", "sam"], {
    id: "id123", version: "v1", label: "sammy", disabled: false,
    suspendedUntil: clock.now + 60_000,
  });
  const suspended = await s.mint(identity);
  assertEquals(await s.verify(suspended.token), null, "suspension is enforced");
  await kv.set(["hub_accounts", "sam"], {
    id: "id123", version: "v1", label: "sammy", disabled: false,
    suspendedUntil: clock.now - 60_000,
  });
  const revived = await s.mint(identity);
  assert(await s.verify(revived.token), "an expired suspension lets the session back in");

  // password change (version mismatch): dead
  await kv.set(["hub_accounts", "sam"], {
    id: "id123", version: "v2", label: "sammy", disabled: false, suspendedUntil: 0,
  });
  const stale = await s.mint(identity);
  assertEquals(await s.verify(stale.token), null, "old password versions die");
  kv.close();
});

Deno.test("legacy identities honour their settings rows and fail open without them", async () => {
  const kv = await Deno.openKv(":memory:");
  const clock = { now: Date.now() };
  const s = createSessionStore(() => Promise.resolve(kv), KEY, () => clock.now);

  const shared = await s.mint({ code: "shared", label: "shared password", role: "user" });
  assert(await s.verify(shared.token), "no settings rows: fails open");
  await kv.set(["hub_settings", "shared"], { off: true });
  assertEquals(await s.verify(shared.token), null, "shared-off is enforced");

  await kv.delete(["hub_settings", "shared"]);
  await kv.set(["hub_settings", "legacy_access"], { off: true });
  const shared2 = await s.mint({ code: "shared", label: "shared password", role: "user" });
  assertEquals(await s.verify(shared2.token), null, "legacy-off is enforced");
  await kv.delete(["hub_settings", "legacy_access"]);

  const hash = "aa".repeat(32);
  const coded = await s.mint({ code: hash, label: "friend", role: "user" });
  assert(await s.verify(coded.token), "missing code row fails open");
  await kv.set(["hub_codes", hash], { label: "friend", role: "user", revokedAt: Date.now() });
  assertEquals(await s.verify(coded.token), null, "a revoked code is enforced");
  kv.close();
});

Deno.test("an unreachable database keeps every session alive", async () => {
  const s = createSessionStore(
    () => Promise.reject(new Error("kv is down")),
    KEY,
    () => Date.now(),
  );
  const account = await s.mint({
    code: "id", label: "x", role: "user", account: "x", accountVersion: "v",
  });
  assert(await s.verify(account.token), "account session survives a KV outage");
  const shared = await s.mint({ code: "shared", label: "x", role: "user" });
  assert(await s.verify(shared.token), "shared session survives a KV outage");
  // revocation writes are swallowed, never thrown
  await s.revokeToken(shared.token);
  await s.revokeCode("shared");
});

Deno.test("the signing key derives from env material and falls back to a stored one", async () => {
  const kv = await Deno.openKv(":memory:");
  const fromEnv = await deriveSessionKey("  hunter2  ", kv);
  assertEquals(fromEnv.length, 64, "hex sha256");
  assertEquals(await deriveSessionKey("hunter2", kv), fromEnv, "stable for the same material");
  const first = await deriveSessionKey("", kv);
  const second = await deriveSessionKey("", kv);
  assertEquals(second, first, "fallback key is created once and reused");
  assert(first.length === 64, "hex key");
  kv.close();
});
