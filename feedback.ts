// Private suggestions/report inbox. KV keeps submissions across deployments;
// the request marker makes retrying a submission safe after a lost response.
type FeedbackKind = "idea" | "bug" | "game";
type FeedbackStatus = "new" | "planned" | "done" | "closed";

type FeedbackIdentity = { code: string; label: string; role: string };
type FeedbackRecord = {
  id: string;
  kind: FeedbackKind;
  title: string;
  details: string;
  game: string;
  gameName: string;
  name?: string; // older submissions only have the access-code label
  label: string;
  code: string;
  status: FeedbackStatus;
  createdAt: number;
  updatedAt: number;
};

const KINDS = ["idea", "bug", "game"];
const STATUSES = ["new", "planned", "done", "closed"];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PAGE_SIZE = 50;

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch { return null; }
}

export async function handleFeedbackRequest(
  req: Request,
  identity: FeedbackIdentity | null,
  getKv: () => Promise<Deno.Kv>,
  catalogue: Record<string, string>,
): Promise<Response> {
  const url = new URL(req.url);
  const admin = url.pathname === "/api/admin/feedback";
  if (admin && identity?.role !== "admin") return json({ error: "not found" }, 404);
  if (!identity) return json({ error: "your session expired — sign in again to send this" }, 401);

  try {
    if (admin && req.method === "GET") {
      const kind = url.searchParams.get("kind") || "";
      const status = url.searchParams.get("status") || "";
      if ((kind && !KINDS.includes(kind)) || (status && !STATUSES.includes(status))) {
        return json({ error: "unknown feedback filter" }, 400);
      }
      const kv = await getKv();
      const iter = kv.list<FeedbackRecord>({ prefix: ["hub_feedback"] }, {
        reverse: true,
        cursor: url.searchParams.get("cursor") || undefined,
        batchSize: PAGE_SIZE,
      });
      const items: FeedbackRecord[] = [];
      for await (const entry of iter) {
        if (kind && entry.value.kind !== kind) continue;
        if (status && entry.value.status !== status) continue;
        items.push(entry.value);
        if (items.length === PAGE_SIZE) break;
      }
      return json({ items, cursor: items.length === PAGE_SIZE ? iter.cursor : null });
    }

    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, 405, { Allow: admin ? "GET, POST" : "POST" });
    }
    if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json({ error: "send submissions as JSON" }, 415);
    }
    const body = await readBody(req);
    if (!body) return json({ error: "couldn't read that submission" }, 400);

    if (admin) {
      const id = typeof body.id === "string" ? body.id : "";
      const status = typeof body.status === "string" ? body.status : "";
      if (!/^\d{13}-/.test(id) || !UUID.test(id.slice(14)) || !STATUSES.includes(status)) {
        return json({ error: "invalid submission or status" }, 400);
      }
      const kv = await getKv();
      const entry = await kv.get<FeedbackRecord>(["hub_feedback", id]);
      if (!entry.value) return json({ error: "that submission no longer exists" }, 404);
      const updated = { ...entry.value, status: status as FeedbackStatus, updatedAt: Date.now() };
      const result = await kv.atomic().check(entry).set(entry.key, updated).commit();
      if (!result.ok) return json({ error: "this submission changed — refresh and try again" }, 409);
      return json({ item: updated });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const kind = typeof body.kind === "string" ? body.kind : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const details = typeof body.details === "string" ? body.details.trim() : "";
    const game = kind === "bug" && typeof body.game === "string" ? body.game : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    if (!name || name.length > 60) {
      return json({ error: "enter your name (up to 60 characters)" }, 400);
    }
    if (!KINDS.includes(kind)) return json({ error: "choose a suggestion or report type" }, 400);
    if (title.length < 3 || title.length > 100) {
      return json({ error: "use a short summary between 3 and 100 characters" }, 400);
    }
    if ((body.details !== undefined && typeof body.details !== "string") || details.length > 2000) {
      return json({ error: "keep the details under 2,000 characters" }, 400);
    }
    if (kind === "bug" && !Object.hasOwn(catalogue, game)) {
      return json({ error: "choose the game or app that isn't working" }, 400);
    }
    if (kind === "bug" && details.length < 10) {
      return json({ error: "describe what goes wrong in at least 10 characters" }, 400);
    }
    if (!UUID.test(requestId)) return json({ error: "reload the page and try again" }, 400);

    const kv = await getKv();
    const marker = await kv.get<string>(["hub_feedback_requests", identity.code, requestId]);
    if (marker.value) return json({ ok: true, id: marker.value });
    const now = Date.now();
    const id = `${now}-${crypto.randomUUID()}`;
    const record: FeedbackRecord = {
      id, kind: kind as FeedbackKind, title, details, game,
      gameName: game ? catalogue[game] : "",
      name, label: identity.label, code: identity.code,
      status: "new", createdAt: now, updatedAt: now,
    };
    const result = await kv.atomic().check(marker)
      .set(["hub_feedback", id], record)
      .set(marker.key, id)
      .commit();
    if (!result.ok) {
      const saved = await kv.get<string>(marker.key);
      if (saved.value) return json({ ok: true, id: saved.value });
      return json({ error: "couldn't save just yet — please try again" }, 503);
    }
    return json({ ok: true, id }, 201);
  } catch (error) {
    console.error("Feedback request failed:", error);
    return json({ error: "couldn't reach the inbox — please try again" }, 503);
  }
}
