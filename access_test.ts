import { equal, ok } from "node:assert/strict";
import { createAccessStore } from "./access.ts";

const OWNER = { code: "owner", label: "ojjy", role: "admin", account: "@owner" };
const CURRENT = "a".repeat(64);
const HASH = "b".repeat(64);
function req(body: unknown): Request {
  return new Request("https://hub.test/api/admin/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function setup(run: (kv: Deno.Kv, store: ReturnType<typeof createAccessStore>) => Promise<void>) {
  const kv = await Deno.openKv(":memory:");
  try {
    await kv.set(["hub_sessions", CURRENT], { ...OWNER, at: Date.now() });
    await run(kv, createAccessStore(() => Promise.resolve(kv), true, true));
  } finally { kv.close(); }
}

Deno.test("deleted access codes and their hashes cannot authenticate warm sessions", async () => {
  await setup(async (kv, store) => {
    const token = "c".repeat(64), info = { code: HASH, label: "friend", role: "user" };
    await kv.set(["hub_codes", HASH], { label: "friend", role: "user", revokedAt: null });
    await kv.set(["hub_sessions", token], { ...info, at: Date.now() });
    equal(await store.sessionValid(info, token), true);
    equal((await store.manage(req({ action: "delete-code", hash: HASH }), OWNER, CURRENT, () => {})).status, 200);
    equal((await kv.get(["hub_codes", HASH])).value, null);
    equal(await store.sessionValid(info, token), false);
    // Even a racing/stale session row cannot restore a deleted credential.
    await kv.set(["hub_sessions", token], { ...info, at: Date.now() });
    equal(await store.sessionValid(info, token), false);
  });
});

Deno.test("shared-password removal revokes existing sessions and cannot be undone", async () => {
  await setup(async (kv, store) => {
    const token = "d".repeat(64), info = { code: "shared", label: "shared", role: "user" };
    await kv.set(["hub_sessions", token], { ...info, at: Date.now() });
    equal(await store.sessionValid(info, token), true);
    equal((await store.manage(req({ action: "delete-shared" }), OWNER, CURRENT, () => {})).status, 200);
    equal(await store.sessionValid(info, token), false);
    equal((await store.manage(req({ action: "shared-on" }), OWNER, CURRENT, () => {})).status, 409);
    equal((await store.policy()).sharedDeleted, true);
    equal((await store.policy()).sharedEnabled, false);
  });
});

Deno.test("accounts-only sign-in revokes every legacy method but keeps owner credentials", async () => {
  await setup(async (kv, store) => {
    const token = "e".repeat(64);
    await kv.set(["hub_codes", HASH], { label: "friend", role: "user", revokedAt: null });
    await kv.set(["hub_sessions", token], { code: HASH, label: "friend", role: "user", at: Date.now() });
    equal((await store.manage(req({ action: "legacy-off" }), OWNER, CURRENT, () => {})).status, 200);
    equal((await store.policy()).legacyEnabled, false);
    equal((await kv.get(["hub_sessions", token])).value, null);
    ok((await kv.get(["hub_sessions", CURRENT])).value);
  });
});

Deno.test("sessions use non-bearer identifiers and the current owner session is protected", async () => {
  await setup(async (kv, store) => {
    const token = "f".repeat(64);
    await kv.set(["hub_sessions", token], { code: "friend", label: "friend", role: "user", at: Date.now() });
    const entries = await store.sessions(CURRENT);
    const other = entries.find(row => !row.current)!;
    ok(other); ok(other.id !== token);
    ok(!JSON.stringify(entries).includes(token));
    equal((await store.manage(req({ action: "revoke-session", id: other.id }), OWNER, CURRENT, () => {})).status, 200);
    equal((await kv.get(["hub_sessions", token])).value, null);
    const current = entries.find(row => row.current)!;
    equal((await store.manage(req({ action: "revoke-session", id: current.id }), OWNER, CURRENT, () => {})).status, 400);
    ok((await kv.get(["hub_sessions", CURRENT])).value);
  });
});

Deno.test("remove-all erases user credentials, code hashes and sessions while retaining the owner", async () => {
  await setup(async (kv, store) => {
    await kv.set(["hub_accounts", "friend"], { id: HASH, credential: { hash: "password-hash" } });
    await kv.set(["hub_codes", HASH], { label: "friend", role: "user", revokedAt: null });
    await kv.set(["hub_sessions", "1".repeat(64)], { code: HASH, account: "friend", role: "user", at: Date.now() });
    await kv.set(["hub_sessions", "2".repeat(64)], { ...OWNER, at: Date.now() });
    equal((await store.manage(req({ action: "remove-all" }), OWNER, CURRENT, () => {})).status, 200);
    equal((await kv.get(["hub_accounts", "friend"])).value, null);
    equal((await kv.get(["hub_codes", HASH])).value, null);
    equal((await store.sessions(CURRENT)).length, 1);
    ok((await kv.get(["hub_sessions", CURRENT])).value);
    const policy = await store.policy();
    equal(policy.legacyEnabled, false); equal(policy.sharedDeleted, true); equal(policy.adminCodeDeleted, true);
  });
});

Deno.test("access controls require admin permission and cannot delete the only owner-login path", async () => {
  const unopened = createAccessStore(() => { throw new Error("KV should not open"); }, false, false);
  equal((await unopened.manage(req({ action: "remove-all" }), null, CURRENT, () => {})).status, 404);
  await setup(async (kv) => {
    const store = createAccessStore(() => Promise.resolve(kv), false, true);
    const legacyOwner = { code: "owner", label: "owner", role: "admin" };
    equal((await store.manage(req({ action: "remove-all" }), legacyOwner, CURRENT, () => {})).status, 400);
    equal((await store.manage(req({ action: "delete-admin-code" }), legacyOwner, CURRENT, () => {})).status, 400);
    equal((await store.manage(req({ action: "legacy-off" }), legacyOwner, CURRENT, () => {})).status, 400);
    equal((await store.policy()).adminCodeEnabled, true);
  });
});
