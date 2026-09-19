import * as fs from "fs";
import * as path from "path";

const MAX_FILES = 200;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".turbo"]);
const SEARCH_DIRS = [".nock", "migrations", "fixtures", "examples"];
const ALLOWED_EXT = new Set([".sql", ".json", ".yml", ".yaml"]);

export type NockFileRole = "estate" | "policy" | "sql" | "other";

export type NockFile = {
  path: string;
  relativePath: string;
  role: NockFileRole;
};

export type NockSession = {
  schema_version: "1";
  workspaceRoot: string;
  estatePath: string | null;
  policyPath: string | null;
  files: NockFile[];
  sources: {
    liveDatabaseUrl: boolean;
    hostedToken: boolean;
  };
};

export function resolveWorkspaceRoot(explicit?: string): string {
  const raw = (explicit || process.env.NOCK_WORKSPACE || process.cwd()).trim();
  return path.resolve(raw);
}

export function isUnderWorkspace(absPath: string, workspaceRoot: string): boolean {
  const root = path.resolve(workspaceRoot);
  const abs = path.resolve(absPath);
  return abs === root || abs.startsWith(root + path.sep);
}

function classifyRole(relativePath: string): NockFileRole {
  const name = path.basename(relativePath).toLowerCase();
  if (name === "estate.json" || (name.startsWith("estate_") && name.endsWith(".json"))) {
    return "estate";
  }
  if (name.startsWith("policy") && (name.endsWith(".json") || name.endsWith(".yml") || name.endsWith(".yaml"))) {
    return "policy";
  }
  if (name.endsWith(".sql")) return "sql";
  return "other";
}

function walkFiles(dir: string, acc: string[]): void {
  if (acc.length >= MAX_FILES) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (acc.length >= MAX_FILES) return;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, acc);
    } else if (entry.isFile() && ALLOWED_EXT.has(path.extname(entry.name).toLowerCase())) {
      acc.push(full);
    }
  }
}

function toNockFile(absPath: string, workspaceRoot: string): NockFile {
  const relativePath = path.relative(workspaceRoot, absPath).split(path.sep).join("/");
  return { path: absPath, relativePath, role: classifyRole(relativePath) };
}

function pickPreferredEstate(files: NockFile[], workspaceRoot: string): string | null {
  const conventional = path.join(workspaceRoot, ".nock", "estate.json");
  if (files.some((f) => f.path === conventional)) return conventional;
  const rootEstate = path.join(workspaceRoot, "estate.json");
  if (files.some((f) => f.path === rootEstate)) return rootEstate;
  return null;
}

function pickPreferredPolicy(files: NockFile[], workspaceRoot: string): string | null {
  const candidates = [
    path.join(workspaceRoot, ".nock", "policy.json"),
    path.join(workspaceRoot, "policy.json"),
  ];
  for (const candidate of candidates) {
    if (files.some((f) => f.path === candidate)) return candidate;
  }
  return null;
}

export function listNockFiles(workspaceRoot?: string): NockFile[] {
  const root = resolveWorkspaceRoot(workspaceRoot);
  const found: string[] = [];
  for (const rel of SEARCH_DIRS) {
    const dir = path.join(root, rel);
    if (fs.existsSync(dir)) walkFiles(dir, found);
  }
  for (const name of ["estate.json", "policy.json", "policy.default.yml", "policy.default.yaml"]) {
    const abs = path.join(root, name);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) found.push(abs);
  }
  const uniq = Array.from(new Set(found)).filter((abs) => isUnderWorkspace(abs, root));
  return uniq
    .map((abs) => toNockFile(abs, root))
    .filter((file) => file.role !== "other")
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function discoverSession(workspaceRoot?: string): NockSession {
  const root = resolveWorkspaceRoot(workspaceRoot);
  const files = listNockFiles(root);
  const tokenEnv =
    process.env.NOCK_TEAM_API_TOKEN ||
    process.env.NOCK_ESTATE_API_TOKEN ||
    process.env.NOCK_STATS_API_TOKEN ||
    "";
  return {
    schema_version: "1",
    workspaceRoot: root,
    estatePath: pickPreferredEstate(files, root),
    policyPath: pickPreferredPolicy(files, root),
    files,
    sources: {
      liveDatabaseUrl: Boolean((process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "").trim()),
      hostedToken: Boolean(tokenEnv.trim()),
    },
  };
}

export function readWorkspaceFile(
  filePath: string,
  workspaceRoot?: string
): { path: string; relativePath: string; role: NockFileRole; text: string } {
  const root = resolveWorkspaceRoot(workspaceRoot);
  const abs = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
  if (!isUnderWorkspace(abs, root)) {
    throw new Error("Path is outside the workspace");
  }
  const relParts = path.relative(root, abs).split(path.sep);
  if (relParts.some((part) => SKIP_DIRS.has(part))) {
    throw new Error("Path is not a Nock workspace file");
  }
  const ext = path.extname(abs).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error("Only .sql, .json, .yml, and .yaml files can be read");
  }
  const file = toNockFile(abs, root);
  return { ...file, text: fs.readFileSync(abs, "utf8") };
}
