import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { discoverSession, listNockFiles, readWorkspaceFile } from "../src/session.js";
import { checkBeforeApplyHostedOrLocal, checkBeforeApplyLocal } from "../src/index.js";

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "nock-session-"));
  mkdirSync(join(root, ".nock"));
  mkdirSync(join(root, "migrations"));
  mkdirSync(join(root, "examples", "workflows"), { recursive: true });
  mkdirSync(join(root, "node_modules", "secret"), { recursive: true });
  writeFileSync(
    join(root, ".nock", "estate.json"),
    JSON.stringify({
      schema_version: "1",
      captured_at: "2026-09-16T05:00:00Z",
      pg_version: "16.4",
      tables: [{ schema: "public", name: "sessions", n_live_tup: 1040000000 }],
    })
  );
  writeFileSync(
    join(root, "policy.json"),
    JSON.stringify({
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R001: { red_rows: 10000 }, R010: { always_require_lock_timeout_above_rows: 1000000 } },
    })
  );
  writeFileSync(
    join(root, "migrations", "001.sql"),
    "CREATE INDEX idx_sessions_archived_at ON sessions (archived_at);"
  );
  writeFileSync(join(root, "node_modules", "secret", "leak.sql"), "SELECT 1;");
  writeFileSync(join(root, "examples", "workflows", "nock.yml"), "name: nock\n");
  return root;
}

describe("MCP session + files (IDE local workspace)", () => {
  it("discovers estate, policy, and SQL like the local CLI files", () => {
    const root = makeWorkspace();
    const session = discoverSession(root);
    expect(session.schema_version).toBe("1");
    expect(session.workspaceRoot).toBe(root);
    expect(session.estatePath).toBe(join(root, ".nock", "estate.json"));
    expect(session.policyPath).toBe(join(root, "policy.json"));
    expect(session.files.map((f) => f.relativePath).sort()).toEqual([
      ".nock/estate.json",
      "migrations/001.sql",
      "policy.json",
    ]);
    expect(session.files.some((f) => f.relativePath.includes("node_modules"))).toBe(false);
    expect(session.sources.liveDatabaseUrl).toBe(false);
    expect(session.sources.hostedToken).toBe(false);
  });

  it("lists the same files via listNockFiles", () => {
    const root = makeWorkspace();
    const files = listNockFiles(root);
    expect(files.find((f) => f.role === "estate")?.relativePath).toBe(".nock/estate.json");
    expect(files.find((f) => f.role === "sql")?.relativePath).toBe("migrations/001.sql");
  });

  it("reads a workspace SQL file and rejects escapes", () => {
    const root = makeWorkspace();
    const sql = readWorkspaceFile("migrations/001.sql", root);
    expect(sql.role).toBe("sql");
    expect(sql.text).toContain("CREATE INDEX");
    expect(() => readWorkspaceFile("../outside.sql", root)).toThrow(/outside the workspace/);
    expect(() => readWorkspaceFile("node_modules/secret/leak.sql", root)).toThrow(/not a Nock workspace file/);
  });

  it("check_before_apply via sqlPath ≡ inline SQL on the same local files", async () => {
    const root = makeWorkspace();
    const sqlPath = join(root, "migrations", "001.sql");
    const estatePath = join(root, ".nock", "estate.json");
    const fromPath = await checkBeforeApplyHostedOrLocal({
      sqlPath,
      estatePath,
      workspaceRoot: root,
    });
    const inline = checkBeforeApplyLocal({
      sql: readWorkspaceFile(sqlPath, root).text,
      estatePath,
    });
    expect(fromPath.verdict).toEqual(inline.verdict);
    expect(fromPath.violations.map((v) => v.rule_id).sort()).toEqual(
      inline.violations.map((v) => v.rule_id).sort()
    );
    expect(fromPath.verdict).toBe("fail");
    expect(fromPath.violations.map((v) => v.rule_id)).toContain("R001");
  });

  it("uses the session .nock/estate.json when estatePath is omitted", async () => {
    const root = makeWorkspace();
    const verdict = await checkBeforeApplyHostedOrLocal({
      sqlPath: "migrations/001.sql",
      workspaceRoot: root,
    });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.violations.map((v) => v.rule_id)).toContain("R001");
  });
});
