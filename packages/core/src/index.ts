export type LockMode =
  | "ACCESS EXCLUSIVE"
  | "ACCESS SHARE"
  | "SHARE"
  | "SHARE UPDATE EXCLUSIVE"
  | "SHARE ROW EXCLUSIVE";

export interface TableRef {
  schema: string;
  name: string;
}

export interface StatementVerdict {
  sql: string;
  lock_mode: LockMode | "UNKNOWN";
  blocks_reads: boolean;
  blocks_writes: boolean;
  target?: TableRef;
  n_live_tup?: number;
  estimated_hold_ms?: { min: number; max: number };
  estimated_hold_label?: "approximate";
  rules_hit: string[];
}

export interface Violation {
  rule_id: string;
  severity: "red" | "yellow";
  message: string;
  remediation_sql?: string;
  docs_url?: string;
}

export interface EstateTable {
  schema: string;
  name: string;
  n_live_tup: number;
  n_dead_tup?: number;
  relation_bytes?: number;
  total_bytes?: number;
  last_analyze?: string | null;
  last_autoanalyze?: string | null;
}

export interface EstateSnapshot {
  schema_version?: string;
  captured_at?: string;
  pg_version?: string;
  source?: string;
  tables: EstateTable[];
}

export interface PolicyResolved {
  id: string;
  version?: string;
  fail_on: "red" | "yellow";
  require_lock_timeout?: "always" | "size_gated";
  rules: Record<string, any>;
  no_stats?: "warn" | "fail_closed";
}

export interface VerdictV1 {
  schema_version: "1";
  verdict: "pass" | "fail";
  statements: StatementVerdict[];
  violations: Violation[];
  meta: {
    pg_version?: string;
    estate_captured_at?: string;
    estate_age_hours?: number;
    policy_id: string;
    engine: "postgres";
  };
}

export interface CheckInput {
  sql: string | string[];
  estate: EstateSnapshot;
  policy: PolicyResolved;
  pgVersion?: string;
}

// Expansion hooks (interfaces)
export type EngineId = "postgres" | "mysql" | "sqlserver" | "warehouse";

export interface Statement {
  sql: string;
  target?: TableRef;
  shapeId?: string;
}

export interface EngineAdapter {
  id: EngineId;
  parse(sql: string, version: string): Statement[];
  lockMode(stmt: Statement): LockMode;
}

export interface RuleContext {
  statement: Statement;
  estate: EstateSnapshot;
  policy: PolicyResolved;
}

export interface Rule {
  id: string;
  evaluate(ctx: RuleContext): Violation[];
}

export interface PolicyPack {
  id: string;
  extends?: string;
  version: string;
  fail_on: "red" | "yellow";
  rules: Record<string, any>;
  require_lock_timeout?: "always" | "size_gated";
}

// Minimal shape matcher: CREATE INDEX (non-concurrent), including UNIQUE and IF NOT EXISTS variants
function isCreateIndexNonConcurrent(sql: string): {
  table?: TableRef;
  indexName?: string;
  isUnique?: boolean;
} | null {
  const clean = stripSqlComments(sql);
  const norm = clean.trim().replace(/\s+/g, " ").toUpperCase();
  // Accept: CREATE INDEX ..., CREATE UNIQUE INDEX ..., optional IF NOT EXISTS
  if (!/^CREATE\s+(UNIQUE\s+)?INDEX\b/.test(norm)) return null;
  if (norm.includes(" CONCURRENTLY ")) return null;
  // Try to extract table: CREATE [UNIQUE] INDEX [IF NOT EXISTS] <name> ON <schema?.>table (
  const m =
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_"]+)\s+ON\s+([A-Za-z0-9_".]+)/i.exec(
      clean
    );
  if (!m) return { table: undefined, indexName: undefined };
  const indexName = m[1];
  const fq = m[2].replace(/"/g, "");
  const parts = fq.split(".");
  const table: TableRef =
    parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
  const isUnique = /\bCREATE\s+UNIQUE\s+INDEX\b/i.test(clean);
  return { table, indexName, isUnique };
}

// ALTER TABLE ... ADD COLUMN ...
function isAlterTableAddColumn(sql: string): { table?: TableRef; column?: string; hasDefault: boolean } | null {
  const clean = stripSqlComments(sql);
  const m =
    /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)\s+ADD\s+COLUMN\s+([A-Za-z0-9_".]+)[\s\S]*?;?$/i.exec(clean.trim());
  if (!m) return null;
  const fq = m[1].replace(/"/g, "");
  const parts = fq.split(".");
  const table: TableRef =
    parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
  const hasDefault = /\bDEFAULT\b/i.test(clean);
  const column = m[2]?.replace(/"/g, "");
  return { table, column, hasDefault };
}

// Extract the DEFAULT expression for an ADD COLUMN statement, if present.
// Heuristic: capture text after DEFAULT up to common clause boundaries.
function extractAddColumnDefaultExpression(sql: string): string | null {
  const clean = stripSqlComments(sql);
  const m = /ADD\s+COLUMN\s+[A-Za-z0-9_".]+\s+[\s\S]*?\bDEFAULT\b\s+([\s\S]+?)\s*(?=(?:,|$|\)|\bNOT\s+NULL\b|\bNULL\b|\bCONSTRAINT\b|\bPRIMARY\b|\bUNIQUE\b|\bCHECK\b|\bREFERENCES\b|\bCOLLATE\b))/i.exec(
    clean
  );
  if (!m) return null;
  return m[1].trim();
}

// Detect GENERATED ... STORED computed columns in ADD COLUMN (treated like rewrite)
function isGeneratedStored(sql: string): boolean {
  const up = stripSqlComments(sql).toUpperCase();
  // Match "GENERATED ALWAYS AS (... ) STORED" or "GENERATED AS (... ) STORED"
  return /\bADD\s+COLUMN\b[\s\S]*\bGENERATED\b[\s\S]*\bSTORED\b/.test(up);
}

// Detect IDENTITY columns (implicitly nextval()) in ADD COLUMN
function isIdentityColumn(sql: string): boolean {
  const up = stripSqlComments(sql).toUpperCase();
  // Covers: GENERATED BY DEFAULT AS IDENTITY / GENERATED ALWAYS AS IDENTITY
  return /\bADD\s+COLUMN\b[\s\S]*\bGENERATED\b[\s\S]*\bAS\s+IDENTITY\b/.test(up);
}

// Determine whether a DEFAULT expression is a simple constant or an immutable literal (including simple casts)
function isConstantDefault(expr: string): boolean {
  const s = expr.trim();
  // Allow casts at the end, e.g., 0::int, 'x'::text, NULL::timestamptz
  const stripCast = s.replace(/::[A-Za-z0-9_"\s]+$/i, "").trim();
  // Numeric literal
  if (/^[+-]?\d+(\.\d+)?$/.test(stripCast)) return true;
  // String literal (supports doubled quotes for escaping)
  if (/^(E)?'(?:[^']|'')*'$/.test(stripCast)) return true;
  // Boolean/NULL
  if (/^(TRUE|FALSE|NULL)$/i.test(stripCast)) return true;
  return false;
}

// Heuristic volatile detection for DEFAULT expressions
function isVolatileDefault(expr: string): boolean {
  const low = expr.trim().toLowerCase();
  // Explicit allowlist that must NOT red for this rule
  if (/^now\s*\(\s*\)\s*$/.test(low)) return false;
  if (/^current_timestamp\b/.test(low)) return false;
  if (/^current_date\b/.test(low)) return false;
  if (/^localtimestamp\b/.test(low)) return false;
  // Known volatile functions (non-exhaustive)
  const volatileFuncs = [
    "random(",
    "clock_timestamp(",
    "timeofday(",
    "nextval(",
    "gen_random_uuid(",
    "uuid_generate_v4(",
    "uuid_generate_v1(",
    "uuid_generate_v1mc("
  ];
  if (volatileFuncs.some((f) => low.includes(f))) return true;
  // Conservative: do not guess other functions as volatile to avoid false reds
  return false;
}

// ALTER TABLE ... ALTER COLUMN ... SET NOT NULL
function isAlterTableSetNotNull(sql: string): { table?: TableRef; column?: string } | null {
  const clean = stripSqlComments(sql);
  const m =
    /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)\s+ALTER\s+(?:COLUMN\s+)?([A-Za-z0-9_".]+)\s+SET\s+NOT\s+NULL/i.exec(
      clean.trim()
    );
  if (!m) return null;
  const fq = m[1].replace(/"/g, "");
  const parts = fq.split(".");
  const table: TableRef =
    parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
  const column = m[2]?.replace(/\"/g, "");
  return { table, column };
}

// ALTER TABLE ... ADD CONSTRAINT ... CHECK (...) [NOT VALID]
function isAddCheckConstraintWithoutNotValid(sql: string): { table?: TableRef } | null {
  const clean = stripSqlComments(sql);
  const norm = clean.trim();
  if (!/ALTER\s+TABLE\s+/i.test(norm) || !/\bADD\s+CONSTRAINT\b/i.test(norm) || !/\bCHECK\s*\(/i.test(norm))
    return null;
  if (/\bNOT\s+VALID\b/i.test(norm)) return null; // safe path
  const m = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)/i.exec(norm);
  const fq = m?.[1]?.replace(/"/g, "");
  let table: TableRef | undefined = undefined;
  if (fq) {
    const parts = fq.split(".");
    table = parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
  }
  return { table };
}

// ALTER TABLE ... ADD [CONSTRAINT name] FOREIGN KEY (...) REFERENCES <parent>(...) [NOT VALID]
function isAddForeignKeyWithoutNotValid(
  sql: string
): { child?: TableRef; parent?: TableRef } | null {
  const clean = stripSqlComments(sql);
  const norm = clean.trim();
  if (!/ALTER\s+TABLE\s+/i.test(norm)) return null;
  if (!/\bADD\s+(CONSTRAINT\s+[A-Za-z0-9_".]+\s+)?FOREIGN\s+KEY\b/i.test(norm)) return null;
  // If NOT VALID is present, it's the safe path and should not trigger R007
  if (/\bNOT\s+VALID\b/i.test(norm)) return null;
  // Child table
  const tm = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const childFq = tm?.[1]?.replace(/"/g, "");
  const childParts = childFq ? childFq.split(".") : [];
  const child: TableRef | undefined = childFq
    ? childParts.length === 2
      ? { schema: childParts[0], name: childParts[1] }
      : { schema: "public", name: childParts[0] }
    : undefined;
  // Referenced parent table
  const pm = /\bREFERENCES\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const parentFq = pm?.[1]?.replace(/"/g, "");
  const parentParts = parentFq ? parentFq.split(".") : [];
  const parent: TableRef | undefined = parentFq
    ? parentParts.length === 2
      ? { schema: parentParts[0], name: parentParts[1] }
      : { schema: "public", name: parentParts[0] }
    : undefined;
  return { child, parent };
}

function isVacuumFullOrClusterOrNonConcurrentReindex(sql: string): { kind: "VACUUM FULL" | "CLUSTER" | "REINDEX" } | null {
  const up = stripSqlComments(sql).trim().toUpperCase();
  if (up.startsWith("VACUUM FULL")) return { kind: "VACUUM FULL" };
  if (up.startsWith("CLUSTER")) return { kind: "CLUSTER" };
  if (up.startsWith("REINDEX") && !up.includes(" CONCURRENTLY")) return { kind: "REINDEX" };
  return null;
}

function lockModeForCreateIndexNonConcurrent(): LockMode {
  // Per PG docs, non-concurrent CREATE INDEX takes SHARE
  return "SHARE";
}

function findTableEstate(snapshot: EstateSnapshot, ref?: TableRef): EstateTable | undefined {
  if (!ref) return undefined;
  const hit =
    snapshot.tables.find(
      (t) => t.schema.toLowerCase() === ref.schema.toLowerCase() && t.name.toLowerCase() === ref.name.toLowerCase()
    ) ||
    snapshot.tables.find((t) => t.name.toLowerCase() === ref.name.toLowerCase()); // fallback if schema omitted
  return hit;
}

function formatRows(n?: number): string {
  if (!n && n !== 0) return "?";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "k";
  return String(n);
}

function splitSqlStatements(sql: string): string[] {
  // Naive splitter by semicolon, ignoring simple cases with semicolons in quotes
  const parts = sql
    .split(/;(?![^'"]*['"])/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
}

// Detect explicit transaction control statements (BEGIN/START TRANSACTION ... COMMIT/ROLLBACK/END/ABORT)
function isTxnBegin(sql: string): boolean {
  const up = stripSqlComments(sql).toUpperCase().trim();
  return up.startsWith("BEGIN") || up.startsWith("START TRANSACTION");
}
function isTxnEnd(sql: string): boolean {
  const up = stripSqlComments(sql).toUpperCase().trim();
  return up.startsWith("COMMIT") || up.startsWith("END") || up.startsWith("ROLLBACK") || up.startsWith("ABORT");
}

// Detect concurrent DDL forms that cannot run inside an explicit transaction block
function parseConcurrentDdl(sql: string):
  | {
      kind:
        | "CREATE INDEX CONCURRENTLY"
        | "CREATE UNIQUE INDEX CONCURRENTLY"
        | "DROP INDEX CONCURRENTLY"
        | "REINDEX CONCURRENTLY"
        | "REFRESH MATERIALIZED VIEW CONCURRENTLY";
      target?: TableRef;
    }
  | null {
  const clean = stripSqlComments(sql);
  const up = clean.toUpperCase().trim().replace(/\s+/g, " ");

  // CREATE [UNIQUE] INDEX CONCURRENTLY <name> ON <schema?.>table ( ... )
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/.test(up)) {
    const m =
      /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+[A-Za-z0-9_"]+\s+ON\s+([A-Za-z0-9_".]+)/i.exec(clean);
    let table: TableRef | undefined = undefined;
    if (m?.[1]) {
      const fq = m[1].replace(/"/g, "");
      const parts = fq.split(".");
      table = parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
    }
    const isUnique = /^\s*CREATE\s+UNIQUE\s+INDEX\s+CONCURRENTLY\b/i.test(clean);
    return { kind: isUnique ? "CREATE UNIQUE INDEX CONCURRENTLY" : "CREATE INDEX CONCURRENTLY", target: table };
  }

  // DROP INDEX CONCURRENTLY ...
  if (/^DROP\s+INDEX\s+CONCURRENTLY\b/i.test(up)) {
    return { kind: "DROP INDEX CONCURRENTLY" };
  }

  // REINDEX CONCURRENTLY ...
  if (/^REINDEX\s+CONCURRENTLY\b/i.test(up)) {
    return { kind: "REINDEX CONCURRENTLY" };
  }

  // REFRESH MATERIALIZED VIEW CONCURRENTLY <name>
  if (/^REFRESH\s+MATERIALIZED\s+VIEW\s+CONCURRENTLY\b/i.test(up)) {
    return { kind: "REFRESH MATERIALIZED VIEW CONCURRENTLY" };
  }

  return null;
}

// Parse: ALTER TABLE <tbl> ADD CONSTRAINT <name> CHECK (<col> IS NOT NULL) NOT VALID;
function parseAddNotValidCheckOnColumn(
  sql: string
): { table?: TableRef; column?: string; constraint?: string } | null {
  const clean = stripSqlComments(sql);
  if (!/ALTER\s+TABLE/i.test(clean) || !/\bADD\s+CONSTRAINT\b/i.test(clean) || !/\bCHECK\s*\(/i.test(clean)) {
    return null;
  }
  if (!/\bNOT\s+VALID\b/i.test(clean)) return null;
  const tm = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const cm = /\bADD\s+CONSTRAINT\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const exprM = /\bCHECK\s*\(([\s\S]*?)\)\s*NOT\s+VALID/i.exec(clean);
  const fq = tm?.[1]?.replace(/"/g, "");
  const parts = fq ? fq.split(".") : [];
  const table: TableRef | undefined = fq
    ? parts.length === 2
      ? { schema: parts[0], name: parts[1] }
      : { schema: "public", name: parts[0] }
    : undefined;
  const constraint = cm?.[1]?.replace(/"/g, "");
  let column: string | undefined = undefined;
  if (exprM?.[1]) {
    const expr = exprM[1].replace(/\s+/g, " ").trim().replace(/"/g, "");
    const m2 = /^([A-Za-z0-9_.]+)\s+IS\s+NOT\s+NULL$/i.exec(expr) || /^\(([A-Za-z0-9_.]+)\)\s+IS\s+NOT\s+NULL$/i.exec(expr);
    column = m2?.[1]?.split(".").pop();
  }
  return { table, column, constraint };
}

// Parse: ALTER TABLE <tbl> VALIDATE CONSTRAINT <name>;
function parseValidateConstraint(sql: string): { table?: TableRef; constraint?: string } | null {
  const clean = stripSqlComments(sql);
  if (!/ALTER\s+TABLE/i.test(clean) || !/\bVALIDATE\s+CONSTRAINT\b/i.test(clean)) return null;
  const tm = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const cm = /\bVALIDATE\s+CONSTRAINT\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const fq = tm?.[1]?.replace(/"/g, "");
  const parts = fq ? fq.split(".") : [];
  const table: TableRef | undefined = fq
    ? parts.length === 2
      ? { schema: parts[0], name: parts[1] }
      : { schema: "public", name: parts[0] }
    : undefined;
  const constraint = cm?.[1]?.replace(/"/g, "");
  return { table, constraint };
}

// Detect expand/contract: ADD CONSTRAINT ... NOT VALID then VALIDATE CONSTRAINT for same table/column before SET NOT NULL
function hasExpandContractForNotNull(
  sqls: string[],
  table?: TableRef,
  column?: string,
  setIndexHint?: number
): boolean {
  if (!table || !column) return false;
  const tkey = `${table.schema.toLowerCase()}.${table.name.toLowerCase()}`;
  // collect all matches with their positions
  const adds: Array<{ idx: number; constraint: string }> = [];
  const validates: Array<{ idx: number; constraint: string }> = [];
  for (let i = 0; i < sqls.length; i++) {
    const add = parseAddNotValidCheckOnColumn(sqls[i]);
    if (add?.table && add?.column && add?.constraint) {
      const akey = `${add.table.schema.toLowerCase()}.${add.table.name.toLowerCase()}`;
      if (akey === tkey && add.column.toLowerCase() === column.toLowerCase()) {
        adds.push({ idx: i, constraint: add.constraint });
      }
    }
    const val = parseValidateConstraint(sqls[i]);
    if (val?.table && val?.constraint) {
      const vkey = `${val.table.schema.toLowerCase()}.${val.table.name.toLowerCase()}`;
      if (vkey === tkey) {
        validates.push({ idx: i, constraint: val.constraint });
      }
    }
  }
  const maxSetIdx = typeof setIndexHint === "number" ? setIndexHint : sqls.length;
  // look for a pair add<validate where both come before SET NOT NULL
  for (const a of adds) {
    for (const v of validates) {
      if (v.idx > a.idx && v.idx < maxSetIdx && v.constraint.toLowerCase() === a.constraint.toLowerCase()) {
        return true;
      }
    }
  }
  return false;
}

export function check(input: CheckInput): VerdictV1 {
  const sqls = Array.isArray(input.sql)
    ? input.sql.flatMap((s) => splitSqlStatements(s))
    : splitSqlStatements(input.sql);
  const statements: StatementVerdict[] = [];
  const violations: Violation[] = [];
  const policy = input.policy;

  // Track if a lock_timeout was set earlier in this batch
  const priorLockTimeoutFlags: boolean[] = [];
  let seenLockTimeout = false;
  // Track explicit transaction blocks (BEGIN/START TRANSACTION ... COMMIT/ROLLBACK/END)
  let insideExplicitTxn = false;

  for (let stmtIdx = 0; stmtIdx < sqls.length; stmtIdx++) {
    const sql = sqls[stmtIdx];
    const up = sql.trim().toUpperCase();
    priorLockTimeoutFlags.push(seenLockTimeout);
    // Recognize both SET and SET LOCAL, with '=' or 'TO' assignment forms
    if (/^SET(\s+LOCAL)?\s+LOCK_TIMEOUT\s*(=|TO)\s*/i.test(up)) {
      seenLockTimeout = true;
      // Not a DDL to classify — continue to next
      statements.push({
        sql,
        lock_mode: "UNKNOWN",
        blocks_reads: false,
        blocks_writes: false,
        rules_hit: []
      });
      continue;
    }

    // Transaction control statements
    if (isTxnBegin(sql)) {
      insideExplicitTxn = true;
      statements.push({
        sql,
        lock_mode: "UNKNOWN",
        blocks_reads: false,
        blocks_writes: false,
        rules_hit: []
      });
      continue;
    }
    if (isTxnEnd(sql)) {
      insideExplicitTxn = false;
      statements.push({
        sql,
        lock_mode: "UNKNOWN",
        blocks_reads: false,
        blocks_writes: false,
        rules_hit: []
      });
      continue;
    }

    // R002: Concurrent DDL inside explicit transaction block
    const conc = parseConcurrentDdl(sql);
    if (conc) {
      const hitRules: string[] = [];
      if (insideExplicitTxn) {
        hitRules.push("R002");
        violations.push({
          rule_id: "R002",
          severity: "red",
          message:
            `${conc.kind} cannot run inside a transaction block in Postgres; run outside a transaction or disable the migration transaction`
        });
      }
      statements.push({
        sql,
        lock_mode: "UNKNOWN",
        blocks_reads: false,
        blocks_writes: false,
        target: conc.target,
        rules_hit: hitRules
      });
      continue;
    }

    // R001: Non-concurrent CREATE INDEX
    const m = isCreateIndexNonConcurrent(sql);
    if (m) {
      const lockMode = lockModeForCreateIndexNonConcurrent();
      const tstats = findTableEstate(input.estate, m.table);
      const nLive = tstats?.n_live_tup;
      const hitRules: string[] = [];

      // Threshold from policy or default 10000
      const redRows = policy.rules?.R001?.red_rows ?? 10_000;
      if (typeof nLive === "number" && nLive >= redRows) {
        hitRules.push("R001");
        violations.push({
          rule_id: "R001",
          severity: "red",
          message: `CREATE INDEX without CONCURRENTLY on ${m.table ? m.table.name : "unknown"} (${formatRows(
            nLive
          )} rows) takes SHARE lock and may block writes`,
          remediation_sql: m.isUnique
            ? "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS <index_name> ON <table>(<col(s)>); -- note: cannot run inside a transaction block"
            : "CREATE INDEX CONCURRENTLY IF NOT EXISTS <index_name> ON <table>(<col(s)>); -- note: cannot run inside a transaction block",
          docs_url: "https://www.postgresql.org/docs/current/sql-createindex.html"
        });
      } else {
        // Even below threshold, still note lock mode in statement verdict
      }

      // R010: require lock_timeout for hot tables (size_gated)
      const hotRows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1_000_000;
      if (!priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] && typeof nLive === "number" && nLive >= hotRows) {
        hitRules.push("R010");
        violations.push({
          rule_id: "R010",
          severity: "red",
          message: `Missing lock_timeout for DDL on hot table ${m.table ? m.table.name : "unknown"} (${formatRows(
            nLive
          )} rows)`,
          remediation_sql: "SET lock_timeout = '3s';"
        });
      }

      // Estimated hold is approximate; simple stub range
      const est =
        typeof nLive === "number"
          ? { min: Math.max(1000, Math.floor(nLive / 2000)), max: Math.max(2000, Math.floor(nLive / 1000)) }
          : undefined;

      statements.push({
        sql,
        lock_mode: lockMode,
        blocks_reads: false,
        blocks_writes: true,
        target: m.table,
        n_live_tup: nLive,
        estimated_hold_ms: est,
        estimated_hold_label: est ? "approximate" : undefined,
        rules_hit: hitRules
      });
      continue;
    }

    // R004: ADD COLUMN on hot table without lock_timeout (nullable or constant default)
    const addCol = isAlterTableAddColumn(sql);
    if (addCol) {
      const tstats = findTableEstate(input.estate, addCol.table);
      const nLive = tstats?.n_live_tup;
      const hitRules: string[] = [];

      // R003: Volatile DEFAULT / identity / generated stored → rewrite on large estates (PG11+)
      const redRowsR003 = policy.rules?.R003?.red_rows ?? 100_000;
      const generatedStored = isGeneratedStored(sql) || isIdentityColumn(sql);
      let volatileDefault = false;
      if (addCol.hasDefault) {
        const defExpr = extractAddColumnDefaultExpression(sql);
        if (defExpr && !isConstantDefault(defExpr)) {
          volatileDefault = isVolatileDefault(defExpr);
        }
      }
      if (typeof nLive === "number" && nLive >= redRowsR003 && (generatedStored || volatileDefault)) {
        hitRules.push("R003");
        violations.push({
          rule_id: "R003",
          severity: "red",
          message: `ADD COLUMN with volatile DEFAULT rewrites table ${addCol.table ? addCol.table.name : "unknown"} (${formatRows(
            nLive
          )}) under ACCESS EXCLUSIVE lock`,
          remediation_sql:
            "ALTER TABLE <table> ADD COLUMN <col> <type> NULL; /* backfill in batches */ UPDATE <table> SET <col>=<value>; ALTER TABLE <table> ALTER COLUMN <col> SET DEFAULT <value>;",
          docs_url: "https://www.postgresql.org/docs/11/ddl-alter.html"
        });
      }
      const hotRows = policy.rules?.R004?.hot_rows ?? 1_000_000;
      if (!priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] && typeof nLive === "number" && nLive >= hotRows) {
        violations.push({
          rule_id: "R004",
          // Default: red floor at 1M rows for hot/lock_timeout rules
          severity: "red",
          message: `ADD COLUMN without lock_timeout on hot table ${addCol.table ? addCol.table.name : "unknown"} (${formatRows(
            nLive
          )} rows)`,
          remediation_sql: "SET lock_timeout = '3s';"
        });
        // Also emit R010 if policy wants generic lock_timeout on hot tables
        const r010Rows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? hotRows;
        if (typeof nLive === "number" && nLive >= r010Rows) {
          violations.push({
            rule_id: "R010",
            severity: "red",
            message: `Missing lock_timeout for DDL on hot table ${addCol.table ? addCol.table.name : "unknown"} (${formatRows(
              nLive
            )} rows)`,
            remediation_sql: "SET lock_timeout = '3s';"
          });
        }
      }
      statements.push({
        sql,
        lock_mode: "ACCESS EXCLUSIVE",
        blocks_reads: true,
        blocks_writes: true,
        target: addCol.table,
        n_live_tup: nLive,
        rules_hit: hitRules
      });
      continue;
    }

    // R006: ADD CHECK without NOT VALID
    const addCheck = isAddCheckConstraintWithoutNotValid(sql);
    if (addCheck) {
      const tstats = findTableEstate(input.estate, addCheck.table);
      const nLive = tstats?.n_live_tup;
      const redRows = policy.rules?.R006?.red_rows ?? 50_000;
      if (typeof nLive === "number" && nLive >= redRows) {
        violations.push({
          rule_id: "R006",
          severity: "red",
          message: `ADD CHECK without NOT VALID on ${addCheck.table ? addCheck.table.name : "unknown"} (${formatRows(
            nLive
          )} rows)`,
          remediation_sql:
            "ALTER TABLE <table> ADD CONSTRAINT <name> CHECK (<expr>) NOT VALID; ALTER TABLE <table> VALIDATE CONSTRAINT <name>;"
        });
        // Also R010 for hot tables without lock_timeout
        const r010Rows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1_000_000;
        if (!priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] && typeof nLive === "number" && nLive >= r010Rows) {
          violations.push({
            rule_id: "R010",
            severity: "red",
            message: `Missing lock_timeout for DDL on hot table ${addCheck.table ? addCheck.table.name : "unknown"} (${formatRows(
              nLive
            )} rows)`,
            remediation_sql: "SET lock_timeout = '3s';"
          });
        }
      }
      statements.push({
        sql,
        lock_mode: "ACCESS EXCLUSIVE",
        blocks_reads: true,
        blocks_writes: true,
        target: addCheck.table,
        n_live_tup: nLive,
        rules_hit: []
      });
      continue;
    }

    // R007: ADD FOREIGN KEY without NOT VALID (size-gated on referencing/child table)
    const addFk = isAddForeignKeyWithoutNotValid(sql);
    if (addFk) {
      const childStats = findTableEstate(input.estate, addFk.child);
      const parentStats = findTableEstate(input.estate, addFk.parent);
      const nLiveChild = childStats?.n_live_tup;
      const redRows = policy.rules?.R007?.red_rows ?? 100_000;
      if (typeof nLiveChild === "number" && nLiveChild >= redRows) {
        const childName = addFk.child ? addFk.child.name : "unknown";
        const parentNote =
          parentStats && typeof parentStats.n_live_tup === "number" && parentStats.n_live_tup >= redRows
            ? ` Note: referenced parent ${addFk.parent?.name ?? "unknown"} is also large (${formatRows(
                parentStats.n_live_tup
              )} rows).`
            : "";
        violations.push({
          rule_id: "R007",
          severity: "red",
          message: `ADD FOREIGN KEY without NOT VALID on ${childName} (${formatRows(
            nLiveChild
          )} rows) validates existing rows under a heavy lock.${parentNote} Prefer NOT VALID then VALIDATE CONSTRAINT (validation holds SHARE UPDATE EXCLUSIVE).`,
          remediation_sql:
            "ALTER TABLE <child> ADD CONSTRAINT <name> FOREIGN KEY (<col(s)>) REFERENCES <parent>(<col(s)>) NOT VALID; ALTER TABLE <child> VALIDATE CONSTRAINT <name>;"
        });
        // R010: generic hot DDL without prior lock_timeout
        const r010Rows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1_000_000;
        if (
          !priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] &&
          typeof nLiveChild === "number" &&
          nLiveChild >= r010Rows
        ) {
          violations.push({
            rule_id: "R010",
            severity: "red",
            message: `Missing lock_timeout for DDL on hot table ${childName} (${formatRows(nLiveChild)} rows)`,
            remediation_sql: "SET lock_timeout = '3s';"
          });
        }
      }
      statements.push({
        sql,
        lock_mode: "SHARE ROW EXCLUSIVE",
        blocks_reads: false,
        blocks_writes: true,
        target: addFk.child,
        n_live_tup: nLiveChild,
        rules_hit: []
      });
      continue;
    }

    // R005: SET NOT NULL without validated CHECK (size-gated)
    const setNotNull = isAlterTableSetNotNull(sql);
    if (setNotNull) {
      const tstats = findTableEstate(input.estate, setNotNull.table);
      const nLive = tstats?.n_live_tup;
      const redRows = policy.rules?.R005?.red_rows ?? 100_000;
      // Suppress/downgrade when expand/contract pattern is present in the same batch:
      //  ADD CONSTRAINT ... CHECK (<col> IS NOT NULL) NOT VALID; VALIDATE CONSTRAINT ...; then SET NOT NULL
      // Estate-only limitation: without a live DB we cannot see already-validated catalog CHECKs.
      const expandContractOk =
        hasExpandContractForNotNull(sqls, setNotNull.table, setNotNull.column, stmtIdx) === true;
      if (typeof nLive === "number" && nLive >= redRows && !expandContractOk) {
        violations.push({
          rule_id: "R005",
          severity: "red",
          message: `SET NOT NULL may scan/rewrite on ${setNotNull.table ? setNotNull.table.name : "unknown"} (${formatRows(
            nLive
          )} rows); remediate with NOT VALID CHECK → VALIDATE → SET NOT NULL`,
          remediation_sql:
            "ALTER TABLE <table> ADD CONSTRAINT <col>_nn CHECK (<col> IS NOT NULL) NOT VALID; ALTER TABLE <table> VALIDATE CONSTRAINT <col>_nn; ALTER TABLE <table> ALTER COLUMN <col> SET NOT NULL;"
        });
      }
      // R010: generic hot DDL without prior lock_timeout
      const r010Rows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1_000_000;
      if (!priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] && typeof nLive === "number" && nLive >= r010Rows) {
        violations.push({
          rule_id: "R010",
          severity: "red",
          message: `Missing lock_timeout for DDL on hot table ${setNotNull.table ? setNotNull.table.name : "unknown"} (${formatRows(
            nLive
          )} rows)`,
          remediation_sql: "SET lock_timeout = '3s';"
        });
      }
      statements.push({
        sql,
        lock_mode: "ACCESS EXCLUSIVE",
        blocks_reads: true,
        blocks_writes: true,
        target: setNotNull.table,
        n_live_tup: nLive,
        rules_hit: []
      });
      continue;
    }

    // R012: VACUUM FULL / CLUSTER / non-concurrent REINDEX
    const heavy = isVacuumFullOrClusterOrNonConcurrentReindex(sql);
    if (heavy) {
      violations.push({
        rule_id: "R012",
        severity: "red",
        message: `${heavy.kind} is not allowed in CI`
      });
      statements.push({
        sql,
        lock_mode: "ACCESS EXCLUSIVE",
        blocks_reads: true,
        blocks_writes: true,
        rules_hit: ["R012"]
      });
      continue;
    }

    // Unknown DDL → yellow
    statements.push({
      sql,
      lock_mode: "UNKNOWN",
      blocks_reads: false,
      blocks_writes: false,
      rules_hit: ["PARSE_UNKNOWN"]
    });
    violations.push({
      rule_id: "PARSE_UNKNOWN",
      severity: "yellow",
      message: "Unrecognized DDL — review manually; Nock refuses silent green"
    });
  }

  const failOn = policy.fail_on ?? "red";
  const hasRed = violations.some((v) => v.severity === "red");
  const hasYellow = violations.some((v) => v.severity === "yellow");
  const verdictFlag =
    failOn === "red" ? (hasRed ? "fail" : "pass") : hasRed || hasYellow ? "fail" : "pass";

  return {
    schema_version: "1",
    verdict: verdictFlag,
    statements,
    violations,
    meta: {
      pg_version: input.pgVersion ?? input.estate.pg_version,
      estate_captured_at: input.estate.captured_at,
      policy_id: policy.id,
      engine: "postgres"
    }
  };
}

