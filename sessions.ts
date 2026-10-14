// Sessions v2: cryptographically self-validating login tokens.
//
// Why: the hub used to store the whole session in KV and re-read it on every
// request. Any database hiccup — a lost row, a wiped database, a failed
// read — read as "you are signed out", which is exactly the "it randomly
// logs me out" bug. Worse, when the database loses data, every account and
// every session dies together.
//
// A v2 token carries its own identity and expiry, signed with HMAC-SHA256.
// Verifying it needs no database at all. The database is consulted only as
// a best-effort policy check — explicit revocations, bans, suspensions and
// password changes — and if that check cannot be answered (the read throws,
// or the rows are missing because the database was wiped), the signature
// already proved the person signed in, so they stay signed in.
//
//   token  = base64url(json payload) + "." + hex(hmac)
//   payload = { v:2, j: random id, c: code, r: role, l: label,
//               a?: account, av?: account version, i: issued, e: expires }
//
// The signing key is derived from deployment environment secrets so it
// survives database resets; only when no env secret exists at all does it
// fall back to a random key stored in KV (recreated if lost — that
// deployment has no owner accounts to protect anyway).
//
// Revocation is by tombstone rows, written whenever someone is signed out
// on purpose (self sign-out, an admin ending a session, a ban, a password
// change, a device block). Tombstones outlive the tokens they kill:
//   ["hub_revoked", token]        a single token, by full string
//   ["hub_revoked", "code:"+code] every token for one identity

const encoder = new TextEncoder();

export type SessionIdentity = {
  code: string;
  label: string;
  role: string;
  account?: string;
  accountVersion?: string;
};

export const TOKEN_LEGACY = /^[a-f0-9]{64}$/;
export const TOKEN_V2 = /^[A-Za-z0-9_-]{10,}\.[a-f0-9]{64}$/;
/** Anything a request may present as a session token, old or new. */
export function isToken(value: string): boolean {
  return TOKEN_LEGACY.test(value) || TOKEN_V2.test(value);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Constant-time string compare. */
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}

const SHA = /^[a-f0-9]{64}$/;

export function createSessionStore(
  getKv: () => Promise<Deno.Kv>,
  /** Hex signing key, stable across restarts and database resets. */
  key: string,
  clock: () => number = () => Date.now(),
  /** Hard maximum token lifetime (browser cookie cap is ~400 days). */
  ttlMs = 397 * 86_400_000,
  /** Mint a fresh token once this much of the hard life has passed. */
  rotateMs = 30 * 86_400_000,
) {
  const rawKey = new Uint8Array(key.length / 2);
  for (let i = 0; i < rawKey.length; i++) {
    rawKey[i] = parseInt(key.slice(i * 2, i * 2 + 2), 16);
  }

  async function sign(data: string): Promise<string> {
    const cryptoKey = await crypto.subtle.importKey(
      "raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
    return hex(new Uint8Array(mac));
  }

  function randomHex(size: number): string {
    return hex(crypto.getRandomValues(new Uint8Array(size)));
  }

  // ---- minting -----------------------------------------------------------

  async function mint(info: SessionIdentity): Promise<{ token: string; expiresAt: number }> {
    const now = clock();
    const payload = {
      v: 2,
      j: randomHex(16),
      c: info.code,
      r: info.role,
      l: (info.label || "").slice(0, 80),
      ...(info.account ? { a: info.account } : {}),
      ...(info.accountVersion ? { av: info.accountVersion } : {}),
      i: now,
      e: now + ttlMs,
    };
    const body = b64url(encoder.encode(JSON.stringify(payload)));
    return { token: body + "." + await sign(body), expiresAt: payload.e };
  }

  // ---- verification ------------------------------------------------------

  type Verified = {
    info: SessionIdentity;
    issuedAt: number;
    expiresAt: number;
    /** The caller should hand out a fresh token (sliding expiry). */
    rotate: boolean;
  };

  // The best-effort policy check. `null` means "certainly revoked".
  // Errors are swallowed on purpose: an unreadable database must not
  // become a sign-out, and a wiped database (rows gone) must not either —
  // only rows that are actually PRESENT may end a session.
  async function policy(info: SessionIdentity, token: string, now: number): Promise<boolean> {
    try {
      const kv = await getKv();
      const reads: Deno.KvKey[] = [
        ["hub_revoked", token],
        ["hub_revoked", "code:" + info.code],
      ];
      if (info.account === "@owner") {
        // The environment-managed owner is protected by the signing key
        // itself (changing ADMIN_PASSWORD invalidates every owner token) —
        // only explicit revocations apply.
      } else if (info.account) {
        reads.push(["hub_accounts", info.account]);
      } else {
        // A legacy identity: a minted access code, the shared password,
        // or the bootstrap owner code. Its settings row decides.
        reads.push(["hub_settings", "legacy_access"]);
        if (info.code === "shared") reads.push(["hub_settings", "shared"]);
        else if (SHA.test(info.code)) reads.push(["hub_codes", info.code]);
      }
      const entries = await kv.getMany(reads);

      let n = 0;
      const revokedToken = entries[n++].value;
      const revokedCode = entries[n++].value;
      if (revokedToken || revokedCode) return false;

      if (info.account === "@owner") return true;

      if (info.account) {
        const record = entries[n++]?.value as {
          id?: string; disabled?: boolean; suspendedUntil?: number;
          version?: string; label?: string; role?: string;
        } | null;
        // Row missing: assume data loss, not deletion — the token's
        // signature is the proof of sign-in. Explicit account removal
        // writes a revocation tombstone, which the checks above catch.
        if (!record) return true;
        if (record.disabled || (record.suspendedUntil || 0) > now) return false;
        if (record.id !== info.code || record.version !== info.accountVersion) return false;
        // Keep what the person changed visible (their display name).
        if (typeof record.label === "string" && record.label) info.label = record.label;
        return true;
      }

      const legacy = entries[n++]?.value as { off?: boolean } | null;
      if (legacy?.off) return false;           // owner turned legacy access off
      if (info.code === "shared") {
        const shared = entries[n++]?.value as { off?: boolean; deleted?: boolean } | null;
        if (shared?.off || shared?.deleted) return false;
        return true;
      }
      if (info.code === "owner") {
        // The bootstrap ADMIN_CODE identity. Access is decided entirely by
        // the settings rows above; nothing else to read.
        return true;
      }
      if (SHA.test(info.code)) {
        const code = entries[n++]?.value as { revokedAt?: number | null } | null;
        // A missing code row is a wiped database, not a revocation (an
        // owner revoking a code writes a tombstone and deletes sessions).
        if (code && code.revokedAt) return false;
        return true;
      }
      return false; // unknown identity shape — do not trust it
    } catch {
      return true; // database unreachable: the signature already proved sign-in
    }
  }

  async function verify(token: string): Promise<Verified | null> {
    if (!TOKEN_V2.test(token)) return null;
    const dot = token.lastIndexOf(".");
    if (dot < 0) return null;
    const body = token.slice(0, dot), mac = token.slice(dot + 1);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    } catch { return null; }
    if (
      payload.v !== 2 || typeof payload.j !== "string" ||
      typeof payload.c !== "string" || typeof payload.r !== "string" ||
      typeof payload.l !== "string" || typeof payload.i !== "number" ||
      typeof payload.e !== "number"
    ) return null;
    if (!equal(mac, await sign(body))) return null;
    const now = clock();
    if (payload.e <= now) return null;
    const info: SessionIdentity = {
      code: payload.c,
      label: payload.l,
      role: payload.r,
      ...(typeof payload.a === "string" ? { account: payload.a } : {}),
      ...(typeof payload.av === "string" ? { accountVersion: payload.av } : {}),
    };
    if (!await policy(info, token, now)) return null;
    return {
      info,
      issuedAt: payload.i,
      expiresAt: payload.e,
      rotate: now - payload.i >= rotateMs,
    };
  }

  // ---- revocation ---------------------------------------------------------

  // Best-effort by design: a failed tombstone write must not fail the
  // action that triggered it. The row deletion next to it still happens.
  async function revokeToken(token: string): Promise<void> {
    try {
      if (isToken(token)) {
        await (await getKv()).set(["hub_revoked", token], { at: clock() }, { expireIn: ttlMs });
      }
    } catch { /* the action still stands */ }
  }

  async function revokeCode(code: string): Promise<void> {
    try {
      await (await getKv()).set(["hub_revoked", "code:" + code], { at: clock() }, { expireIn: ttlMs });
    } catch { /* the action still stands */ }
  }

  return { mint, verify, revokeToken, revokeCode };
}

/**
 * Derives the stable signing key. Priority:
 *   1. SESSION_SECRET env — explicit, for people who rotate secrets.
 *   2. ADMIN_PASSWORD and/or ADMIN_CODE env — the deployment's own
 *      secrets; they survive database resets. Changing them signs
 *      everybody out once, which is the correct outcome.
 *   3. A random key stored in KV — only for deployments with no env
 *      secret at all (no owner account can exist there anyway).
 */
export async function deriveSessionKey(
  envMaterial: string,
  kv: Deno.Kv,
): Promise<string> {
  const material = envMaterial.trim();
  if (material) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("ojjys-hub:sessions:v2:" + material),
    );
    return hex(new Uint8Array(digest));
  }
  const entry = await kv.get<string>(["hub_meta", "session_key"]);
  if (entry.value) return entry.value;
  const fresh = hex(crypto.getRandomValues(new Uint8Array(32)));
  // create-if-missing: the check on a null versionstamp does that
  const commit = await kv.atomic().check(entry).set(entry.key, fresh).commit();
  return commit.ok ? fresh : (await kv.get<string>(entry.key)).value || fresh;
}
