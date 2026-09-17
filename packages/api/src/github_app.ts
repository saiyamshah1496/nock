import { type Context } from "hono";
import picomatch from "picomatch";
import { importPKCS8, SignJWT, jwtVerify } from "jose";
import YAML from "yaml";
import { check, type EstateSnapshot, type PolicyResolved, type VerdictV1, computeFreshness } from "@nockhq/core";

// ---- Constants (locked naming from 018) ----
export const CHECK_RUN_NAME = "Nock: DDL gate";
export const APP_DISPLAY_NAME = "Nock DDL Gate";
export const PR_COMMENT_MARKER = "<!-- nock-ddl-gate -->";

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
  pull_request: {
    number: number;
    head: { sha: string; ref?: string };
    base?: { sha?: string; ref?: string };
  };
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

// ---- GitHub Contents helpers ----
async function getRepoFileContent(opts: {
  installationToken: string;
  owner: string;
  repo: string;
  path: string;
  ref: string; // sha or ref
  apiBase?: string;
}): Promise<string | null> {
  const apiBase = (opts.apiBase || "https://api.github.com").replace(/\/+$/, "");
  const url = `${apiBase}/repos/${opts.owner}/${opts.repo}/contents/${encodeURIComponent(
    opts.path.replace(/^\/+/, "")
  )}?ref=${encodeURIComponent(opts.ref)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${opts.installationToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "nock-github-app/0.1.0",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`failed to get content ${opts.path}@${opts.ref}: ${res.status} ${text}`);
  }
  const json: any = await res.json();
  if (!json || typeof json.content !== "string") return null;
  const buf =
    typeof Buffer !== "undefined"
      ? Buffer.from(json.content, "base64")
      : Uint8Array.from(atob(json.content), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(buf);
}

async function tryParseYamlOrJson<T = any>(raw: string): Promise<T | null> {
  try {
    return YAML.parse(raw) as T;
  } catch {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}

async function getYamlOrJsonFile<T = any>(opts: {
  installationToken: string;
  owner: string;
  repo: string;
  path: string;
  ref: string;
  apiBase?: string;
}): Promise<T | null> {
  const text = await getRepoFileContent(opts);
  if (text == null) return null;
  return (await tryParseYamlOrJson<T>(text)) as T | null;
}

// ---- Estate & policy resolution (App v1) ----
type RepoLocator = {
  installationToken: string;
  owner: string;
  repo: string;
  headRef: string; // sha or ref
  baseRef?: string; // sha or ref
  apiBase?: string;
};

export async function resolveEstate(opts: RepoLocator): Promise<EstateSnapshot | null> {
  // 1) .nock/estate.json on head, else base
  const tryPaths = [".nock/estate.json"];
  for (const p of tryPaths) {
    const head = await getRepoFileContent({ ...opts, path: p, ref: opts.headRef });
    if (head) {
      try {
        return JSON.parse(head) as EstateSnapshot;
      } catch {
        // fallthrough
      }
    }
    if (opts.baseRef) {
      const base = await getRepoFileContent({ ...opts, path: p, ref: opts.baseRef });
      if (base) {
        try {
          return JSON.parse(base) as EstateSnapshot;
        } catch {
          // fallthrough
        }
      }
    }
  }

  // 2) Optional redirect via nock.yml / .github/nock.yml with estate-path:
  const configCandidates = ["nock.yml", ".github/nock.yml"];
  let estatePath: string | undefined;
  for (const conf of configCandidates) {
    const headCfg = await getYamlOrJsonFile<{ ["estate-path"]?: string }>({
      ...opts,
      path: conf,
      ref: opts.headRef,
    });
    estatePath = headCfg?.["estate-path"];
    if (!estatePath && opts.baseRef) {
      const baseCfg = await getYamlOrJsonFile<{ ["estate-path"]?: string }>({
        ...opts,
        path: conf,
        ref: opts.baseRef!,
      });
      estatePath = baseCfg?.["estate-path"];
    }
    if (estatePath) break;
  }
  if (estatePath) {
    const head = await getRepoFileContent({ ...opts, path: estatePath, ref: opts.headRef });
    if (head) {
      try {
        return JSON.parse(head) as EstateSnapshot;
      } catch {
        // ignore
      }
    }
    if (opts.baseRef) {
      const base = await getRepoFileContent({ ...opts, path: estatePath, ref: opts.baseRef });
      if (base) {
        try {
          return JSON.parse(base) as EstateSnapshot;
        } catch {
          // ignore
        }
      }
    }
  }
  // 3) None
  return null;
}

export async function resolvePolicy(opts: RepoLocator): Promise<PolicyResolved> {
  // Prefer local .nock policy, else repo root policy.default.yml, else minimal fallback
  const policyCandidates = [
    ".nock/policy.yml",
    ".nock/policy.yaml",
    ".nock/policy.json",
    "policy.default.yml",
    "policy.yml",
    "policy.yaml",
    "policy.json",
  ];
  for (const p of policyCandidates) {
    const text =
      (await getRepoFileContent({ ...opts, path: p, ref: opts.headRef })) ??
      (opts.baseRef ? await getRepoFileContent({ ...opts, path: p, ref: opts.baseRef }) : null);
    if (text) {
      const parsed = await tryParseYamlOrJson<PolicyResolved>(text);
      if (parsed && (parsed as any).id && (parsed as any).fail_on) {
        return parsed;
      }
    }
  }
  // Minimal fallback policy
  return {
    id: "nock.postgres.ddl.default",
    version: "1.0.0",
    fail_on: "red",
    rules: {},
  };
}

async function fetchChangedSqlContents(opts: RepoLocator & { changedFiles: string[] }): Promise<string[]> {
  const isMatch = picomatch(
    ["**/migrations/**/*.sql", "**/db/migrations/**/*.sql", "**/supabase/migrations/**/*.sql"],
    { dot: true }
  );
  const sqlPaths = opts.changedFiles.filter((f) => isMatch(f) && f.toLowerCase().endsWith(".sql"));
  const out: string[] = [];
  for (const p of sqlPaths) {
    const text = await getRepoFileContent({ ...opts, path: p, ref: opts.headRef });
    if (text) out.push(text);
  }
  return out;
}

export function mapVerdictToConclusion(verdict: VerdictV1): {
  conclusion: "success" | "neutral" | "failure";
  summary: string;
} {
  const reds = verdict.violations.filter((v) => v.severity === "red");
  const yellows = verdict.violations.filter((v) => v.severity === "yellow");
  if (reds.length > 0) {
    return {
      conclusion: "failure",
      summary: `Nock verdict: FAIL (red=${reds.length}, yellow=${yellows.length}).`,
    };
  }
  if (yellows.length > 0) {
    return {
      conclusion: "neutral",
      summary: `Nock verdict: WARN (yellow=${yellows.length}).`,
    };
  }
  return { conclusion: "success", summary: "Nock verdict: PASS. No violations found." };
}

function renderTopViolations(verdict: VerdictV1, limit = 10): string {
  if (!verdict.violations.length) return "No violations.";
  const lines: string[] = [];
  const top = verdict.violations.slice(0, limit);
  for (const v of top) {
    const doc = v.docs_url ? ` — see ${v.docs_url}` : "";
    const rem = v.remediation_sql ? `\n\nSuggested remediation:\n\n\`\`\`sql\n${v.remediation_sql}\n\`\`\`` : "";
    lines.push(`• [${v.severity.toUpperCase()}] ${v.rule_id}: ${v.message}${doc}${rem}`);
  }
  return lines.join("\n\n");
}

export function buildPrCommentBodyFromVerdict(verdict: VerdictV1): string {
  const reds = verdict.violations.filter((v) => v.severity === "red").length;
  const yellows = verdict.violations.filter((v) => v.severity === "yellow").length;
  const header = `**Nock: DDL gate**`;
  const summary = `FAIL — red=${reds}, yellow=${yellows}\n\nPolicy: ${verdict.meta.policy_id}\nEngine: ${verdict.meta.engine}${
    verdict.meta.estate_captured_at ? `\nEstate captured at: ${verdict.meta.estate_captured_at}` : ""
  }`;
  const body = `${PR_COMMENT_MARKER}
${header}

${summary}

Top findings:

${renderTopViolations(verdict, 8)}
`;
  return body;
}

async function upsertPrCommentWithMarker(opts: {
  owner: string;
  repo: string;
  pullNumber: number;
  installationToken: string;
  body: string;
  apiBase?: string;
}): Promise<void> {
  const apiBase = (opts.apiBase || "https://api.github.com").replace(/\/+$/, "");
  // 1) List existing issue comments and find a marker
  const listUrl = `${apiBase}/repos/${opts.owner}/${opts.repo}/issues/${opts.pullNumber}/comments?per_page=100`;
  const headers = {
    Authorization: `Bearer ${opts.installationToken}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "nock-github-app/0.1.0",
  };
  let existingId: number | null = null;
  // Best-effort list; if it fails, fall back to POST below
  try {
    const res = await fetch(listUrl, { headers });
    if (res.ok) {
      const arr: any[] = await res.json();
      for (const c of arr) {
        if (typeof c?.id === "number" && typeof c?.body === "string" && c.body.includes(PR_COMMENT_MARKER)) {
          existingId = c.id as number;
          break;
        }
      }
    }
  } catch {
    // ignore list failure; we'll just POST
  }
  if (existingId != null) {
    // PATCH to update in place
    const patchUrl = `${apiBase}/repos/${opts.owner}/${opts.repo}/issues/comments/${existingId}`;
    const res = await fetch(patchUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ body: opts.body }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`failed to patch PR comment: ${res.status} ${text}`);
    }
    return;
  }
  // POST new
  const postUrl = `${apiBase}/repos/${opts.owner}/${opts.repo}/issues/${opts.pullNumber}/comments`;
  const res = await fetch(postUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ body: opts.body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`failed to create PR comment: ${res.status} ${text}`);
  }
}

export async function postFailOnlyPrCommentIfNeeded(opts: {
  owner: string;
  repo: string;
  pullNumber: number;
  installationToken: string;
  verdict: VerdictV1;
  apiBase?: string;
}): Promise<void> {
  const mapped = mapVerdictToConclusion(opts.verdict);
  if (mapped.conclusion !== "failure") return; // fail-only as product lock
  const body = buildPrCommentBodyFromVerdict(opts.verdict);
  await upsertPrCommentWithMarker({
    owner: opts.owner,
    repo: opts.repo,
    pullNumber: opts.pullNumber,
    installationToken: opts.installationToken,
    body,
    apiBase: opts.apiBase,
  });
}

async function postVerdictCheckRun(opts: {
  owner: string;
  repo: string;
  headSha: string;
  installationToken: string;
  verdict: VerdictV1;
  apiBase?: string;
}): Promise<void> {
  const apiBase = (opts.apiBase || "https://api.github.com").replace(/\/+$/, "");
  const url = `${apiBase}/repos/${opts.owner}/${opts.repo}/check-runs`;
  const mapped = mapVerdictToConclusion(opts.verdict);
  const ageH = opts.verdict.meta.estate_age_hours;
  const staleWarn =
    typeof ageH === "number" && ageH >= 7 * 24
      ? `\nNote: Estate is stale (${Math.floor(ageH / 24)}d).` +
        (typeof ageH === "number" && ageH > 30 * 24
          ? " Size‑gated rules neutralized."
          : "")
      : "";
  const summary =
    mapped.summary +
    `\n\nPolicy: ${opts.verdict.meta.policy_id}\nEngine: ${opts.verdict.meta.engine}` +
    (opts.verdict.meta.estate_captured_at ? `\nEstate captured at: ${opts.verdict.meta.estate_captured_at}` : "") +
    staleWarn;
  const body = {
    name: CHECK_RUN_NAME,
    head_sha: opts.headSha,
    status: "completed",
    conclusion: mapped.conclusion,
    output: {
      title: CHECK_RUN_NAME,
      summary: summary + `\n\nTop findings:\n\n` + renderTopViolations(opts.verdict, 8),
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.installationToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "nock-github-app/0.1.0",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`failed to create verdict check_run: ${res.status} ${text}`);
  }
}

async function postNoEstateNeutralCheckRun(opts: {
  owner: string;
  repo: string;
  headSha: string;
  installationToken: string;
  apiBase?: string;
}): Promise<void> {
  const guide1 = "docs/guides/quick-start-estate-file.md";
  const guide2 = "docs/guides/sync-estate.md";
  const summary =
    "Could not find an estate file in this repository. " +
    "Add `.nock/estate.json` (or configure `estate-path:` in `.github/nock.yml`) to enable DDL checks.\n\n" +
    `See ${guide1} and ${guide2}.`;
  const apiBase = (opts.apiBase || "https://api.github.com").replace(/\/+$/, "");
  const url = `${apiBase}/repos/${opts.owner}/${opts.repo}/check-runs`;
  const payload = {
    name: CHECK_RUN_NAME,
    head_sha: opts.headSha,
    status: "completed",
    conclusion: "neutral",
    output: {
      title: CHECK_RUN_NAME,
      summary,
    },
  };
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
    throw new Error(`failed to create neutral(no-estate) check_run: ${res.status} ${text}`);
  }
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
    const baseRef = pr.pull_request.base?.sha || pr.pull_request.base?.ref || undefined;
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
      if (!shouldRun) return c.json({ skipped: true, reason: "no trigger paths" });
      // Resolve estate + policy + changed SQL contents
      const repoLoc: RepoLocator = {
        installationToken: token,
        owner,
        repo,
        headRef: headSha,
        baseRef,
      };
      const estate = await resolveEstate(repoLoc);
      if (!estate) {
        await postNoEstateNeutralCheckRun({ owner, repo, headSha, installationToken: token });
        return c.json({ ok: true, estate: "missing", posted: "neutral" });
      }
      const policy = await resolvePolicy(repoLoc);
      const sqls = await fetchChangedSqlContents({ ...repoLoc, changedFiles: files });
      // Run engine
      const band = computeFreshness(estate.captured_at);
      const verdict = check({
        sql: sqls,
        estate,
        policy,
        noStatsBehavior: band === "stale" ? "warn" : undefined,
      });
      await postVerdictCheckRun({ owner, repo, headSha, installationToken: token, verdict });
      // PR3: fail-only PR comment with dedupe
      try {
        await postFailOnlyPrCommentIfNeeded({
          owner,
          repo,
          pullNumber: pr.pull_request.number,
          installationToken: token,
          verdict,
        });
      } catch {
        // Ignore comment failures; Checks API remains source of truth
      }
      return c.json({ ok: true, verdict: verdict.verdict });
    } catch {
      // If listing fails, still proceed with neutral (noisy but ensures visibility)
      try {
        await postNeutralCheckRun({ owner, repo, headSha, installationToken: token });
        return c.json({ ok: true, fallback: "neutral" });
      } catch (err) {
        return c.json({ error: "failed to post check_run", detail: String(err) }, 500);
      }
    }
  }

  return c.json({ skipped: true, reason: "unsupported event" });
}

