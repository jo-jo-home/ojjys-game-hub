// Hub sign-in accounts. Passwords are salted PBKDF2 hashes; the bootstrap
// owner's password comes exclusively from the deployment environment.
export const OWNER_USERNAME = "ojjy";
const ITERATIONS = 600_000;
const encoder = new TextEncoder();
type Credential = { salt: string; hash: string; iterations: number };
type Account = {
  id: string; username: string; label: string; credential: Credential;
  version: string; disabled: boolean; createdAt: number; lastLogin: number;
};
export type AccountIdentity = {
  code: string; label: string; role: string; account?: string; accountVersion?: string;
};

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
function randomHex(size: number): string {
  return hex(crypto.getRandomValues(new Uint8Array(size)));
}
function bytes(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value.match(/.{2}/g)!.map(pair => parseInt(pair, 16)));
}
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
export function usernameKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(name) ? name.toLowerCase() : null;
}
function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}
async function hashPassword(password: string, salt = randomHex(16), iterations = ITERATIONS): Promise<Credential> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: bytes(salt), iterations,
  }, key, 256);
  return { salt, hash: hex(new Uint8Array(hash)), iterations };
}
async function verify(password: string, credential: Credential): Promise<boolean> {
  if (typeof credential.salt !== "string" || credential.salt.length % 2 !== 0 ||
      !/^[a-f0-9]{32,64}$/.test(credential.salt) || !/^[a-f0-9]{64}$/.test(credential.hash) ||
      !Number.isInteger(credential.iterations) || credential.iterations < 100_000 || credential.iterations > 2_000_000) return false;
  const actual = await hashPassword(password, credential.salt, credential.iterations);
  return equal(actual.hash, credential.hash);
}
function summary(account: Account) {
  return {
    id: account.id, username: account.username, label: account.label,
    disabled: account.disabled, createdAt: account.createdAt, lastLogin: account.lastLogin,
  };
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function createAccountStore(getKv: () => Promise<Deno.Kv>, ownerPassword: string) {
  // Stable across isolates, so changing ADMIN_PASSWORD also ends old owner
  // sessions. This slow digest, not the environment secret, is the version.
  const ownerCredential = ownerPassword
    ? hashPassword(ownerPassword, hex(encoder.encode("ojjys-game-hub:owner:ojjy")))
    : Promise.resolve(null);
  const dummy: Credential = { salt: randomHex(16), hash: "0".repeat(64), iterations: ITERATIONS };

  async function authenticate(username: unknown, password: unknown): Promise<AccountIdentity | null> {
    const key = usernameKey(username);
    if (!key || typeof password !== "string" || !password || password.length > 128) return null;
    if (key === OWNER_USERNAME) {
      const credential = await ownerCredential;
      if (!credential || !await verify(password, credential)) return null;
      return { code: "owner", label: OWNER_USERNAME, role: "admin", account: "@owner", accountVersion: credential.hash };
    }
    const kv = await getKv();
    const entry = await kv.get<Account>(["hub_accounts", key]);
    const correct = await verify(password, entry.value?.credential || dummy);
    if (!correct || !entry.value || entry.value.disabled) return null;
    // A password reset or disable during hashing must not issue a fresh login.
    const latest = await kv.get<Account>(entry.key);
    if (!latest.value || latest.value.disabled || latest.value.version !== entry.value.version) return null;
    const record = latest.value;
    await kv.atomic().check(latest).set(latest.key, { ...record, lastLogin: Date.now() }).commit();
    return { code: record.id, label: record.label, role: "user", account: key, accountVersion: record.version };
  }

  async function sessionValid(info: AccountIdentity, token?: string): Promise<boolean> {
    const kv = await getKv();
    if (!info.account) {
      if (ownerPassword && info.code === "owner") return false;
      return !token || !!(await kv.get(["hub_sessions", token])).value;
    }
    if (info.account === "@owner") {
      const credential = await ownerCredential;
      if (!credential || info.code !== "owner" || info.role !== "admin" ||
          !equal(info.accountVersion || "", credential.hash)) return false;
      return !token || !!(await kv.get(["hub_sessions", token])).value;
    }
    let record: Account | null;
    if (token) {
      const [session, account] = await kv.getMany<[AccountIdentity, Account]>([
        ["hub_sessions", token], ["hub_accounts", info.account],
      ]);
      if (!session.value || session.value.code !== info.code || session.value.accountVersion !== info.accountVersion) return false;
      record = account.value;
    } else record = (await kv.get<Account>(["hub_accounts", info.account])).value;
    if (!record || record.disabled || record.id !== info.code || record.version !== info.accountVersion) return false;
    info.label = record.label;
    info.role = "user";
    return true;
  }

  async function list() {
    const accounts = [];
    for await (const entry of (await getKv()).list<Account>({ prefix: ["hub_accounts"] })) {
      accounts.push(summary(entry.value));
    }
    return accounts.sort((a, b) => a.username.localeCompare(b.username));
  }

  async function takeLoginAttempt(req: Request): Promise<boolean> {
    const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(ip));
    const key = ["hub_login_attempts", hex(new Uint8Array(digest)), Math.floor(Date.now() / 60_000)];
    const kv = await getKv();
    for (let tries = 0; tries < 5; tries++) {
      const entry = await kv.get<number>(key);
      if ((entry.value || 0) >= 20) return false;
      if ((await kv.atomic().check(entry).set(key, (entry.value || 0) + 1, { expireIn: 120_000 }).commit()).ok) return true;
    }
    return false;
  }

  async function manage(req: Request, identity: AccountIdentity | null, invalidate: (id: string) => void): Promise<Response> {
    if (identity?.role !== "admin") return json({ error: "not found" }, 404);
    if (req.method === "GET") return json({ accounts: await list(), owner: { username: OWNER_USERNAME, configured: !!ownerPassword } });
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json({ error: "send account changes as JSON" }, 415);
    }
    let body;
    try { body = await req.json(); } catch { return json({ error: "invalid request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid request" }, 400);
    const key = usernameKey(body.username);
    if (!key) return json({ error: "username: 3–32 letters, numbers, dots, dashes or underscores; start with a letter or number" }, 400);
    if (key === OWNER_USERNAME) return json({ error: "ojjy is the environment-managed owner account" }, 400);
    const action = body.action || "create";
    if (!["create", "update", "disable", "enable", "delete"].includes(action)) return json({ error: "unknown account action" }, 400);
    if (body.label !== undefined && (typeof body.label !== "string" || body.label.trim().length > 40)) {
      return json({ error: "display name must be at most 40 characters" }, 400);
    }
    const changePassword = action === "create" || (action === "update" && body.password !== undefined && body.password !== "");
    if (changePassword && !validPassword(body.password)) return json({ error: "password must be 8–128 characters" }, 400);
    const kv = await getKv();
    const entry = await kv.get<Account>(["hub_accounts", key]);
    if (action === "create" && entry.value) return json({ error: "that username is already taken" }, 409);
    if (action !== "create" && !entry.value) return json({ error: "account not found" }, 404);
    const now = Date.now();
    let record: Account;
    if (action === "create") {
      record = {
        id: randomHex(32), username: body.username.trim(), label: body.label?.trim() || body.username.trim(),
        credential: await hashPassword(body.password), version: crypto.randomUUID(),
        disabled: false, createdAt: now, lastLogin: 0,
      };
    } else {
      record = { ...entry.value! };
      if (action === "update") {
        if (body.label !== undefined) record.label = body.label.trim() || record.username;
        if (changePassword) { record.credential = await hashPassword(body.password); record.version = crypto.randomUUID(); }
      } else if (action === "enable" || action === "disable") {
        record.disabled = action === "disable";
        record.version = crypto.randomUUID();
      }
    }
    const transaction = kv.atomic().check(entry);
    if (action === "delete") transaction.delete(entry.key);
    else transaction.set(entry.key, record);
    if (!(await transaction.commit()).ok) return json({ error: "account changed — refresh and try again" }, 409);
    const endsSessions = action === "delete" || action === "disable" || action === "enable" || changePassword;
    if (endsSessions && action !== "create") {
      invalidate(record.id);
      // Version checks already revoke across isolates; remove stored sessions
      // too so a disabled/deleted account no longer appears online.
      try {
        for await (const session of kv.list<{ code: string }>({ prefix: ["hub_sessions"] })) {
          if (session.value.code === record.id) await kv.delete(session.key);
        }
      } catch { /* version checks enforce revocation even if cleanup fails */ }
    }
    return json({ ok: true, account: action === "delete" ? null : summary(record) }, action === "create" ? 201 : 200);
  }

  return { authenticate, sessionValid, list, takeLoginAttempt, manage, ownerConfigured: !!ownerPassword };
}
