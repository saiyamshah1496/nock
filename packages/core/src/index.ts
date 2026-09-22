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
  // Optional write counters from pg_stat_user_tables; omitted when unavailable
  n_tup_ins?: number;
  n_tup_upd?: number;
  n_tup_del?: number;
  relation_bytes?: number;
  total_bytes?: number;
  /**
   * relkind from pg_class.relkind.
   * Common values:
   * - 'r' = ordinary table
   * - 'p' = partitioned table
   * - 'm' = materialized view
   */
  relkind?: string;
  /**
   * Replica identity from pg_class.relreplident:
   * - 'd' = DEFAULT (primary key)
   * - 'n' = NOTHING
   * - 'f' = FULL
   * - 'i' = INDEX
   */
  replica_identity?: "d" | "n" | "f" | "i";
  last_analyze?: string | null;
  last_autoanalyze?: string | null;
}

export interface EstateColumn {
  schema: string;
  table: string;
  column: string;
  not_null: boolean;
  type_name: string;
  /**
   * Presence-only signal; NEVER store default expression text.
   */
  has_default?: boolean;
}

export interface EstateConstraint {
  schema: string;
  table: string;
  name: string;
  /**
   * Mapped from pg_constraint.contype:
   * check|fk|pk|unique|exclude|...
   */
  kind: string;
  validated: boolean;
  columns: string[];
  /**
   * For FKs only. Qualified as "schema.table" to avoid extra fields.
   */
  foreign_table?: string;
  /**
   * For FKs only. Order matches columns[].
   */
  foreign_columns?: string[];
  /**
   * Optional: supporting index name (via conindid) when present.
   */
  supporting_index?: string;
}

export interface EstateIndex {
  schema: string;
  table: string;
  name: string;
  unique: boolean;
  primary: boolean;
  valid: boolean;
  ready: boolean;
  live: boolean;
  immediate: boolean;
  /**
   * Column names in order. For expression indexes, emit [] and DO NOT store expressions.
   */
  columns: string[];
  /**
   * True when this index is the replica identity (pg_index.indisreplident).
   */
  replica_identity?: boolean;
}

export interface EstateSnapshot {
  schema_version?: string;
  captured_at?: string;
  pg_version?: string;
  source?: string;
  tables: EstateTable[];
  /**
   * Governance catalogue sections (additive). Omitted key means "catalogue absent"
   * (fail-closed semantics for future catalogue-aware rules). Present-but-empty []
   * means "synced; none found".
   */
  columns?: EstateColumn[];
  constraints?: EstateConstraint[];
  indexes?: EstateIndex[];
}

export interface PolicyResolved {
  id: string;
  version?: string;
  fail_on: "red" | "yellow";
  require_lock_timeout?: "always" | "size_gated";
  /**
   * Per-rule configuration. Each rule entry may include arbitrary knobs
   * (thresholds, severities, etc.) and an optional enabled flag.
   * When enabled is explicitly set to false, the rule must be skipped.
   * When enabled is omitted, the rule remains enabled by default.
   */
  rules: Record<string, RuleConfig>;
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
    size_gates_neutralized?: boolean;
    policy_id: string;
    engine: "postgres";
  };
}

export interface CheckInput {
  sql: string | string[];
  estate: EstateSnapshot;
  policy: PolicyResolved;
  pgVersion?: string;
  /**
   * When set to "warn", treat size-gated rules as no-stats: any
   * red-size violations are downgraded to yellow so checks are neutral.
   * When "fail_closed", size-gated unknowns are escalated — currently
   * unused in product but kept for schema lock.
   */
  noStatsBehavior?: "warn" | "fail_closed";
  /**
   * Optional wall clock for tests; defaults to Date.now()
   */
  nowMs?: number;
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

/**
 * Rule configuration object. Keys are specific to each rule. The common
 * additive flag "enabled" disables the rule when set to false. Omitted
 * means enabled by default for backwards-compatibility.
 */
export type RuleConfig = {
  enabled?: boolean;
  [key: string]: any;
};

export interface PolicyPack {
  id: string;
  extends?: string;
  version: string;
  fail_on: "red" | "yellow";
  rules: Record<string, any>;
  require_lock_timeout?: "always" | "size_gated";
}

// Team thin-slice data-plane shared types/consts/helpers
export * from "./team/data-plane";

/**
 * Testable helper to distinguish omit vs empty semantics on catalogue sections.
 * Returns true only when the section key exists (even if []), and false when
 * the key is absent.
 */
export type EstateCatalogueSection = "columns" | "constraints" | "indexes";
export function hasCatalogueSection(snapshot: EstateSnapshot, section: EstateCatalogueSection): boolean {
  return Object.prototype.hasOwnProperty.call(snapshot, section);
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

// Check if an index exists on the given table whose column list begins with (prefix/equal) the wanted columns.
// Requires indexes catalogue section to be present to avoid inventing matches.
function hasSupportingIndexPrefix(
  snapshot: EstateSnapshot,
  table: TableRef | undefined,
  wantColumns: string[] | undefined
): boolean {
  if (!table || !wantColumns || wantColumns.length === 0) return false;
  if (!hasCatalogueSection(snapshot, "indexes")) return false; // fail-closed when catalogue omitted
  const schemaLc = table.schema.toLowerCase();
  const nameLc = table.name.toLowerCase();
  const want = wantColumns.map((c) => c.toLowerCase());
  return (snapshot.indexes ?? []).some((idx) => {
    if (!idx) return false;
    if (idx.schema.toLowerCase() !== schemaLc || idx.table.toLowerCase() !== nameLc) return false;
    // Supporting index must be valid/ready to be useful during enforcement
    if (!(idx.valid && idx.ready)) return false;
    const cols = (idx.columns ?? []).map((c) => c.toLowerCase());
    if (cols.length < want.length || cols.length === 0) return false;
    for (let i = 0; i < want.length; i++) {
      if (cols[i] !== want[i]) return false;
    }
    return true;
  });
}

function formatRows(n?: number): string {
  if (!n && n !== 0) return "?";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "k";
  return String(n);
}

// R025 helper — write-heavy index cost on large tables
function evaluateR025WriteHeaviness(
  estate: EstateSnapshot,
  policy: PolicyResolved,
  table: TableRef | undefined
): Violation[] {
  const results: Violation[] = [];
  if (!table) return results;
  const tstats = findTableEstate(estate, table);
  if (!tstats) return results; // neutralize when table absent from estate
  const nIns = typeof tstats.n_tup_ins === "number" ? tstats.n_tup_ins : undefined;
  const nUpd = typeof tstats.n_tup_upd === "number" ? tstats.n_tup_upd : undefined;
  const nDel = typeof tstats.n_tup_del === "number" ? tstats.n_tup_del : undefined;
  // When all counters are missing, neutralize
  if (typeof nIns !== "number" && typeof nUpd !== "number" && typeof nDel !== "number") return results;
  const writeSum =
    (typeof nIns === "number" ? nIns : 0) +
    (typeof nUpd === "number" ? nUpd : 0) +
    (typeof nDel === "number" ? nDel : 0);
  const yellowWrites = policy.rules?.R025?.yellow_writes ?? 100_000;
  const redWrites = policy.rules?.R025?.red_writes ?? 1_000_000;
  const nLiveRows = tstats?.n_live_tup;
  const largeRows = policy.rules?.R025?.large_rows ?? 100_000;
  const largeRelBytes = policy.rules?.R025?.large_relation_bytes ?? 64 * 1024 * 1024; // 64MiB
  const hasRowCount = typeof nLiveRows === "number" && nLiveRows > 0;
  const isLarge = hasRowCount ? (nLiveRows as number) >= largeRows : (tstats?.relation_bytes ?? 0) >= largeRelBytes;
  if (writeSum >= redWrites && isLarge) {
    const sevKnob = (policy.rules?.R025 as any)?.severity;
    const sev: "red" | "yellow" = sevKnob === "yellow" ? "yellow" : "red";
    const rowsText = hasRowCount
      ? `~${formatRows(nLiveRows)} rows`
      : `~${Math.floor((tstats?.relation_bytes ?? 0) / (1024 * 1024))}MiB`;
    results.push({
      rule_id: "R025",
      severity: sev,
      message: `R025: ${table.schema}.${table.name} is write-heavy (~${formatRows(
        writeSum
      )} writes since stats reset) and ${rowsText}; another index increases write maintenance on each insert/update/delete.`
    });
  } else if (writeSum >= yellowWrites) {
    results.push({
      rule_id: "R025",
      severity: "yellow",
      message: `R025: ${table.schema}.${table.name} is write-heavy (~${formatRows(
        writeSum
      )} writes); consider index cost on hot write paths.`
    });
  }
  return results;
}

// R024 helper — shared between CIC and non-CIC CREATE INDEX paths
function evaluateR024IndexDensity(
  estate: EstateSnapshot,
  policy: PolicyResolved,
  table: TableRef | undefined,
  candidateIndexName?: string
): Violation[] {
  const results: Violation[] = [];
  if (!table) return results;
  if (!hasCatalogueSection(estate, "indexes")) return results; // neutralize when indexes section omitted
  const tstats = findTableEstate(estate, table);
  const nLiveRows = tstats?.n_live_tup;
  const largeRows = policy.rules?.R024?.large_rows ?? 100_000;
  const largeRelBytes = policy.rules?.R024?.large_relation_bytes ?? 64 * 1024 * 1024; // 64MiB
  const hasRowCount = typeof nLiveRows === "number" && nLiveRows > 0;
  const isLarge = hasRowCount ? (nLiveRows as number) >= largeRows : (tstats?.relation_bytes ?? 0) >= largeRelBytes;
  if (!isLarge) return results;
  const schemaLc = table.schema.toLowerCase();
  const nameLc = table.name.toLowerCase();
  const candidateNameLc = candidateIndexName ? candidateIndexName.toLowerCase() : undefined;
  const idxs = (estate.indexes ?? []).filter(
    (ix) =>
      ix &&
      ix.schema.toLowerCase() === schemaLc &&
      ix.table.toLowerCase() === nameLc &&
      // only count live, non-invalid (valid/ready not false)
      ix.live === true &&
      ix.valid !== false &&
      ix.ready !== false &&
      // exclude the index being created if name matches exactly
      (!candidateNameLc || ix.name.toLowerCase() !== candidateNameLc)
  );
  const indexCount = idxs.length;
  const maxIdx = policy.rules?.R024?.max_indexes_large ?? 8;
  if (indexCount >= maxIdx) {
    const sevKnob = (policy.rules?.R024 as any)?.severity;
    const sev: "red" | "yellow" = sevKnob === "yellow" ? "yellow" : "red";
    const rowsText = hasRowCount
      ? `~${formatRows(nLiveRows)} rows`
      : `~${Math.floor((tstats?.relation_bytes ?? 0) / (1024 * 1024))}MiB`;
    results.push({
      rule_id: "R024",
      severity: sev,
      message: `R024: ${table.schema}.${table.name} already has ${indexCount} indexes and ${rowsText}; another index increases write cost on every insert/update. Raise policy max_indexes_large or drop an unused index first.`
    });
  }
  return results;
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

// R007 — ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... without NOT VALID
function parseAddForeignKeyWithoutNotValid(sql: string): { table?: TableRef; columns?: string[] } | null {
  const clean = stripSqlComments(sql);
  if (!/ALTER\s+TABLE/i.test(clean)) return null;
  if (!/\bADD\s+CONSTRAINT\b/i.test(clean)) return null;
  if (!/\bFOREIGN\s+KEY\b/i.test(clean)) return null;
  if (/\bNOT\s+VALID\b/i.test(clean)) return null; // safe path
  const tm = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const fq = tm?.[1]?.replace(/"/g, "");
  if (!fq) return { table: undefined, columns: undefined };
  const parts = fq.split(".");
  const table: TableRef = parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
  // Extract child columns inside FOREIGN KEY(...)
  let columns: string[] | undefined = undefined;
  const cm = /\bFOREIGN\s+KEY\s*\(([^)]+)\)/i.exec(clean);
  if (cm?.[1]) {
    columns = cm[1]
      .split(",")
      .map((s) => s.replace(/"/g, "").trim())
      .filter((s) => s.length > 0);
  }
  return { table, columns };
}

// R008 — ALTER TABLE ... ALTER COLUMN ... TYPE ...
function parseAlterColumnType(sql: string): { table?: TableRef; column?: string; newType?: string; hasUsing: boolean } | null {
  const clean = stripSqlComments(sql);
  const m =
    /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)\s+ALTER\s+(?:COLUMN\s+)?([A-Za-z0-9_".]+)\s+TYPE\s+([A-Za-z0-9_\s()"',]+?)(?:\s+USING\b|\s*$)/i.exec(
      clean.trim()
    );
  if (!m) return null;
  const fq = m[1].replace(/"/g, "");
  const parts = fq.split(".");
  const table: TableRef = parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
  const column = m[2]?.replace(/"/g, "");
  const newType = m[3]?.trim();
  const hasUsing = /\bUSING\b/i.test(clean);
  return { table, column, newType, hasUsing };
}

// Heuristic: binary-coercible widen (varchar(n)->varchar(m≥n), varchar->text) — assume safe, skip
function isLikelyBinaryCoercibleWiden(newType?: string, hasUsing?: boolean): boolean {
  if (!newType || hasUsing) return false;
  // Only treat clearly text-family targets as safe widen; everything else is unknown
  const up = newType.toUpperCase().replace(/\s+/g, " ").trim();
  // TEXT is binary-coercible with (unlimited) VARCHAR in Postgres
  if (up === "TEXT") return true;
  // CHARACTER VARYING / VARCHAR WITHOUT LENGTH ONLY — cannot assume safety for lengthed targets without catalogue
  if (/^CHARACTER\s+VARYING$/.test(up)) return true;
  if (/^VARCHAR$/.test(up)) return true;
  return false;
}

// Parse DROP CONSTRAINT name for R009 deepen
function parseDropConstraint(sql: string): { table?: TableRef; constraint?: string } | null {
  const clean = stripSqlComments(sql);
  if (!/ALTER\s+TABLE/i.test(clean) || !/\bDROP\s+CONSTRAINT\b/i.test(clean)) return null;
  const tm = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const cm = /\bDROP\s+CONSTRAINT\s+([A-Za-z0-9_".]+)/i.exec(clean);
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

// Parse DROP COLUMN details for R009 deepen
function parseDropColumn(sql: string): { table?: TableRef; column?: string } | null {
  const clean = stripSqlComments(sql);
  if (!/ALTER\s+TABLE/i.test(clean) || !/\bDROP\s+COLUMN\b/i.test(clean)) return null;
  const tm = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const cm = /\bDROP\s+COLUMN\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const fq = tm?.[1]?.replace(/"/g, "");
  const parts = fq ? fq.split(".") : [];
  const table: TableRef | undefined = fq
    ? parts.length === 2
      ? { schema: parts[0], name: parts[1] }
      : { schema: "public", name: parts[0] }
    : undefined;
  const column = cm?.[1]?.replace(/"/g, "");
  return { table, column };
}

// Normalize type strings to canonical forms (helpers for R008 deepen)
function normalizeTypeName(t?: string): { base: string; length?: number } {
  const raw = (t ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  // varchar / character varying
  const vm = /^(character varying|varchar)\s*(?:\(\s*(\d+)\s*\))?$/.exec(raw);
  if (vm) {
    const len = vm[2] ? Number(vm[2]) : undefined;
    return { base: "varchar", length: Number.isFinite(len) ? (len as number) : undefined };
  }
  if (raw === "text") return { base: "text" };
  if (raw === "integer" || raw === "int4") return { base: "int4" };
  if (raw === "bigint" || raw === "int8") return { base: "int8" };
  if (raw === "smallint" || raw === "int2") return { base: "int2" };
  if (raw === "real" || raw === "float4") return { base: "float4" };
  if (raw === "double precision" || raw === "float8") return { base: "float8" };
  // numeric/decimal typmods are rewrite-prone — keep base distinct to avoid false softens
  if (raw.startsWith("numeric") || raw.startsWith("decimal")) return { base: "numeric" };
  return { base: raw };
}

function isCatalogueSafeWiden(sourceType?: string, targetType?: string): boolean {
  if (!sourceType || !targetType) return false;
  const src = normalizeTypeName(sourceType);
  const dst = normalizeTypeName(targetType);
  // varchar(n) -> varchar(m>=n) or -> text or -> varchar (unbounded)
  if (src.base === "varchar" && dst.base === "text") return true;
  if (src.base === "varchar" && dst.base === "varchar") {
    const srcLen = src.length;
    const dstLen = dst.length;
    // if target unspecified length, treat as unbounded → safe widen
    if (dstLen === undefined) return true;
    if (typeof srcLen === "number" && dstLen >= srcLen) return true;
  }
  return false;
}
// R013 — REFRESH MATERIALIZED VIEW without CONCURRENTLY
function parseRefreshMatviewNonConcurrent(sql: string): { view?: TableRef } | null {
  const clean = stripSqlComments(sql);
  const up = clean.toUpperCase();
  if (!up.startsWith("REFRESH MATERIALIZED VIEW")) return null;
  if (/\bCONCURRENTLY\b/i.test(up)) return null;
  const m = /REFRESH\s+MATERIALIZED\s+VIEW\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_".]+)/i.exec(clean);
  const fq = m?.[1]?.replace(/"/g, "");
  if (!fq) return { view: undefined };
  const parts = fq.split(".");
  const view: TableRef = parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
  return { view };
}

// R014 — ATTACH/DETACH PARTITION
function parseAttachOrDetachPartition(
  sql: string
): { action: "ATTACH" | "DETACH"; parent?: TableRef; child?: TableRef; concurrently?: boolean } | null {
  const clean = stripSqlComments(sql);
  const up = clean.toUpperCase();
  if (!up.startsWith("ALTER TABLE")) return null;
  // ALTER TABLE <parent> ATTACH PARTITION <child> ...
  let m =
    /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)\s+ATTACH\s+PARTITION\s+([A-Za-z0-9_".]+)/i.exec(clean);
  if (m) {
    const pfq = m[1].replace(/"/g, "");
    const cfx = m[2].replace(/"/g, "");
    const pparts = pfq.split(".");
    const cparts = cfx.split(".");
    const parent: TableRef =
      pparts.length === 2 ? { schema: pparts[0], name: pparts[1] } : { schema: "public", name: pparts[0] };
    const child: TableRef =
      cparts.length === 2 ? { schema: cparts[0], name: cparts[1] } : { schema: "public", name: cparts[0] };
    return { action: "ATTACH", parent, child, concurrently: false };
  }
  // ALTER TABLE <parent> DETACH PARTITION <child>
  m = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)\s+DETACH\s+PARTITION\s+([A-Za-z0-9_".]+)(?:\s+CONCURRENTLY\b)?/i.exec(
    clean
  );
  if (m) {
    const pfq = m[1].replace(/"/g, "");
    const cfx = m[2].replace(/"/g, "");
    const pparts = pfq.split(".");
    const cparts = cfx.split(".");
    const parent: TableRef =
      pparts.length === 2 ? { schema: pparts[0], name: pparts[1] } : { schema: "public", name: pparts[0] };
    const child: TableRef =
      cparts.length === 2 ? { schema: cparts[0], name: cparts[1] } : { schema: "public", name: cparts[0] };
    const concurrently = /\bDETACH\s+PARTITION\s+[A-Za-z0-9_".]+\s+CONCURRENTLY\b/i.test(clean);
    return { action: "DETACH", parent, child, concurrently };
  }
  return null;
}

// R015 / R021 helpers for CIC
function parseCreateIndexConcurrently(sql: string): { table?: TableRef; indexName?: string } | null {
  const clean = stripSqlComments(sql);
  const m =
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_"]+)?\s*ON\s+([A-Za-z0-9_".]+)/i.exec(
      clean
    );
  if (!m) return null;
  const indexName = m[1]?.replace(/"/g, "");
  const fq = m[2]?.replace(/"/g, "");
  let table: TableRef | undefined = undefined;
  if (fq) {
    const parts = fq.split(".");
    table = parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
  }
  return { table, indexName };
}

// R017 — ADD UNIQUE/PRIMARY KEY without USING INDEX
function parseAddUniqueOrPrimaryKeyWithoutUsingIndex(
  sql: string
): { table?: TableRef; kind: "UNIQUE" | "PRIMARY KEY"; columns?: string[] } | null {
  const clean = stripSqlComments(sql);
  if (!/ALTER\s+TABLE/i.test(clean)) return null;
  if (!/\bADD\s+CONSTRAINT\b/i.test(clean)) return null;
  if (/\bUSING\s+INDEX\b/i.test(clean)) return null; // safe path
  const isPk = /\bPRIMARY\s+KEY\b/i.test(clean);
  const isUnique = /\bUNIQUE\b/i.test(clean);
  if (!isPk && !isUnique) return null;
  const tm = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const fq = tm?.[1]?.replace(/"/g, "");
  const parts = fq ? fq.split(".") : [];
  const table = fq
    ? parts.length === 2
      ? { schema: parts[0], name: parts[1] }
      : { schema: "public", name: parts[0] }
    : undefined;
  // Try to extract the constrained columns: handle either PRIMARY KEY (...) or UNIQUE (...)
  let cols: string[] | undefined = undefined;
  const cm =
    /\bPRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(clean) ||
    /\bUNIQUE\s*\(([^)]+)\)/i.exec(clean);
  if (cm?.[1]) {
    cols = cm[1]
      .split(",")
      .map((s) => s.replace(/"/g, "").trim())
      .filter((s) => s.length > 0);
  }
  return isPk ? { table, kind: "PRIMARY KEY", columns: cols } : { table, kind: "UNIQUE", columns: cols };
}

// R018 — ADD EXCLUDE constraint
function parseAddExcludeConstraint(sql: string): { table?: TableRef } | null {
  const clean = stripSqlComments(sql);
  if (!/ALTER\s+TABLE/i.test(clean)) return null;
  if (!/\bADD\s+(CONSTRAINT\s+[A-Za-z0-9_".]+\s+)?EXCLUDE\b/i.test(clean)) return null;
  const tm = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const fq = tm?.[1]?.replace(/"/g, "");
  if (!fq) return { table: undefined };
  const parts = fq.split(".");
  const table: TableRef = parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
  return { table };
}

// R019 — TRUNCATE on estate table
function parseTruncate(sql: string): { table?: TableRef } | null {
  const clean = stripSqlComments(sql);
  const m = /TRUNCATE\s+(TABLE\s+)?([A-Za-z0-9_".]+)/i.exec(clean);
  if (!m) return null;
  const fq = m[2]?.replace(/"/g, "");
  if (!fq) return { table: undefined };
  const parts = fq.split(".");
  const table: TableRef = parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
  return { table };
}

// R009 — DROP/RENAME helpers
function parseDropRename(sql: string):
  | { kind: "DROP COLUMN" | "RENAME COLUMN" | "RENAME TABLE" | "DROP CONSTRAINT"; table?: TableRef } | null {
  const clean = stripSqlComments(sql);
  if (!/ALTER\s+TABLE/i.test(clean)) return null;
  const tm = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)/i.exec(clean);
  const fq = tm?.[1]?.replace(/"/g, "");
  const table = fq
    ? fq.split(".").length === 2
      ? { schema: fq.split(".")[0], name: fq.split(".")[1] }
      : { schema: "public", name: fq }
    : undefined;
  if (/\bDROP\s+COLUMN\b/i.test(clean)) return { kind: "DROP COLUMN", table };
  if (/\bRENAME\s+COLUMN\b/i.test(clean)) return { kind: "RENAME COLUMN", table };
  if (/\bRENAME\s+TO\b/i.test(clean)) return { kind: "RENAME TABLE", table };
  if (/\bDROP\s+CONSTRAINT\b/i.test(clean)) return { kind: "DROP CONSTRAINT", table };
  return null;
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
  const nowMs = typeof input.nowMs === "number" ? input.nowMs : Date.now();
  const capturedAtMs = input.estate?.captured_at ? Date.parse(String(input.estate.captured_at)) : NaN;
  const estateAgeHours = Number.isFinite(capturedAtMs) ? Math.max(0, Math.round((nowMs - capturedAtMs) / 3600000)) : undefined;
  const sizeGatesNeutralized = input.noStatsBehavior === "warn";

  const sqls = Array.isArray(input.sql)
    ? input.sql.flatMap((s) => splitSqlStatements(s))
    : splitSqlStatements(input.sql);
  const statements: StatementVerdict[] = [];
  const violations: Violation[] = [];
  const policy = input.policy;

  // Helper: rule enabled check. Omitted => enabled.
  const isRuleEnabled = (ruleId: string): boolean => {
    const cfg = policy?.rules?.[ruleId] as RuleConfig | undefined;
    if (cfg && Object.prototype.hasOwnProperty.call(cfg, "enabled")) {
      return cfg.enabled !== false;
    }
    return true;
  };

  // Track if a lock_timeout was set earlier in this batch
  const priorLockTimeoutFlags: boolean[] = [];
  let seenLockTimeout = false;
  // Track explicit transaction blocks (BEGIN/START TRANSACTION ... COMMIT/ROLLBACK/END)
  let insideExplicitTxn = false;
  // Track ACCESS EXCLUSIVE lock-taking statements by table (for R016)
  const aeOpsByTable: Record<string, number[]> = {};

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

    // R022 — VALIDATE CONSTRAINT on hot table (size-gated; catalogue-aware suppression when already validated)
    const vc = parseValidateConstraint(sql);
    if (vc) {
      // Resolve target table: prefer catalogue constraint match when present; else rely on SQL parse
      let target: TableRef | undefined = vc.table;
      let alreadyValidated = false;
      if (hasCatalogueSection(input.estate, "constraints") && vc.constraint) {
        const k = (input.estate.constraints ?? []).find(
          (c) => c && c.name.toLowerCase() === String(vc.constraint).toLowerCase()
        );
        if (k) {
          target = { schema: k.schema, name: k.table };
          alreadyValidated = k.validated === true;
        }
      }
      const tstats = findTableEstate(input.estate, target);
      const nLive = tstats?.n_live_tup;
      const yellowRows = policy.rules?.R022?.yellow_rows ?? 10_000;
      const redRows = policy.rules?.R022?.red_rows ?? 100_000;
      if (isRuleEnabled("R022") && !alreadyValidated) {
        let sev: "red" | "yellow" | undefined = undefined;
        if (typeof nLive === "number") {
          if (nLive >= redRows) sev = "red";
          else if (nLive >= yellowRows) sev = "yellow";
        } else {
          // Unknown size — warn by default
          sev = "yellow";
        }
        if (sev) {
          violations.push({
            rule_id: "R022",
            severity: sev,
            message: `VALIDATE CONSTRAINT on ${target ? target.name : "unknown"} (${formatRows(
              nLive
            )} rows) may scan table; prefer off-peak or split`
          });
        }
      }
      statements.push({
        sql,
        lock_mode: "SHARE UPDATE EXCLUSIVE",
        blocks_reads: false,
        blocks_writes: true,
        target,
        n_live_tup: nLive,
        rules_hit: []
      });
      continue;
    }

    // R007: ADD FOREIGN KEY without NOT VALID (size-gated)
    const addFk = parseAddForeignKeyWithoutNotValid(sql);
    if (addFk) {
      const tstats = findTableEstate(input.estate, addFk.table);
      const nLive = tstats?.n_live_tup;
      const redRows = policy.rules?.R007?.red_rows ?? 100_000;
      if (isRuleEnabled("R007")) {
        if (typeof nLive === "number" && nLive >= redRows) {
          violations.push({
            rule_id: "R007",
            severity: "red",
            message: `ADD FOREIGN KEY without NOT VALID on ${addFk.table ? addFk.table.name : "unknown"} (${formatRows(
              nLive
            )} rows)`,
            remediation_sql:
              "ALTER TABLE <child> ADD CONSTRAINT <name> FOREIGN KEY (<col>) REFERENCES <parent>(<col>) NOT VALID; ALTER TABLE <child> VALIDATE CONSTRAINT <name>;"
          });
        }
        // Extra catalogue arm: warn when no supporting index covers the FK columns on the child table
        const catPresent =
          hasCatalogueSection(input.estate, "constraints") && hasCatalogueSection(input.estate, "indexes");
        if (catPresent && addFk.table && addFk.columns && addFk.columns.length > 0) {
          const hasSupport = hasSupportingIndexPrefix(input.estate, addFk.table, addFk.columns);
          if (!hasSupport) {
            violations.push({
              rule_id: "R007",
              severity: "yellow",
              message: `ADD FOREIGN KEY without supporting index on ${addFk.table.name}(${addFk.columns.join(
                ", "
              )}) — add covering index`,
              remediation_sql: `CREATE INDEX CONCURRENTLY ON ${addFk.table.schema}.${addFk.table.name}(${addFk.columns.join(
                ", "
              )});`
            });
          }
        }
      }
      // R010: generic hot DDL without prior lock_timeout
      {
        const r010Rows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1_000_000;
        if (
          isRuleEnabled("R010") &&
          !priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] &&
          typeof nLive === "number" &&
          nLive >= r010Rows
        ) {
          violations.push({
            rule_id: "R010",
            severity: "red",
            message: `Missing lock_timeout for DDL on hot table ${addFk.table ? addFk.table.name : "unknown"} (${formatRows(
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
        target: addFk.table,
        n_live_tup: nLive,
        rules_hit: []
      });
      if (addFk.table) {
        const key = `${addFk.table.schema.toLowerCase()}.${addFk.table.name.toLowerCase()}`;
        aeOpsByTable[key] = aeOpsByTable[key] || [];
        aeOpsByTable[key].push(stmtIdx);
      }
      continue;
    }

    // R008: ALTER COLUMN TYPE (rewrite-likely or unknown coercibility)
    const alterType = parseAlterColumnType(sql);
    if (alterType) {
      const tstats = findTableEstate(input.estate, alterType.table);
      const nLive = tstats?.n_live_tup;
      const redRows = policy.rules?.R008?.red_rows ?? 10_000;
      const newTypeUp = (alterType.newType ?? "").toUpperCase();
      const binaryWiden = isLikelyBinaryCoercibleWiden(alterType.newType, alterType.hasUsing);
      if (!binaryWiden && isRuleEnabled("R008")) {
        // Catalogue-aware soften for known-safe widens relative to estate type_name
        let softenedByCatalogue = false;
        const softenKnob =
          (policy.rules?.R008 && Object.prototype.hasOwnProperty.call(policy.rules.R008, "soften_with_catalogue"))
            ? Boolean((policy.rules.R008 as any).soften_with_catalogue)
            : true;
        if (softenKnob && hasCatalogueSection(input.estate, "columns") && alterType.table && alterType.column) {
          const schemaLc = alterType.table.schema.toLowerCase();
          const nameLc = alterType.table.name.toLowerCase();
          const colLc = alterType.column.toLowerCase();
          const colEnt = (input.estate.columns ?? []).find(
            (c) =>
              c.schema.toLowerCase() === schemaLc &&
              c.table.toLowerCase() === nameLc &&
              c.column.toLowerCase() === colLc
          );
          if (colEnt && isCatalogueSafeWiden(colEnt.type_name, alterType.newType)) {
            softenedByCatalogue = true;
          }
        }
        // Clear rewrite cases: explicit USING, integer-width changes, JSONB, numeric/decimal typmod changes
        const clearlyRewrite =
          alterType.hasUsing ||
          /\b(INT2|INT4|INT8|SMALLINT|INTEGER|BIGINT)\b/.test(newTypeUp) ||
          /\bJSONB\b/.test(newTypeUp) ||
          /\bNUMERIC\s*\(/.test(newTypeUp) ||
          /\bDECIMAL\s*\(/.test(newTypeUp);
        const severity: "red" | "yellow" =
          clearlyRewrite && typeof nLive === "number" && nLive >= redRows ? "red" : "yellow";
        if (!softenedByCatalogue) {
          violations.push({
            rule_id: "R008",
            severity,
            message: `ALTER COLUMN TYPE on ${alterType.table ? alterType.table.name : "unknown"} (${formatRows(
              nLive
            )} rows) may rewrite; prefer online patterns`
          });
        }
      }
      // R010: generic hot DDL without prior lock_timeout
      {
        const r010Rows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1_000_000;
        if (
          isRuleEnabled("R010") &&
          !priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] &&
          typeof nLive === "number" &&
          nLive >= r010Rows
        ) {
          violations.push({
            rule_id: "R010",
            severity: "red",
            message: `Missing lock_timeout for DDL on hot table ${alterType.table ? alterType.table.name : "unknown"} (${formatRows(
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
        target: alterType.table,
        n_live_tup: nLive,
        rules_hit: []
      });
      if (alterType.table) {
        const key = `${alterType.table.schema.toLowerCase()}.${alterType.table.name.toLowerCase()}`;
        aeOpsByTable[key] = aeOpsByTable[key] || [];
        aeOpsByTable[key].push(stmtIdx);
      }
      continue;
    }

    // R013: REFRESH MATERIALIZED VIEW without CONCURRENTLY
    const refresh = parseRefreshMatviewNonConcurrent(sql);
    if (refresh) {
      const tstats = findTableEstate(input.estate, refresh.view);
      const nLive = tstats?.n_live_tup;
      const redRows = policy.rules?.R013?.red_rows ?? 10_000;
      if (isRuleEnabled("R013")) {
        if (typeof nLive === "number") {
          if (nLive >= redRows) {
            violations.push({
              rule_id: "R013",
              severity: "red",
              message: `REFRESH MATERIALIZED VIEW without CONCURRENTLY on ${refresh.view ? refresh.view.name : "unknown"} (${formatRows(
                nLive
              )} rows) blocks reads/writes`
            });
          } else {
            violations.push({
              rule_id: "R013",
              severity: "yellow",
              message: `REFRESH MATERIALIZED VIEW without CONCURRENTLY on small view ${refresh.view ? refresh.view.name : "unknown"} (${formatRows(
                nLive
              )} rows)`
            });
          }
        } else {
          violations.push({
            rule_id: "R013",
            severity: "yellow",
            message: "REFRESH MATERIALIZED VIEW without CONCURRENTLY (size unknown)"
          });
        }
      }
      statements.push({
        sql,
        lock_mode: "ACCESS EXCLUSIVE",
        blocks_reads: true,
        blocks_writes: true,
        target: refresh.view,
        n_live_tup: nLive,
        rules_hit: []
      });
      continue;
    }

    // R014: ATTACH/DETACH PARTITION — risk size-gated
    const part = parseAttachOrDetachPartition(sql);
    if (part) {
      const pstats = findTableEstate(input.estate, part.parent);
      const cstats = findTableEstate(input.estate, part.child);
      const nLiveParent = pstats?.n_live_tup;
      const nLiveChild = cstats?.n_live_tup;
      const nLive = Math.max(nLiveParent ?? 0, nLiveChild ?? 0) || undefined;
      const redRows = policy.rules?.R014?.red_rows ?? 100_000;
      let sev: "red" | "yellow" = "yellow";
      if (isRuleEnabled("R014")) {
        if (part.action === "DETACH") {
          // DETACH without CONCURRENTLY on a hot parent is riskier (blocks scans)
          if (!part.concurrently && typeof nLiveParent === "number" && nLiveParent >= redRows) {
            sev = "red";
          } else {
            sev = "yellow";
          }
        } else {
          // ATTACH is usually routine when constraints match; keep yellow even on large estates
          sev = "yellow";
        }
        violations.push({
          rule_id: "R014",
          severity: sev,
          message:
            part.action === "DETACH" && part.concurrently
              ? `DETACH PARTITION CONCURRENTLY reduces blocking on ${part.parent ? part.parent.name : "unknown"} (${formatRows(
                  nLiveParent
                )} rows)`
              : `${part.action} PARTITION may lock/scan parent/child ${part.parent ? part.parent.name : "unknown"} (${formatRows(
                  nLive
                )} rows)`
        });
      }
      statements.push({
        sql,
        lock_mode: "ACCESS EXCLUSIVE",
        blocks_reads: true,
        blocks_writes: true,
        target: part.parent ?? part.child,
        n_live_tup: nLive,
        rules_hit: []
      });
      const t = part.parent ?? part.child;
      if (t) {
        const key = `${t.schema.toLowerCase()}.${t.name.toLowerCase()}`;
        aeOpsByTable[key] = aeOpsByTable[key] || [];
        aeOpsByTable[key].push(stmtIdx);
      }
      continue;
    }

    // R015: CREATE INDEX CONCURRENTLY without prior lock_timeout on hot tables, and R021 name advisory
    const cic = parseCreateIndexConcurrently(sql);
    if (cic && !insideExplicitTxn) {
      const tstats = findTableEstate(input.estate, cic.table);
      const nLive = tstats?.n_live_tup;
      const hotRows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1_000_000;
      const yellowRows = policy.rules?.R015?.yellow_rows ?? 100_000;
      if (!priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1]) {
        if (isRuleEnabled("R015")) {
          if (typeof nLive === "number" && nLive >= hotRows) {
            violations.push({
              rule_id: "R015",
              severity: "red",
              message: `CREATE INDEX CONCURRENTLY without lock_timeout on hot table ${cic.table ? cic.table.name : "unknown"} (${formatRows(
                nLive
              )} rows)`,
              remediation_sql: "SET lock_timeout = '3s'; -- before CIC"
            });
          } else if (typeof nLive === "number" && nLive >= yellowRows) {
            violations.push({
              rule_id: "R015",
              severity: "yellow",
              message: `CREATE INDEX CONCURRENTLY without lock_timeout on ${cic.table ? cic.table.name : "unknown"} (${formatRows(
                nLive
              )} rows)`
            });
          }
        }
      }
      // R024 — Index density on large tables (catalogue-aware, size-gated)
      if (isRuleEnabled("R024") && cic.table) {
        const r024 = evaluateR024IndexDensity(input.estate, policy, cic.table, cic.indexName);
        if (r024.length > 0) violations.push(...r024);
      }
      // R025 — Write-heavy index maintenance cost (size/write-gated)
      if (isRuleEnabled("R025") && cic.table) {
        const r025 = evaluateR025WriteHeaviness(input.estate, policy, cic.table);
        if (r025.length > 0) violations.push(...r025);
      }
      if (isRuleEnabled("R021") && (!cic.indexName || cic.indexName.length === 0)) {
        violations.push({
          rule_id: "R021",
          severity: "yellow",
          message:
            "CREATE INDEX CONCURRENTLY without explicit index name — failed CIC can leave an invalid, hard-to-drop index; name indexes explicitly"
        });
      }
      statements.push({
        sql,
        lock_mode: "UNKNOWN",
        blocks_reads: false,
        blocks_writes: false,
        target: cic.table,
        n_live_tup: nLive,
        rules_hit: []
      });
      continue;
    }

    // R017: ADD UNIQUE/PRIMARY KEY without USING INDEX
    const uniq = parseAddUniqueOrPrimaryKeyWithoutUsingIndex(sql);
    if (uniq) {
      const tstats = findTableEstate(input.estate, uniq.table);
      const nLive = tstats?.n_live_tup;
      const redRows = policy.rules?.R017?.red_rows ?? 10_000;
      if (isRuleEnabled("R017")) {
        const wouldBeRed = typeof nLive === "number" && nLive >= redRows;
        let suppressedByCatalogue = false;
        // Catalogue-aware suppression: only for would-be red hits, never for yellow
        if (wouldBeRed && hasCatalogueSection(input.estate, "indexes") && uniq.table && uniq.columns && uniq.columns.length > 0) {
          const tkeySchema = uniq.table.schema.toLowerCase();
          const tkeyName = uniq.table.name.toLowerCase();
          const want = uniq.columns.map((c) => c.toLowerCase());
          // Match: same table, unique or primary, valid, ready, immediate; columns equal and order-sensitive
          suppressedByCatalogue = (input.estate.indexes ?? []).some((idx) => {
            if (!idx) return false;
            if (idx.schema.toLowerCase() !== tkeySchema || idx.table.toLowerCase() !== tkeyName) return false;
            if (!(idx.unique || idx.primary)) return false;
            if (!(idx.valid && idx.ready && idx.immediate)) return false;
            const cols = (idx.columns ?? []).map((c) => c.toLowerCase());
            if (cols.length !== want.length) return false;
            for (let i = 0; i < want.length; i++) {
              if (cols[i] !== want[i]) return false;
            }
            return true;
          });
        }
        if (!suppressedByCatalogue) {
          if (wouldBeRed) {
            violations.push({
              rule_id: "R017",
              severity: "red",
              message: `ADD ${uniq.kind} without USING INDEX on ${uniq.table ? uniq.table.name : "unknown"} (${formatRows(
                nLive
              )} rows) builds unique index under strong lock`,
              remediation_sql:
                "CREATE UNIQUE INDEX CONCURRENTLY <idx> ON <table>(<col(s)>); ALTER TABLE <table> ADD CONSTRAINT <name> UNIQUE USING INDEX <idx>;"
            });
          } else {
            violations.push({
              rule_id: "R017",
              severity: "yellow",
              message: `ADD ${uniq.kind} without USING INDEX — consider online build with CIC then USING INDEX`
            });
          }
        }
      }
      // R010: generic hot DDL without prior lock_timeout
      {
        const r010Rows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1_000_000;
        if (
          isRuleEnabled("R010") &&
          !priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] &&
          typeof nLive === "number" &&
          nLive >= r010Rows
        ) {
          violations.push({
            rule_id: "R010",
            severity: "red",
            message: `Missing lock_timeout for DDL on hot table ${uniq.table ? uniq.table.name : "unknown"} (${formatRows(
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
        target: uniq.table,
        n_live_tup: nLive,
        rules_hit: []
      });
      if (uniq.table) {
        const key = `${uniq.table.schema.toLowerCase()}.${uniq.table.name.toLowerCase()}`;
        aeOpsByTable[key] = aeOpsByTable[key] || [];
        aeOpsByTable[key].push(stmtIdx);
      }
      continue;
    }

    // R018: ADD EXCLUDE constraint (no NOT VALID path)
    const ex = parseAddExcludeConstraint(sql);
    if (ex) {
      const tstats = findTableEstate(input.estate, ex.table);
      const nLive = tstats?.n_live_tup;
      const redRows = policy.rules?.R018?.red_rows ?? 100_000;
      const yellowRows = policy.rules?.R018?.yellow_rows ?? 10_000;
      let sev: "red" | "yellow" = "yellow";
      if (isRuleEnabled("R018")) {
        if (typeof nLive === "number" && nLive >= redRows) sev = "red";
        else if (typeof nLive === "number" && nLive >= yellowRows) sev = "yellow";
        violations.push({
          rule_id: "R018",
          severity: sev,
          message: `ADD EXCLUDE constraint on ${ex.table ? ex.table.name : "unknown"} (${formatRows(
            nLive
          )} rows) cannot use NOT VALID; ensure off-peak`
        });
      }
      // R010: generic hot DDL without prior lock_timeout
      {
        const r010Rows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1_000_000;
        if (
          isRuleEnabled("R010") &&
          !priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] &&
          typeof nLive === "number" &&
          nLive >= r010Rows
        ) {
          violations.push({
            rule_id: "R010",
            severity: "red",
            message: `Missing lock_timeout for DDL on hot table ${ex.table ? ex.table.name : "unknown"} (${formatRows(
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
        target: ex.table,
        n_live_tup: nLive,
        rules_hit: []
      });
      if (ex.table) {
        const key = `${ex.table.schema.toLowerCase()}.${ex.table.name.toLowerCase()}`;
        aeOpsByTable[key] = aeOpsByTable[key] || [];
        aeOpsByTable[key].push(stmtIdx);
      }
      continue;
    }

    // R019: TRUNCATE on estate table — red in CI policy
    const trunc = parseTruncate(sql);
    if (trunc) {
      const tstats = findTableEstate(input.estate, trunc.table);
      const inEstate = !!tstats;
      if (inEstate && isRuleEnabled("R019")) {
        violations.push({
          rule_id: "R019",
          severity: "red",
          message: `TRUNCATE ${trunc.table ? trunc.table.name : "table"} is destructive and takes ACCESS EXCLUSIVE lock`
        });
      }
      statements.push({
        sql,
        lock_mode: "ACCESS EXCLUSIVE",
        blocks_reads: true,
        blocks_writes: true,
        target: trunc.table,
        n_live_tup: tstats?.n_live_tup,
        rules_hit: inEstate && isRuleEnabled("R019") ? ["R019"] : []
      });
      if (trunc.table) {
        const key = `${trunc.table.schema.toLowerCase()}.${trunc.table.name.toLowerCase()}`;
        aeOpsByTable[key] = aeOpsByTable[key] || [];
        aeOpsByTable[key].push(stmtIdx);
      }
      continue;
    }

    // R009: DROP COLUMN / RENAME COLUMN|TABLE / DROP CONSTRAINT — advisory yellow (+ catalogue-aware escalations)
    const dr = parseDropRename(sql);
    if (dr) {
      const tstats = findTableEstate(input.estate, dr.table);
      const nLive = tstats?.n_live_tup;
      if (isRuleEnabled("R009")) {
        let escalated = false;
        // Arm 1: dropping PK/UNIQUE used as replica identity path (tables[].replica_identity = 'd' or 'i')
        // Default: escalate to stronger yellow; optional knob to make it red
        if (dr.kind === "DROP CONSTRAINT") {
          const dc = parseDropConstraint(sql);
          if (dc?.constraint && dc.table && hasCatalogueSection(input.estate, "constraints")) {
            const schemaLc = dc.table.schema.toLowerCase();
            const nameLc = dc.table.name.toLowerCase();
            const con = (input.estate.constraints ?? []).find(
              (c) => c.schema.toLowerCase() === schemaLc && c.table.toLowerCase() === nameLc && c.name.toLowerCase() === dc.constraint!.toLowerCase()
            );
            const repId = tstats?.replica_identity;
            let hitsReplicaIdentity = false;
            if (con && (String(con.kind).toLowerCase() === "pk" || String(con.kind).toLowerCase() === "unique")) {
              if (repId === "d" && String(con.kind).toLowerCase() === "pk") {
                hitsReplicaIdentity = true;
              } else if (repId === "i" && con.supporting_index && hasCatalogueSection(input.estate, "indexes")) {
                const idx = (input.estate.indexes ?? []).find(
                  (ix) =>
                    ix.schema.toLowerCase() === schemaLc &&
                    ix.table.toLowerCase() === nameLc &&
                    ix.name.toLowerCase() === String(con.supporting_index).toLowerCase()
                );
                if (idx?.replica_identity) hitsReplicaIdentity = true;
              }
            }
            if (hitsReplicaIdentity) {
              const redKnob =
                (policy.rules?.R009 &&
                  Object.prototype.hasOwnProperty.call(policy.rules.R009, "red_on_drop_replica_identity")) ?
                  Boolean((policy.rules.R009 as any).red_on_drop_replica_identity) : false;
              const sev: "yellow" | "red" = redKnob ? "red" : "yellow";
              violations.push({
                rule_id: "R009",
                severity: sev,
                message: `DROP CONSTRAINT ${dc.constraint} removes replication identity path on ${dr.table ? dr.table.name : "unknown"} (replica_identity=${repId ?? "?"}) — confirm logical decoding/replication impact`
              });
              escalated = true;
            }
          }
        }
        // Arm 2: dropping a column still referenced by constraints/indexes in catalogue
        if (!escalated && dr.kind === "DROP COLUMN") {
          const dd = parseDropColumn(sql);
          const haveCons = hasCatalogueSection(input.estate, "constraints");
          const haveIdx = hasCatalogueSection(input.estate, "indexes");
          if (dd?.column && dd.table && (haveCons || haveIdx)) {
            const schemaLc = dd.table.schema.toLowerCase();
            const nameLc = dd.table.name.toLowerCase();
            const colLc = dd.column.toLowerCase();
            const consHit = haveCons
              ? (input.estate.constraints ?? []).some(
                  (k) =>
                    k.schema.toLowerCase() === schemaLc &&
                    k.table.toLowerCase() === nameLc &&
                    (k.columns ?? []).some((c) => c.toLowerCase() === colLc)
                )
              : false;
            const idxHit = haveIdx
              ? (input.estate.indexes ?? []).some(
                  (ix) =>
                    ix.schema.toLowerCase() === schemaLc &&
                    ix.table.toLowerCase() === nameLc &&
                    (ix.columns ?? []).some((c) => c.toLowerCase() === colLc)
                )
              : false;
            if (consHit || idxHit) {
              const enableArm =
                (policy.rules?.R009 &&
                  Object.prototype.hasOwnProperty.call(policy.rules.R009, "escalate_drop_column_dependencies"))
                  ? Boolean((policy.rules.R009 as any).escalate_drop_column_dependencies)
                  : true;
              if (enableArm) {
                const pieces: string[] = [];
                if (consHit) pieces.push("constraints");
                if (idxHit) pieces.push("indexes");
                violations.push({
                  rule_id: "R009",
                  severity: "yellow",
                  message: `DROP COLUMN ${dd.column} on ${dd.table.name} affects dependent ${pieces.join(
                    " and "
                  )} — drop/adjust dependencies first or stage with CASCADE carefully`,
                  remediation_sql:
                    "/* Example: ALTER TABLE <table> DROP CONSTRAINT <name>; DROP INDEX CONCURRENTLY <idx>; then DROP COLUMN <col>; */"
                });
                escalated = true;
              }
            }
          }
        }
        // Generic advisory (fallback)
        if (!escalated) {
          violations.push({
            rule_id: "R009",
            severity: "yellow",
            message: `${dr.kind} on ${dr.table ? dr.table.name : "unknown"} (${formatRows(nLive)} rows) — review for application impact`
          });
        }
      }
      statements.push({
        sql,
        lock_mode: "ACCESS EXCLUSIVE",
        blocks_reads: true,
        blocks_writes: true,
        target: dr.table,
        n_live_tup: nLive,
        rules_hit: []
      });
      if (dr.table) {
        const key = `${dr.table.schema.toLowerCase()}.${dr.table.name.toLowerCase()}`;
        aeOpsByTable[key] = aeOpsByTable[key] || [];
        aeOpsByTable[key].push(stmtIdx);
      }
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
        if (isRuleEnabled("R002")) {
          hitRules.push("R002");
          violations.push({
            rule_id: "R002",
            severity: "red",
            message:
              `${conc.kind} cannot run inside a transaction block in Postgres; run outside a transaction or disable the migration transaction`
          });
        }
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
      if (isRuleEnabled("R001")) {
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
      }

      // R010: require lock_timeout for hot tables (size_gated)
      const hotRows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1_000_000;
      if (
        isRuleEnabled("R010") &&
        !priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] &&
        typeof nLive === "number" &&
        nLive >= hotRows
      ) {
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
      // R024 — Index density on large tables (catalogue-aware, size-gated). Runs after R001/R010 on same statement.
      if (isRuleEnabled("R024") && m.table) {
        const r024 = evaluateR024IndexDensity(input.estate, policy, m.table, m.indexName);
        if (r024.length > 0) violations.push(...r024);
      }
      // R025 — Write-heavy index maintenance cost (size/write-gated)
      if (isRuleEnabled("R025") && m.table) {
        const r025 = evaluateR025WriteHeaviness(input.estate, policy, m.table);
        if (r025.length > 0) violations.push(...r025);
      }
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
      if (isRuleEnabled("R003")) {
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
      }
      const hotRows = policy.rules?.R004?.hot_rows ?? 1_000_000;
      if (
        isRuleEnabled("R004") &&
        !priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] &&
        typeof nLive === "number" &&
        nLive >= hotRows
      ) {
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
        if (isRuleEnabled("R010") && typeof nLive === "number" && nLive >= r010Rows) {
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
      if (addCol.table) {
        const key = `${addCol.table.schema.toLowerCase()}.${addCol.table.name.toLowerCase()}`;
        aeOpsByTable[key] = aeOpsByTable[key] || [];
        aeOpsByTable[key].push(stmtIdx);
      }
      continue;
    }

    // R006: ADD CHECK without NOT VALID
    const addCheck = isAddCheckConstraintWithoutNotValid(sql);
    if (addCheck) {
      const tstats = findTableEstate(input.estate, addCheck.table);
      const nLive = tstats?.n_live_tup;
      const redRows = policy.rules?.R006?.red_rows ?? 50_000;
      if (isRuleEnabled("R006")) {
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
          if (
            isRuleEnabled("R010") &&
            !priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] &&
            typeof nLive === "number" &&
            nLive >= r010Rows
          ) {
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
      if (isRuleEnabled("R005")) {
        if (typeof nLive === "number" && nLive >= redRows && !expandContractOk) {
          // Catalogue-aware soften: default ON, can be disabled via policy knob soften_with_catalogue=false
          const softenKnob =
            (policy.rules?.R005 && Object.prototype.hasOwnProperty.call(policy.rules.R005, "soften_with_catalogue"))
              ? Boolean((policy.rules.R005 as any).soften_with_catalogue)
              : true;
          let hasCatalogueMatch = false;
          const table = setNotNull.table;
          const col = setNotNull.column;
          if (softenKnob && table && col) {
            const schemaLc = table.schema.toLowerCase();
            const nameLc = table.name.toLowerCase();
            // Match 1: columns[] entry with not_null: true
            if (hasCatalogueSection(input.estate, "columns")) {
              hasCatalogueMatch =
                (input.estate.columns ?? []).some(
                  (c) =>
                    c.schema.toLowerCase() === schemaLc &&
                    c.table.toLowerCase() === nameLc &&
                    c.column.toLowerCase() === col.toLowerCase() &&
                    c.not_null === true
                ) || hasCatalogueMatch;
            }
            // Match 2: constraints[] entry kind=check, validated=true, columns covering the target column
            if (!hasCatalogueMatch && hasCatalogueSection(input.estate, "constraints")) {
              hasCatalogueMatch = (input.estate.constraints ?? []).some((k) => {
                if (
                  k.schema.toLowerCase() !== schemaLc ||
                  k.table.toLowerCase() !== nameLc ||
                  String(k.kind).toLowerCase() !== "check" ||
                  k.validated !== true
                ) {
                  return false;
                }
                const cols = (k.columns ?? []).map((x) => x.toLowerCase());
                return cols.includes(col.toLowerCase());
              });
            }
          }
          const sev: "red" | "yellow" = hasCatalogueMatch ? "yellow" : "red";
          violations.push({
            rule_id: "R005",
            severity: sev,
            message: `SET NOT NULL may scan/rewrite on ${setNotNull.table ? setNotNull.table.name : "unknown"} (${formatRows(
              nLive
            )} rows); remediate with NOT VALID CHECK → VALIDATE → SET NOT NULL`,
            remediation_sql:
              "ALTER TABLE <table> ADD CONSTRAINT <col>_nn CHECK (<col> IS NOT NULL) NOT VALID; ALTER TABLE <table> VALIDATE CONSTRAINT <col>_nn; ALTER TABLE <table> ALTER COLUMN <col> SET NOT NULL;"
          });
        }
      }
      // R010: generic hot DDL without prior lock_timeout
      const r010Rows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1_000_000;
      if (
        isRuleEnabled("R010") &&
        !priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] &&
        typeof nLive === "number" &&
        nLive >= r010Rows
      ) {
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
      if (setNotNull.table) {
        const key = `${setNotNull.table.schema.toLowerCase()}.${setNotNull.table.name.toLowerCase()}`;
        aeOpsByTable[key] = aeOpsByTable[key] || [];
        aeOpsByTable[key].push(stmtIdx);
      }
      continue;
    }

    // R012/R020: VACUUM FULL / CLUSTER / non-concurrent REINDEX
    const heavy = isVacuumFullOrClusterOrNonConcurrentReindex(sql);
    if (heavy) {
      const rid = heavy.kind === "CLUSTER" ? "R020" : "R012";
      if (isRuleEnabled(rid)) {
        violations.push({
          rule_id: rid,
          severity: "red",
          message: `${heavy.kind} is not allowed in CI`
        });
      }
      statements.push({
        sql,
        lock_mode: "ACCESS EXCLUSIVE",
        blocks_reads: true,
        blocks_writes: true,
        rules_hit: isRuleEnabled(rid) ? [rid] : []
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

  // R023 — Invalid or not-ready index exists on a touched table (catalogue-aware; default yellow)
  if (isRuleEnabled("R023") && hasCatalogueSection(input.estate, "indexes")) {
    const touchedKeys = new Set<string>();
    for (const st of statements) {
      if (st.target?.schema && st.target?.name) {
        touchedKeys.add(`${st.target.schema.toLowerCase()}.${st.target.name.toLowerCase()}`);
      }
    }
    for (const tkey of touchedKeys) {
      const [schemaLc, nameLc] = tkey.split(".");
      const hasBadIndex = (input.estate.indexes ?? []).some(
        (idx) => idx.schema.toLowerCase() === schemaLc && idx.table.toLowerCase() === nameLc && (!idx.valid || !idx.ready)
      );
      if (hasBadIndex) {
        violations.push({
          rule_id: "R023",
          severity: "yellow",
          message: `Invalid or not-ready index present on touched table ${nameLc} — clean up before/after this migration`
        });
      }
    }
  }

  // R016: Multiple ACCESS EXCLUSIVE statements on the same hot table without lock_timeout — yellow
  for (const [tkey, indices] of Object.entries(aeOpsByTable)) {
    if (indices.length >= 2) {
      const [schema, name] = tkey.split(".");
      const tstats = input.estate.tables.find(
        (t) => t.schema.toLowerCase() === schema && t.name.toLowerCase() === name
      );
      const nLive = tstats?.n_live_tup;
      const hotRows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1_000_000;
      const anyHadPriorLockTimeout = indices.some((idx) => priorLockTimeoutFlags[idx] === true);
      if (isRuleEnabled("R016") && !anyHadPriorLockTimeout && typeof nLive === "number" && nLive >= hotRows) {
        violations.push({
          rule_id: "R016",
          severity: "yellow",
          message: `Multiple ACCESS EXCLUSIVE DDLs on hot table ${name} (${formatRows(
            nLive
          )}) without prior lock_timeout — combine or stage with timeouts`
        });
      }
    }
  }

  const failOn = policy.fail_on ?? "red";
  const hasRed = violations.some((v) => v.severity === "red");
  const hasYellow = violations.some((v) => v.severity === "yellow");
  const verdictFlag =
    failOn === "red" ? (hasRed ? "fail" : "pass") : hasRed || hasYellow ? "fail" : "pass";

  // Post-process: apply no-stats behavior to size-gated rules when requested
  if (input.noStatsBehavior === "warn") {
    const sizeGated = new Set([
      "R001",
      "R003",
      "R004",
      "R005",
      "R006",
      "R007",
      "R008",
      "R010",
      "R013",
      "R014",
      "R015",
      "R016",
      "R017",
      "R018",
      "R022",
      "R024",
      "R025",
    ]);
    for (const v of violations) {
      if (v.severity === "red" && sizeGated.has(v.rule_id)) {
        v.severity = "yellow";
        if (!/due to stale estate|no-stats/i.test(v.message)) {
          v.message = `${v.message} — downgraded due to no-stats/stale estate`;
        }
      }
    }
  }

  return {
    schema_version: "1",
    verdict: verdictFlag,
    statements,
    violations,
    meta: {
      pg_version: input.pgVersion ?? input.estate.pg_version,
      estate_captured_at: input.estate.captured_at,
      estate_age_hours: estateAgeHours,
      size_gates_neutralized: sizeGatesNeutralized || undefined,
      policy_id: policy.id,
      engine: "postgres"
    }
  };
}

// Team data-plane freshness/types are exported above from ./team/data-plane

