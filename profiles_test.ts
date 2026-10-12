import { deepStrictEqual as deep, equal, ok } from "node:assert/strict";
import { createAccountStore } from "./accounts.ts";
const ADMIN = { code: "owner", label: "owner", role: "admin" };
const TOKEN = "a".repeat(64);
function req(body?: unknown) {
  return new Request("https://hub.test/api/account", body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
async function setup(run: (kv: Deno.Kv, store: ReturnType<typeof createAccountStore>, identity: NonNullable<Awaited<ReturnType<ReturnType<typeof createAccountStore>["authenticate"]>>>) => Promise<void>) {
  const kv = await Deno.openKv(":memory:");
  try {
    const store = createAccountStore(() => Promise.resolve(kv), "test-owner-secret");
    await store.manage(req({ username: "Sam", password: "x" }), ADMIN, () => {});
    await store.manage(req({ username: "Alex", password: "y" }), ADMIN, () => {});
    const identity = (await store.authenticate("sam", "x"))!;
    await kv.set(["hub_sessions", TOKEN], identity);
    await run(kv, store, identity);
  } finally { kv.close(); }
}
const hasGame = (id: string) => ["snake", "pong"].includes(id);

Deno.test("profile edits belong to the authenticated account and never expose credentials", async () => {
  await setup(async (_kv, store, identity) => {
    const response = await store.self(req({ action: "profile", username: "alex", role: "admin", label: "Sam New", bio: "<script>test</script>", avatar: "🛹", favorites: ["snake", "snake"] }), identity, TOKEN, hasGame, () => {});
    equal(response.status, 200);
    const data = await response.json(); equal(data.profile.username, "Sam"); deep(data.profile.favorites, ["snake"]);
    equal((await store.profile("alex"))!.label, "Alex");
    equal((await store.profile("sam"))!.bio, "<script>test</script>");
    const people = await store.people("sam new"); equal(people.people.length, 1);
    const output = JSON.stringify([data, people]);
    for (const field of ["credential", "iterations", "accountVersion", '"code"', '"id"']) ok(!output.includes(field));
    equal(await store.sessionValid(identity, TOKEN), true);
  });
});

Deno.test("profile validation and access checks reject invalid writes", async () => {
  await setup(async (kv, store, identity) => {
    equal((await store.self(req({ action: "profile" }), null, TOKEN, hasGame, () => {})).status, 401);
    equal((await store.self(req(), { code: "shared", label: "shared", role: "user" }, TOKEN, hasGame, () => {})).status, 403);
    for (const fields of [{ label: "" }, { bio: "x".repeat(1001) }, { avatar: "fake" }, { favorites: ["unknown"] }, { favorites: "snake" }]) {
      equal((await store.self(req({ action: "profile", ...fields }), identity, TOKEN, hasGame, () => {})).status, 400);
    }
    await kv.delete(["hub_sessions", TOKEN]);
    equal((await store.self(req({ action: "profile", label: "wrong" }), identity, TOKEN, hasGame, () => {})).status, 401);
  });
});

Deno.test("favorite toggles preserve other profile fields and unrelated favorites", async () => {
  await setup(async (_kv, store, identity) => {
    const change = (body: unknown) => store.self(req(body), identity, TOKEN, hasGame, () => {});
    await change({ action: "profile", bio: "hello", favorites: ["snake"] });
    equal((await change({ action: "favorite", game: "pong", favorite: true })).status, 200);
    equal((await change({ action: "favorite", game: "snake", favorite: false })).status, 200);
    const profile = (await store.profile("sam"))!; deep(profile.favorites, ["pong"]); equal(profile.bio, "hello");
  });
});

Deno.test("username changes require the current password, retain the stable ID and revoke old sessions", async () => {
  await setup(async (kv, store, identity) => {
    const change = (username: string, currentPassword = "x") => store.self(req({ action: "username", username, currentPassword }), identity, TOKEN, hasGame, () => {});
    equal((await change("newname", "wrong")).status, 400);
    equal((await change("alex")).status, 409);
    equal((await change("ojjy")).status, 400);
    await kv.set(["hub_playtime", identity.code, "snake"], { ms: 5000 });
    await store.self(req({ action: "profile", bio: "keep me", favorites: ["snake"] }), identity, TOKEN, hasGame, () => {});
    equal((await change("NewName")).status, 200);
    equal(await store.authenticate("sam", "x"), null);
    const renamed = (await store.authenticate("newname", "x"))!; equal(renamed.code, identity.code);
    equal(await store.sessionValid(identity, TOKEN), false);
    equal((await store.profile("newname"))!.bio, "keep me");
    ok((await kv.get(["hub_playtime", renamed.code, "snake"])).value);
  });
});

Deno.test("password changes revoke every session and cannot change another account", async () => {
  await setup(async (kv, store, identity) => {
    const change = (currentPassword: string, password: string) => store.self(req({ action: "password", currentPassword, password, username: "alex" }), identity, TOKEN, hasGame, () => {});
    equal((await change("bad", "z")).status, 400); equal((await change("x", "")).status, 400);
    const response = await change("x", "z"); equal(response.status, 200); equal((await response.json()).reauthenticate, true);
    equal((await kv.get(["hub_sessions", TOKEN])).value, null);
    equal(await store.authenticate("sam", "x"), null); ok(await store.authenticate("sam", "z"));
    ok(await store.authenticate("alex", "y"));
  });
});

Deno.test("sign out other devices retains the current session and other people's sessions", async () => {
  await setup(async (kv, store, identity) => {
    const other = "b".repeat(64), alexToken = "c".repeat(64);
    await kv.set(["hub_sessions", other], identity);
    await kv.set(["hub_sessions", alexToken], await store.authenticate("alex", "y"));
    equal((await store.self(req({ action: "sign-out-others" }), identity, TOKEN, hasGame, () => {})).status, 200);
    equal((await kv.get(["hub_sessions", other])).value, null); ok((await kv.get(["hub_sessions", TOKEN])).value); ok((await kv.get(["hub_sessions", alexToken])).value);
  });
});

Deno.test("owner profiles are editable while environment-managed credentials remain protected", async () => {
  await setup(async (kv, store) => {
    const owner = (await store.authenticate("ojjy", "test-owner-secret"))!;
    const token = "d".repeat(64); await kv.set(["hub_sessions", token], owner);
    equal((await store.self(req({ action: "profile", label: "Jonas", bio: "the owner", avatar: "👑" }), owner, token, hasGame, () => {})).status, 200);
    equal((await store.profile("ojjy"))!.label, "Jonas");
    equal((await store.self(req({ action: "password", password: "z" }), owner, token, hasGame, () => {})).status, 400);
    ok(await store.authenticate("ojjy", "test-owner-secret"));
    ok(!JSON.stringify((await kv.get(["hub_owner_profile"])).value).includes("credential"));
  });
});

Deno.test("people search paginates across batches and hides banned profiles", async () => {
  await setup(async (kv, store) => {
    for (let i = 0; i < 51; i++) await kv.set(["hub_accounts", "member" + String(i).padStart(2, "0")], {
      id: String(i), username: "member" + i, label: i === 50 ? "Find me" : "Member", createdAt: 1, disabled: false,
    });
    const first = await store.people("find me"); equal(first.people.length, 0); ok(first.cursor);
    const next = await store.people("find me", first.cursor!); equal(next.people.length, 1); equal(next.people[0].username, "member50");
    await store.manage(req({ action: "ban", username: "sam" }), ADMIN, () => {});
    equal(await store.profile("sam"), null);
    equal((await store.people("sam")).people.length, 0);
  });
});
