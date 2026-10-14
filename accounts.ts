// Hub sign-in accounts. Passwords are salted PBKDF2 hashes; the bootstrap
// owner's password comes exclusively from the deployment environment.
export const OWNER_USERNAME = "ojjy";
const ITERATIONS = 600_000;
const encoder = new TextEncoder();
type Credential = { salt: string; hash: string; iterations: number };
type ProfileFields = { label: string; bio?: string; favorites?: string[]; avatar?: string; createdAt: number };
type Account = ProfileFields & {
  id: string; username: string; label: string; credential: Credential;
  version: string; disabled: boolean; createdAt: number; lastLogin: number;
  suspendedUntil?: number; restrictionReason?: string;
};
export const PROFILE_AVATARS = ["🎮", "🛹", "🕹️", "🚀", "🐱", "⚡", "👑", "🌈"];
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
  return typeof value === "string" && value.length > 0 && value.length <= 128;
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
function blocked(account: Account, now: number): boolean {
  return account.disabled || (account.suspendedUntil || 0) > now;
}
function summary(account: Account, now = Date.now()) {
  return {
    id: account.id, username: account.username, label: account.label,
    disabled: account.disabled, createdAt: account.createdAt, lastLogin: account.lastLogin,
    suspendedUntil: account.suspendedUntil || 0, restrictionReason: account.restrictionReason || "",
    status: account.disabled ? "banned" : (account.suspendedUntil || 0) > now ? "suspended" : "active",
  };
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export type RevocationHooks = {
  /** Kill every v2 session for one identity (account id / code). */
  revokeCode?: (code: string) => Promise<void>;
  /** Kill one token by its full string. */
  revokeToken?: (token: string) => Promise<void>;
};

export function createAccountStore(
  getKv: () => Promise<Deno.Kv>,
  ownerPassword: string,
  clock: () => number = () => Date.now(),
  hooks: RevocationHooks = {},
) {
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
    if (!correct || !entry.value || blocked(entry.value, clock())) return null;
    // A password reset or disable during hashing must not issue a fresh login.
    const latest = await kv.get<Account>(entry.key);
    if (!latest.value || blocked(latest.value, clock()) || latest.value.version !== entry.value.version) return null;
    const record = latest.value;
    await kv.atomic().check(latest).set(latest.key, { ...record, lastLogin: clock() }).commit();
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
      const profile = (await kv.get<ProfileFields>(["hub_owner_profile"])).value;
      info.label = profile?.label || OWNER_USERNAME;
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
    if (!record || blocked(record, clock()) || record.id !== info.code || record.version !== info.accountVersion) return false;
    info.label = record.label;
    info.role = "user";
    return true;
  }

  async function list() {
    const accounts = [];
    for await (const entry of (await getKv()).list<Account>({ prefix: ["hub_accounts"] })) {
      accounts.push(summary(entry.value, clock()));
    }
    return accounts.sort((a, b) => a.username.localeCompare(b.username));
  }

  function publicProfile(fields: ProfileFields, username: string, code: string) {
    // code is for the server's existing playtime lookup; never send it publicly.
    return { code, username, label: fields.label, bio: fields.bio || "",
      avatar: PROFILE_AVATARS.includes(fields.avatar || "") ? fields.avatar : PROFILE_AVATARS[0],
      favorites: fields.favorites || [], createdAt: fields.createdAt };
  }

  async function profile(username: unknown) {
    const key = usernameKey(username);
    if (!key) return null;
    const kv = await getKv();
    if (key === OWNER_USERNAME) {
      if (!ownerPassword) return null;
      const fields = (await kv.get<ProfileFields>(["hub_owner_profile"])).value;
      return publicProfile(fields || { label: OWNER_USERNAME, createdAt: 0 }, OWNER_USERNAME, "owner");
    }
    const record = (await kv.get<Account>(["hub_accounts", key])).value;
    return record && !record.disabled ? publicProfile(record, record.username, record.id) : null;
  }

  async function people(query = "", cursor?: string) {
    const kv = await getKv();
    const matches = (p: { username: string; label: string }) =>
      (p.username + " " + p.label).toLowerCase().includes(query.toLowerCase());
    const entries = [];
    if (!cursor) {
      const owner = await profile(OWNER_USERNAME);
      if (owner && matches(owner)) entries.push(owner);
    }
    const rows = kv.list<Account>({ prefix: ["hub_accounts"] }, { limit: 50, ...(cursor ? { cursor } : {}) });
    let scanned = 0;
    for await (const row of rows) {
      scanned++;
      if (row.value.disabled) continue;
      const p = publicProfile(row.value, row.value.username, row.value.id);
      if (matches(p)) entries.push(p);
    }
    return { people: entries.map(({ code: _code, ...p }) => p), cursor: scanned === 50 ? rows.cursor : null };
  }

  async function self(req: Request, identity: AccountIdentity | null, currentToken: string,
    hasGame: (id: string) => boolean, invalidate: (id: string) => void): Promise<Response> {
    if (!identity) return json({ error: "sign in to manage your account" }, 401);
    if (!identity.account) return json({ error: "sign in with a username and password to use account profiles", legacy: true }, 403);
    if (!await sessionValid(identity, currentToken)) return json({ error: "sign in again" }, 401);
    const owner = identity.account === "@owner";
    const kv = await getKv();
    const storageKey: Deno.KvKey = owner ? ["hub_owner_profile"] : ["hub_accounts", identity.account];
    const entry = await kv.get<Account>(storageKey);
    if (!owner && (!entry.value || entry.value.id !== identity.code || entry.value.version !== identity.accountVersion || blocked(entry.value, clock()))) return json({ error: "sign in again" }, 401);
    const record = entry.value || { label: OWNER_USERNAME, username: OWNER_USERNAME, createdAt: clock() } as Account;
    const ownProfile = () => {
      const { code: _code, ...p } = publicProfile(record, owner ? OWNER_USERNAME : record.username, identity.code);
      return p;
    };
    if (req.method === "GET") return json({ profile: ownProfile(), owner });
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "send changes as JSON" }, 415);
    let body;
    try {
      const text = await req.text();
      if (text.length > 16_384) return json({ error: "request too large" }, 413);
      body = JSON.parse(text);
    } catch { return json({ error: "invalid request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid request" }, 400);
    const action = body.action;
    if (action === "profile") {
      if (body.label !== undefined && (typeof body.label !== "string" || !body.label.trim() || body.label.trim().length > 40)) return json({ error: "display name: 1–40 characters" }, 400);
      if (body.bio !== undefined && (typeof body.bio !== "string" || body.bio.length > 1000)) return json({ error: "description: up to 1,000 characters" }, 400);
      if (body.avatar !== undefined && !PROFILE_AVATARS.includes(body.avatar)) return json({ error: "choose an available avatar" }, 400);
      if (body.favorites !== undefined && (!Array.isArray(body.favorites) || body.favorites.length > 256 || body.favorites.some((g: unknown) => typeof g !== "string" || !hasGame(g)))) return json({ error: "choose favorites from the game catalog" }, 400);
      if (body.label !== undefined) record.label = body.label.trim();
      if (body.bio !== undefined) record.bio = body.bio.trim();
      if (body.avatar !== undefined) record.avatar = body.avatar;
      if (body.favorites !== undefined) record.favorites = [...new Set<string>(body.favorites)];
    } else if (action === "favorite") {
      if (typeof body.game !== "string" || !hasGame(body.game) || typeof body.favorite !== "boolean") return json({ error: "invalid favorite" }, 400);
      const favorites = new Set(record.favorites || []);
      if (body.favorite) favorites.add(body.game); else favorites.delete(body.game);
      record.favorites = [...favorites];
    } else if (action === "sign-out-others") {
      for await (const session of kv.list<AccountIdentity>({ prefix: ["hub_sessions"] })) {
        if (session.value.account === identity.account && session.value.code === identity.code && session.key[1] !== currentToken) {
          const other = String(session.key[1]);
          await hooks.revokeToken?.(other);
          await kv.delete(session.key);
        }
      }
      return json({ ok: true });
    } else if (action === "password" || action === "username") {
      if (owner) return json({ error: "the owner username and password are managed through the deployment settings" }, 400);
      if (typeof body.currentPassword !== "string" || !await verify(body.currentPassword, record.credential)) return json({ error: "current password is incorrect" }, 400);
      if (action === "password") {
        if (!validPassword(body.password)) return json({ error: "enter a non-empty password (up to 128 characters)" }, 400);
        record.credential = await hashPassword(body.password);
      } else {
        const newKey = usernameKey(body.username);
        if (!newKey || newKey === OWNER_USERNAME) return json({ error: "choose an available username: 3–32 letters, numbers, dots, dashes or underscores" }, 400);
        const destination = await kv.get<Account>(["hub_accounts", newKey]);
        if (newKey !== identity.account && destination.value) return json({ error: "that username is already taken" }, 409);
        record.username = body.username.trim();
        record.version = crypto.randomUUID();
        const transaction = kv.atomic().check(entry);
        if (newKey !== identity.account) transaction.check(destination).delete(entry.key);
        if (!(await transaction.set(destination.key, record).commit()).ok) return json({ error: "account changed — refresh and try again" }, 409);
      }
      if (action === "password") {
        record.version = crypto.randomUUID();
        if (!(await kv.atomic().check(entry).set(entry.key, record).commit()).ok) return json({ error: "account changed — refresh and try again" }, 409);
      }
      invalidate(identity.code);
      // Changing the password or username ends every session of this
      // account, including this one — the tombstone makes that true for
      // v2 tokens as well as for the bookkeeping rows.
      await hooks.revokeCode?.(identity.code);
      for await (const session of kv.list<AccountIdentity>({ prefix: ["hub_sessions"] })) {
        if (session.value.code === identity.code) await kv.delete(session.key);
      }
      return json({ ok: true, reauthenticate: true });
    } else return json({ error: "unknown account action" }, 400);
    if (!(await kv.atomic().check(entry).set(entry.key, record).commit()).ok) return json({ error: "profile changed — try again" }, 409);
    invalidate(identity.code);
    return json({ ok: true, profile: ownProfile(), owner });
  }

  async function takeLoginAttempt(req: Request): Promise<boolean> {
    const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(ip));
    const key = ["hub_login_attempts", hex(new Uint8Array(digest)), Math.floor(Date.now() / 60_000)];
    try {
      const kv = await getKv();
      for (let tries = 0; tries < 5; tries++) {
        const entry = await kv.get<number>(key);
        if ((entry.value || 0) >= 20) return false;
        if ((await kv.atomic().check(entry).set(key, (entry.value || 0) + 1, { expireIn: 120_000 }).commit()).ok) return true;
      }
      return false;
    } catch {
      // An unreachable limiter must not refuse a sign-in. Real brute force
      // is still rate-limited on every request where the database answers.
      return true;
    }
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
    if (!["create", "update", "disable", "ban", "enable", "suspend", "reset-password", "sign-out", "delete"].includes(action)) return json({ error: "unknown account action" }, 400);
    if (body.label !== undefined && (typeof body.label !== "string" || body.label.trim().length > 40)) {
      return json({ error: "display name must be at most 40 characters" }, 400);
    }
    if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.trim().length > 200)) return json({ error: "reason must be at most 200 characters" }, 400);
    if (action === "suspend" && (!Number.isInteger(body.durationMinutes) || body.durationMinutes < 1 || body.durationMinutes > 525_600)) {
      return json({ error: "suspension must be between 1 minute and 1 year" }, 400);
    }
    const generatedPassword = action === "reset-password" ? randomHex(12) : null;
    const password = generatedPassword || body.password;
    const changePassword = action === "create" || action === "reset-password" || (action === "update" && body.password !== undefined && body.password !== "");
    if (changePassword && !validPassword(password)) return json({ error: "enter a non-empty password (up to 128 characters)" }, 400);
    const kv = await getKv();
    const entry = await kv.get<Account>(["hub_accounts", key]);
    if (action === "create" && entry.value) return json({ error: "that username is already taken" }, 409);
    if (action !== "create" && !entry.value) return json({ error: "account not found" }, 404);
    const now = clock();
    let record: Account;
    if (action === "create") {
      record = {
        id: randomHex(32), username: body.username.trim(), label: body.label?.trim() || body.username.trim(),
        credential: await hashPassword(password), version: crypto.randomUUID(),
        disabled: false, createdAt: now, lastLogin: 0,
      };
    } else {
      record = { ...entry.value! };
      if (action === "update" || action === "reset-password") {
        if (body.label !== undefined) record.label = body.label.trim() || record.username;
        if (changePassword) { record.credential = await hashPassword(password); record.version = crypto.randomUUID(); }
      } else if (["enable", "disable", "ban", "suspend"].includes(action)) {
        record.disabled = action === "disable" || action === "ban";
        record.suspendedUntil = action === "suspend" ? now + body.durationMinutes * 60_000 : 0;
        record.restrictionReason = action === "enable" ? "" : body.reason?.trim() || "";
        record.version = crypto.randomUUID();
      } else if (action === "sign-out") {
        record.version = crypto.randomUUID();
      }
    }
    const transaction = kv.atomic().check(entry);
    if (action === "delete") transaction.delete(entry.key);
    else transaction.set(entry.key, record);
    if (!(await transaction.commit()).ok) return json({ error: "account changed — refresh and try again" }, 409);
    const endsSessions = action !== "update" || changePassword;
    if (endsSessions && action !== "create") {
      invalidate(record.id);
      // The revocation tombstone is what ends v2 sessions; the row cleanup
      // below is for the admin panel's view.
      await hooks.revokeCode?.(record.id);
      try {
        for await (const session of kv.list<{ code: string }>({ prefix: ["hub_sessions"] })) {
          if (session.value.code === record.id) await kv.delete(session.key);
        }
      } catch { /* version checks enforce revocation even if cleanup fails */ }
    }
    return json({ ok: true, account: action === "delete" ? null : summary(record, clock()),
      ...(generatedPassword ? { password: generatedPassword } : {}) }, action === "create" ? 201 : 200);
  }

  return { authenticate, sessionValid, list, takeLoginAttempt, manage, profile, people, self, ownerConfigured: !!ownerPassword };
}
