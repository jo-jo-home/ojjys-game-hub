import { deepStrictEqual, equal, notEqual, ok } from "node:assert/strict";
import { createAccountStore, usernameKey } from "./accounts.ts";

const ADMIN = { code: "owner", label: "ojjy", role: "admin" };
const PASSWORD = "test-user-password";
function request(body: unknown): Request {
  return new Request("https://hub.test/api/admin/accounts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
async function withStore(run: (kv: Deno.Kv, store: ReturnType<typeof createAccountStore>) => Promise<void>) {
  const kv = await Deno.openKv(":memory:");
  try { await run(kv, createAccountStore(() => Promise.resolve(kv), "")); }
  finally { kv.close(); }
}
async function create(store: ReturnType<typeof createAccountStore>, username = "Sam", extra = {}) {
  return await store.manage(request({ action: "create", username, password: PASSWORD, ...extra }), ADMIN, () => {});
}

Deno.test("environment owner login is case-insensitive, has no fallback password, and rotates sessions", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const store = createAccountStore(() => Promise.resolve(kv), "owner-test-secret");
    const identity = await store.authenticate(" OJJY ", "owner-test-secret");
    ok(identity); equal(identity.role, "admin"); equal(identity.account, "@owner");
    equal(await store.authenticate("ojjy", "wrong-secret"), null);
    equal(await createAccountStore(() => Promise.resolve(kv), "").authenticate("ojjy", "owner-test-secret"), null);
    equal(await store.sessionValid(identity), true);
    const next = createAccountStore(() => Promise.resolve(kv), "different-owner-secret");
    equal(await next.sessionValid(identity), false);
    equal(await store.sessionValid(ADMIN), false, "legacy owner login bypassed ADMIN_PASSWORD");
    equal((await store.list()).length, 0, "owner password was persisted as a user account");
  } finally { kv.close(); }
});

Deno.test("created accounts hash passwords with independent salts and never expose credentials", async () => {
  await withStore(async (kv, store) => {
    equal((await create(store, "Sam", { label: "Sam Jones", role: "admin" })).status, 201);
    equal((await create(store, "Alex")).status, 201);
    const sam = (await kv.get<Record<string, any>>(["hub_accounts", "sam"])).value!;
    const alex = (await kv.get<Record<string, any>>(["hub_accounts", "alex"])).value!;
    equal(sam.credential.iterations, 600_000);
    notEqual(sam.credential.salt, alex.credential.salt);
    notEqual(sam.credential.hash, alex.credential.hash);
    ok(!JSON.stringify(sam).includes(PASSWORD));
    const identity = await store.authenticate(" SAM ", PASSWORD);
    ok(identity); equal(identity.label, "Sam Jones"); equal(identity.role, "user");
    equal(await store.authenticate("sam", PASSWORD.toUpperCase()), null);
    equal(await store.authenticate("missing", PASSWORD), null);
    const data = await (await store.manage(new Request("https://hub.test/api/admin/accounts"), ADMIN, () => {})).json();
    const text = JSON.stringify(data);
    ok(!text.includes("credential") && !text.includes("salt") && !text.includes(sam.credential.hash));
    equal(data.owner.username, "ojjy");
  });
});

Deno.test("account management is admin-only and validates names, passwords and reserved owner", async () => {
  const unopened = createAccountStore(() => { throw new Error("unauthorized request opened KV"); }, "");
  for (const user of [null, { code: "user", label: "user", role: "user" }]) {
    equal((await unopened.manage(request({}), user, () => {})).status, 404);
  }
  await withStore(async (_kv, store) => {
    for (const body of [
      { username: "ojjy", password: PASSWORD },
      { username: "a", password: PASSWORD },
      { username: "bad name", password: PASSWORD },
      { username: "sam", password: "short" },
      { username: "sam", password: "x".repeat(129) },
      { username: "sam", password: PASSWORD, label: "x".repeat(41) },
      { username: "sam", password: PASSWORD, action: "promote" },
    ]) equal((await store.manage(request(body), ADMIN, () => {})).status, 400);
    equal(usernameKey("constructor"), "constructor");
    equal(usernameKey("../../server"), null);
    equal((await create(store)).status, 201);
    equal((await create(store, "sAm")).status, 409);
    equal((await store.list()).length, 1);
  });
});

Deno.test("concurrent creation cannot replace an existing account", async () => {
  await withStore(async (_kv, store) => {
    const responses = await Promise.all([create(store), create(store, "sAM")]);
    deepStrictEqual(responses.map(r => r.status).sort(), [201, 409]);
    equal((await store.list()).length, 1);
    ok(await store.authenticate("sam", PASSWORD));
  });
});

Deno.test("reset, disable, enable and delete revoke sessions across independent stores", async () => {
  await withStore(async (kv, store) => {
    await create(store);
    const other = createAccountStore(() => Promise.resolve(kv), "");
    const info = (await store.authenticate("sam", PASSWORD))!;
    const token = "a".repeat(64);
    await kv.set(["hub_sessions", token], info);
    equal(await other.sessionValid({ ...info }, token), true);
    const change = async (action: string, extra = {}) => {
      const response = await store.manage(request({ action, username: "sam", ...extra }), ADMIN, () => {});
      equal(response.status, 200);
    };
    await change("update", { label: "Renamed" });
    const renamed = { ...info };
    equal(await other.sessionValid(renamed, token), true); equal(renamed.label, "Renamed");
    await change("update", { password: "new-user-password" });
    equal(await other.sessionValid({ ...info }, token), false);
    equal(await store.authenticate("sam", PASSWORD), null);
    const reset = (await store.authenticate("sam", "new-user-password"))!;
    await kv.set(["hub_sessions", token], reset);
    await change("disable");
    equal(await other.sessionValid(reset, token), false);
    equal(await store.authenticate("sam", "new-user-password"), null);
    await change("enable");
    equal(await other.sessionValid(reset, token), false, "enable revived an old session");
    const enabled = (await store.authenticate("sam", "new-user-password"))!;
    await kv.set(["hub_sessions", token], enabled);
    await change("delete");
    equal(await other.sessionValid(enabled, token), false);
    equal(await store.authenticate("sam", "new-user-password"), null);
    equal((await store.list()).length, 0);
    await create(store);
    const recreated = (await store.authenticate("sam", PASSWORD))!;
    notEqual(recreated.code, info.code);
    equal(await other.sessionValid(enabled), false);
  });
});

Deno.test("logout rejects a warm identity once the persisted session is gone", async () => {
  await withStore(async (kv, store) => {
    await create(store);
    const info = (await store.authenticate("sam", PASSWORD))!;
    const token = "b".repeat(64);
    await kv.set(["hub_sessions", token], info);
    equal(await store.sessionValid(info, token), true);
    await kv.delete(["hub_sessions", token]);
    equal(await store.sessionValid(info, token), false);
  });
});

Deno.test("login-attempt limits persist across stores and separate networks", async () => {
  await withStore(async (kv, store) => {
    const req = new Request("https://hub.test/login", { headers: { "x-forwarded-for": "192.0.2.1" } });
    for (let i = 0; i < 20; i++) equal(await store.takeLoginAttempt(req), true);
    const other = createAccountStore(() => Promise.resolve(kv), "");
    equal(await other.takeLoginAttempt(req), false);
    equal(await other.takeLoginAttempt(new Request("https://hub.test/login", { headers: { "x-forwarded-for": "192.0.2.2" } })), true);
  });
});
