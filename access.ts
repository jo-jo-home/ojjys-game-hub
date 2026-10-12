// Legacy credentials and opaque login sessions, managed without exposing the
// bearer tokens themselves. Permanent-removal markers prevent reactivation.
type Identity = { code: string; label: string; role: string; account?: string; accountVersion?: string };
type Session = Identity & { at: number; seen?: number; device?: string };
type Code = { label: string; role: string; revokedAt: number | null };
type LegacyFlags = { off?: boolean; adminDeleted?: boolean };
type SharedFlags = { off?: boolean; deleted?: boolean };
const SHA = /^[a-f0-9]{64}$/;
async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export function createAccessStore(getKv: () => Promise<Deno.Kv>, ownerConfigured: boolean, adminCodeConfigured: boolean) {
  async function policy() {
    const [legacy, shared] = await (await getKv()).getMany<[LegacyFlags, SharedFlags]>([
      ["hub_settings", "legacy_access"], ["hub_settings", "shared"],
    ]);
    return {
      legacyEnabled: !legacy.value?.off,
      sharedEnabled: !legacy.value?.off && !shared.value?.off && !shared.value?.deleted,
      sharedDeleted: !!shared.value?.deleted,
      adminCodeConfigured,
      adminCodeEnabled: !ownerConfigured && adminCodeConfigured && !legacy.value?.off && !legacy.value?.adminDeleted,
      adminCodeDeleted: !!legacy.value?.adminDeleted,
      ownerConfigured,
    };
  }

  async function sessionValid(info: Identity, token: string): Promise<boolean> {
    const kv = await getKv();
    const [session, legacy, shared, code] = await kv.getMany<[Session, LegacyFlags, SharedFlags, Code]>([
      ["hub_sessions", token], ["hub_settings", "legacy_access"], ["hub_settings", "shared"],
      ["hub_codes", info.code],
    ]);
    if (!session.value || session.value.account || (session.value.code || "shared") !== info.code || legacy.value?.off) return false;
    if (info.code === "owner") return !ownerConfigured && adminCodeConfigured && !legacy.value?.adminDeleted;
    if (info.code === "shared") return !shared.value?.off && !shared.value?.deleted;
    if (!SHA.test(info.code) || !code.value || code.value.revokedAt) return false;
    info.label = code.value.label;
    info.role = code.value.role;
    return true;
  }

  async function sessions(currentToken: string) {
    const rows = [];
    for await (const entry of (await getKv()).list<Session>({ prefix: ["hub_sessions"] })) {
      const token = String(entry.key[1]);
      rows.push({ id: await digest(token), label: entry.value.label || "shared password",
        username: entry.value.account === "@owner" ? "ojjy" : entry.value.account || "",
        code: entry.value.code || "shared", role: entry.value.role || "user",
        createdAt: entry.value.at, seen: entry.value.seen || entry.value.at,
        device: entry.value.device || "", current: token === currentToken });
    }
    return rows.sort((a, b) => b.seen - a.seen);
  }

  async function revoke(predicate: (session: Session, token: string) => boolean, invalidate: (token: string) => void) {
    const kv = await getKv();
    let count = 0;
    for await (const entry of kv.list<Session>({ prefix: ["hub_sessions"] })) {
      const token = String(entry.key[1]);
      if (predicate(entry.value, token)) { await kv.delete(entry.key); invalidate(token); count++; }
    }
    return count;
  }

  async function removeCode(hash: string, invalidate: (token: string) => void) {
    const kv = await getKv();
    const code = await kv.get<Code>(["hub_codes", hash]);
    if (!code.value) return false;
    if (!(await kv.atomic().check(code).delete(code.key).commit()).ok) return false;
    await revoke(s => !s.account && s.code === hash, invalidate);
    for await (const device of kv.list({ prefix: ["hub_devices", hash] })) await kv.delete(device.key);
    await kv.delete(["hub_now", hash]);
    return true;
  }

  async function manage(req: Request, identity: Identity | null, currentToken: string, invalidate: (token: string) => void) {
    if (identity?.role !== "admin") return json({ error: "not found" }, 404);
    if (req.method === "GET") return json({ policy: await policy(), sessions: await sessions(currentToken) });
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "send changes as JSON" }, 415);
    let body;
    try { body = await req.json(); } catch { return json({ error: "invalid request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid request" }, 400);
    const kv = await getKv();
    const flagsEntry = await kv.get<LegacyFlags>(["hub_settings", "legacy_access"]);
    const flags = flagsEntry.value || {};
    const conflict = () => json({ error: "access settings changed — refresh and try again" }, 409);
    const requireOwner = () => identity.code === "owner" && identity.account === "@owner" && ownerConfigured;
    switch (body.action) {
      case "delete-code":
        if (!SHA.test(String(body.hash || ""))) return json({ error: "invalid code hash" }, 400);
        if (!identity.account && identity.code === body.hash) return json({ error: "sign in with your owner account before removing the code you are using" }, 400);
        if (!await removeCode(body.hash, invalidate)) return json({ error: "code not found or changed — refresh and try again" }, 404);
        break;
      case "delete-codes":
        if (!requireOwner()) return json({ error: "sign in as ojjy with ADMIN_PASSWORD before removing every access code" }, 400);
        for await (const code of kv.list({ prefix: ["hub_codes"] })) {
          if (!await removeCode(String(code.key[1]), invalidate)) return conflict();
        }
        break;
      case "delete-shared":
        await kv.set(["hub_settings", "shared"], { off: true, deleted: true });
        await revoke(s => !s.account && (s.code === "shared" || !s.code), invalidate);
        for await (const device of kv.list({ prefix: ["hub_devices", "shared"] })) await kv.delete(device.key);
        break;
      case "shared-off":
        {
          const entry = await kv.get<SharedFlags>(["hub_settings", "shared"]);
          if (!(await kv.atomic().check(entry).set(entry.key, { ...entry.value, off: true }).commit()).ok) return conflict();
        }
        await revoke(s => !s.account && (s.code === "shared" || !s.code), invalidate);
        break;
      case "shared-on":
        {
          const entry = await kv.get<SharedFlags>(["hub_settings", "shared"]);
          if (entry.value?.deleted) return json({ error: "shared-password access has been permanently removed" }, 409);
          if (!(await kv.atomic().check(entry).set(entry.key, { off: false }).commit()).ok) return conflict();
        }
        break;
      case "delete-admin-code":
        if (!requireOwner()) return json({ error: "configure ADMIN_PASSWORD and sign in as ojjy first" }, 400);
        if (!(await kv.atomic().check(flagsEntry).set(flagsEntry.key, { ...flags, adminDeleted: true }).commit()).ok) return conflict();
        await revoke(s => !s.account && s.code === "owner", invalidate);
        break;
      case "legacy-off":
        if (!requireOwner()) return json({ error: "configure ADMIN_PASSWORD and sign in as ojjy first" }, 400);
        if (!(await kv.atomic().check(flagsEntry).set(flagsEntry.key, { ...flags, off: true }).commit()).ok) return conflict();
        await revoke(s => !s.account, invalidate);
        break;
      case "legacy-on":
        if (!(await kv.atomic().check(flagsEntry).set(flagsEntry.key, { ...flags, off: false }).commit()).ok) return conflict();
        break;
      case "revoke-session":
        if (!SHA.test(String(body.id || ""))) return json({ error: "invalid session id" }, 400);
        if (body.id === await digest(currentToken)) return json({ error: "use sign out to end your current session" }, 400);
        for await (const entry of kv.list<Session>({ prefix: ["hub_sessions"] })) {
          const token = String(entry.key[1]);
          if (await digest(token) === body.id) { await kv.delete(entry.key); invalidate(token); }
        }
        break;
      case "revoke-sessions":
        await revoke((_s, token) => token !== currentToken, invalidate);
        break;
      case "remove-all":
        if (!requireOwner()) return json({ error: "configure ADMIN_PASSWORD and sign in as ojjy first" }, 400);
        // Block legacy authentication first, then erase stored credentials.
        await kv.atomic().set(["hub_settings", "legacy_access"], { off: true, adminDeleted: true })
          .set(["hub_settings", "shared"], { off: true, deleted: true }).commit();
        for await (const account of kv.list({ prefix: ["hub_accounts"] })) await kv.delete(account.key);
        for await (const code of kv.list({ prefix: ["hub_codes"] })) await kv.delete(code.key);
        await revoke((_s, token) => token !== currentToken, invalidate);
        for await (const device of kv.list({ prefix: ["hub_devices"] })) {
          if (device.key[1] !== "owner") await kv.delete(device.key);
        }
        break;
      default: return json({ error: "unknown access action" }, 400);
    }
    return json({ ok: true });
  }

  return { policy, sessionValid, sessions, manage };
}
