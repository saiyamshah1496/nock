import { type Context } from "hono";
import picomatch from "picomatch";
import { importPKCS8, SignJWT, jwtVerify } from "jose";

// ---- Constants (locked naming from 018) ----
export const CHECK_RUN_NAME = "Nock: DDL gate";
export const APP_DISPLAY_NAME = "Nock DDL Gate";

// ---- Utilities ----
function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) {
    const h = arr[i].toString(16).padStart(2, "0");
    s += h;
  }
  return s;
}

async function hmacSha256(key: string, data: ArrayBuffer): Promise<string> {
  // Prefer Web Crypto (Workers); fall back to Node crypto for local tests
  try {
    // @ts-ignore - globalThis.crypto in Workers
    const subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle;
    if (subtle) {
      const enc = new TextEncoder();
      const cryptoKey = await subtle.importKey(
        "raw",
        enc.encode(key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await subtle.sign("HMAC", cryptoKey, data);
      return "sha256=" + toHex(sig);
    }
  } catch {
    // continue to node fallback
  }
  // Node fallback
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require("crypto") as typeof import("crypto");
  const h = nodeCrypto.createHmac("sha256", key);
  h.update(Buffer.from(data));
  return "sha256=" + h.digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function verifyGitHubSignature(opts: {
  secret: string;
  signatureHeader: string | null | undefined;
  rawBody: ArrayBuffer;
}): Promise<boolean> {
  const { secret, signatureHeader, rawBody } = opts;
  if (!signatureHeader) return false;
  const expected = await hmacSha256(secret, rawBody);
  return timingSafeEqual(signatureHeader, expected);
}

// ---- Trigger path matching ----
const DEFAULT_GLOBS = [
  "**/migrations/**/*.sql",
  "**/db/migrations/**/*.sql",
  "**/supabase/migrations/**/*.sql",
  "**/.nock/**",
];

export function prTouchesTriggerPaths(
  filenames: string[],
  globs: string[] = DEFAULT_GLOBS
): boolean {
  const isMatch = picomatch(globs, { dot: true });
  return filenames.some((f) => isMatch(f));
}

// ---- GitHub auth (App JWT -> installation token) ----
function normalizePem(pem: string): string {
  // Accept raw PEM or with escaped newlines from env
  const fixed = pem
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
  return fixed;
}

export async function createAppJWT(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const pkcs8 = normalizePem(privateKeyPem);
  const alg = "RS256";
  const key = await importPKCS8(pkcs8, alg);
  return await new SignJWT({})
    .setProtectedHeader({ alg, typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + 9 * 60) // 9 minutes (max 10)
    .setIssuer(appId)
    .sign(key);
}

export async function getInstallationAccessToken(opts: {
  appJwt: string;
  installationId: number;
  apiBase?: string; // for GH Enterprise
}): Promise<string> {
  const apiBase = (opts.apiBase || "https://api.github.com").replace(/\/+$/, "");
  const url = `${apiBase}/app/installations/${opts.installationId}/access_tokens`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.appJwt}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "nock-github-app/0.1.0",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`failed to get installation token: ${res.status} ${text}`);
  }
  const json: any = await res.json();
  return json.token as string;
}

// ---- Checks API (neutral check_run) ----
export function buildNeutralCheckRunPayload(params: {
  headSha: string;
  title?: string;
  summary?: string;
}): any {
  const title = params.title || CHECK_RUN_NAME;
  const summary =
    params.summary ||
    "Scaffold in place. This is PR1: webhook + neutral check. Real verdict lands in PR2.";
  return {
    name: CHECK_RUN_NAME,
    head_sha: params.headSha,
    status: "completed",
    conclusion: "neutral",
    output: {
      title,
      summary,
    },
  };
}

export async function postNeutralCheckRun(opts: {
  owner: string;
  repo: string;
  headSha: string;
  installationToken: string;
  apiBase?: string;
}): Promise<void> {
  const apiBase = (opts.apiBase || "https://api.github.com").replace(/\/+$/, "");
  const url = `${apiBase}/repos/${opts.owner}/${opts.repo}/check-runs`;
  const payload = buildNeutralCheckRunPayload({ headSha: opts.headSha });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.installationToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "nock-github-app/0.1.0",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`failed to create check_run: ${res.status} ${text}`);
  }
}

// ---- Pull Request event handling (PR1 minimal) ----
type PullRequestEvent = {
  action: string;
  installation?: { id: number };
  repository: { name: string; owner: { login: string } };
  pull_request: { number: number; head: { sha: string } };
};

export async function listPrChangedFiles(opts: {
  installationToken: string;
  owner: string;
  repo: string;
  pullNumber: number;
  apiBase?: string;
}): Promise<string[]> {
  const apiBase = (opts.apiBase || "https://api.github.com").replace(/\/+$/, "");
  const url = `${apiBase}/repos/${opts.owner}/${opts.repo}/pulls/${opts.pullNumber}/files?per_page=100`;
  const headers = {
    Authorization: `Bearer ${opts.installationToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "nock-github-app/0.1.0",
  };
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`failed to list PR files: ${res.status} ${text}`);
  }
  const json: any[] = await res.json();
  return json.map((f) => f.filename as string);
}

const PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

export async function handleWebhook(c: Context, rawBody: ArrayBuffer): Promise<Response> {
  const secret = c.env.GITHUB_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET;
  const appId = c.env.GITHUB_APP_ID || process.env.GITHUB_APP_ID;
  const privateKey = c.env.GITHUB_APP_PRIVATE_KEY || process.env.GITHUB_APP_PRIVATE_KEY;
  const event = c.req.header("X-GitHub-Event") || c.req.header("x-github-event") || "";
  const sig = c.req.header("X-Hub-Signature-256") || c.req.header("x-hub-signature-256") || "";

  if (!secret || !appId || !privateKey) {
    return c.json({ error: "server not configured" }, 500);
  }

  // ping early-exit (no signature check needed, but do it anyway)
  const ok = await verifyGitHubSignature({ secret, signatureHeader: sig, rawBody });
  if (!ok) return c.json({ error: "invalid signature" }, 401);
  if (event === "ping") return c.json({ ok: true });

  // Parse after signature verification so we can use raw body
  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  if (event === "pull_request") {
    const pr = payload as PullRequestEvent;
    if (!PR_ACTIONS.has(pr.action)) return c.json({ skipped: true, reason: "irrelevant action" });
    const installationId = pr.installation?.id;
    if (!installationId) return c.json({ skipped: true, reason: "no installation id" });
    const owner = pr.repository.owner.login;
    const repo = pr.repository.name;
    const headSha = pr.pull_request.head.sha;
    // Auth
    const appJwt = await createAppJWT(String(appId), String(privateKey));
    const token = await getInstallationAccessToken({ appJwt, installationId });
    // Filter by changed paths (quiet by default)
    let shouldRun = true;
    try {
      const files = await listPrChangedFiles({
        installationToken: token,
        owner,
        repo,
        pullNumber: pr.pull_request.number,
      });
      shouldRun = prTouchesTriggerPaths(files);
    } catch {
      // If listing fails, still proceed with neutral (noisy but ensures visibility)
      shouldRun = true;
    }
    if (!shouldRun) return c.json({ skipped: true, reason: "no trigger paths" });
    // Always-Neutral check for PR1
    await postNeutralCheckRun({ owner, repo, headSha, installationToken: token });
    return c.json({ ok: true });
  }

  return c.json({ skipped: true, reason: "unsupported event" });
}

