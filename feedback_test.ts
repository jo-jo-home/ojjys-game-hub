import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { handleFeedbackRequest } from "./feedback.ts";

const USER = { code: "person-one", label: "Sam", role: "user" };
const ADMIN = { code: "owner", label: "owner", role: "admin" };
const CATALOGUE = { slope: "Slope", calculator: "Calculator" };

function post(body: unknown, path = "/api/feedback"): Request {
  return new Request("https://hub.test" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function draft(extra: Record<string, unknown> = {}) {
  return {
    name: "Sam Jones",
    kind: "idea",
    title: "Add game categories",
    details: "It would help me find puzzle games.",
    requestId: crypto.randomUUID(),
    ...extra,
  };
}

async function withKv(run: (kv: Deno.Kv) => Promise<void>) {
  const kv = await Deno.openKv(":memory:");
  try {
    await run(kv);
  } finally {
    kv.close();
  }
}

function call(
  kv: Deno.Kv,
  req: Request,
  identity: typeof USER | null = USER,
) {
  return handleFeedbackRequest(req, identity, () => Promise.resolve(kv), CATALOGUE);
}

async function inbox(kv: Deno.Kv, query = "") {
  const response = await call(
    kv,
    new Request("https://hub.test/api/admin/feedback" + query),
    ADMIN,
  );
  equal(response.status, 200);
  equal(response.headers.get("cache-control"), "no-store");
  return await response.json();
}

Deno.test("feedback requires a session and only admins can read or change the inbox", async () => {
  const neverOpen = () => {
    throw new Error("unauthorized requests must not touch KV");
  };
  const anonymous = await handleFeedbackRequest(post(draft()), null, neverOpen, CATALOGUE);
  equal(anonymous.status, 401);
  equal(anonymous.headers.get("content-type"), "application/json");
  for (const identity of [null, USER]) {
    for (const req of [
      new Request("https://hub.test/api/admin/feedback"),
      post({ id: "anything", status: "done" }, "/api/admin/feedback"),
    ]) {
      const response = await handleFeedbackRequest(req, identity, neverOpen, CATALOGUE);
      equal(response.status, 404);
    }
  }
});

Deno.test("all three submission types persist with server-owned identity and status", async () => {
  await withKv(async (kv) => {
    for (const kind of ["idea", "bug", "game"]) {
      const response = await call(kv, post(draft({
        kind,
        name: "  Zoë 王  ",
        title: "  Test submission  ",
        details: "  It stays on the loading screen.  ",
        game: "slope",
        gameName: "forged game name",
        label: "forged sender",
        code: "owner",
        status: "done",
      })));
      equal(response.status, 201);
      const { id } = await response.json();
      const item = (await kv.get<Record<string, unknown>>(["hub_feedback", id])).value!;
      equal(item.kind, kind);
      equal(item.title, "Test submission");
      equal(item.details, "It stays on the loading screen.");
      equal(item.name, "Zoë 王");
      equal(item.game, kind === "bug" ? "slope" : "");
      equal(item.gameName, kind === "bug" ? "Slope" : "");
      equal(item.label, USER.label);
      equal(item.code, USER.code);
      equal(item.status, "new");
    }
    equal((await inbox(kv)).items.length, 3);
  });
});

Deno.test("validation rejects malformed, oversized and unknown-game submissions without saving", async () => {
  await withKv(async (kv) => {
    const invalid = [
      null,
      [],
      draft({ name: undefined }),
      draft({ name: "" }),
      draft({ name: " \n\t " }),
      draft({ name: 123 }),
      draft({ name: [] }),
      draft({ name: "x".repeat(61) }),
      draft({ kind: "anything" }),
      draft({ title: "  " }),
      draft({ title: { text: "not a string" } }),
      draft({ title: "x".repeat(101) }),
      draft({ details: "x".repeat(2001) }),
      draft({ details: [] }),
      draft({ kind: "bug", game: "missing" }),
      draft({ kind: "bug", game: "toString" }),
      draft({ kind: "bug", game: "slope", details: "bad" }),
      draft({ requestId: "not-a-uuid" }),
    ];
    for (const body of invalid) {
      equal((await call(kv, post(body))).status, 400, JSON.stringify(body));
    }
    equal((await call(kv, new Request("https://hub.test/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }))).status, 400);
    equal((await call(kv, new Request("https://hub.test/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(draft()),
    }))).status, 415);
    equal((await inbox(kv)).items.length, 0);
  });
});

Deno.test("concurrent retries save exactly one submission, with independent request ids per person", async () => {
  await withKv(async (kv) => {
    const body = draft();
    const responses = await Promise.all([
      call(kv, post(body)), call(kv, post(body)), call(kv, post(body)),
    ]);
    equal(responses.filter((r) => r.status === 201).length, 1);
    const results = await Promise.all(responses.map((r) => r.json()));
    equal(new Set(results.map((r) => r.id)).size, 1);
    equal((await inbox(kv)).items.length, 1);
    equal((await call(kv, post(body), { ...USER, code: "person-two" })).status, 201);
    equal((await inbox(kv)).items.length, 2);
  });
});

Deno.test("admin status changes preserve the submission and respect inbox filters", async () => {
  await withKv(async (kv) => {
    const { id } = await (await call(kv, post(draft()))).json();
    for (const status of ["planned", "done", "closed", "new"]) {
      const response = await call(kv, post({ id, status, title: "replace it" }, "/api/admin/feedback"), ADMIN);
      equal(response.status, 200);
      const { item } = await response.json();
      equal(item.status, status);
      equal(item.title, "Add game categories");
      equal(item.name, "Sam Jones");
      equal((await inbox(kv, "?status=" + status)).items.length, 1);
    }
    equal((await call(kv, post({ id, status: "unknown" }, "/api/admin/feedback"), ADMIN)).status, 400);
    const missing = `${Date.now()}-${crypto.randomUUID()}`;
    equal((await call(kv, post({ id: missing, status: "done" }, "/api/admin/feedback"), ADMIN)).status, 404);
    equal((await inbox(kv, "?status=done")).items.length, 0);
  });
});

Deno.test("filtered pagination returns older matching submissions without gaps or duplicates", async () => {
  await withKv(async (kv) => {
    const expected: string[] = [];
    for (let i = 0; i < 115; i++) {
      const createdAt = 1_750_000_000_000 + i;
      const id = `${createdAt}-${crypto.randomUUID()}`;
      const matching = i % 2 === 0;
      await kv.set(["hub_feedback", id], {
        id, createdAt, updatedAt: createdAt, title: "Loading issue", details: "Details",
        kind: matching ? "bug" : "game", status: matching ? "planned" : "new",
        game: "slope", gameName: "Slope", label: USER.label, code: USER.code,
      });
      if (matching) expected.unshift(id);
    }
    const first = await inbox(kv, "?kind=bug&status=planned");
    equal(first.items.length, 50);
    ok(first.cursor);
    const second = await inbox(kv, "?kind=bug&status=planned&cursor=" + encodeURIComponent(first.cursor));
    equal(second.cursor, null);
    deepStrictEqual(first.items.concat(second.items).map((item: { id: string }) => item.id), expected);
  });
});
