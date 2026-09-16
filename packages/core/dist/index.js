"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.check = check;
// Minimal shape matcher: CREATE INDEX (non-concurrent)
function isCreateIndexNonConcurrent(sql) {
    const norm = sql.trim().replace(/\s+/g, " ").toUpperCase();
    if (!norm.startsWith("CREATE INDEX"))
        return null;
    if (norm.includes(" CONCURRENTLY "))
        return null;
    // Try to extract table: CREATE INDEX <name> ON <schema?.>table (
    const m = /CREATE INDEX\s+([A-Z0-9_"]+)\s+ON\s+([A-Z0-9_".]+)/i.exec(sql);
    if (!m)
        return { table: undefined, indexName: undefined };
    const indexName = m[1];
    const fq = m[2].replace(/"/g, "");
    const parts = fq.split(".");
    const table = parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
    return { table, indexName };
}
// ALTER TABLE ... ADD COLUMN ...
function isAlterTableAddColumn(sql) {
    const m = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)\s+ADD\s+COLUMN\s+([A-Za-z0-9_".]+)[\s\S]*?;?$/i.exec(sql.trim());
    if (!m)
        return null;
    const fq = m[1].replace(/"/g, "");
    const parts = fq.split(".");
    const table = parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
    const hasDefault = /\bDEFAULT\b/i.test(sql);
    const column = m[2]?.replace(/"/g, "");
    return { table, column, hasDefault };
}
// ALTER TABLE ... ADD CONSTRAINT ... CHECK (...) [NOT VALID]
function isAddCheckConstraintWithoutNotValid(sql) {
    const norm = sql.trim();
    if (!/ALTER\s+TABLE\s+/i.test(norm) || !/\bADD\s+CONSTRAINT\b/i.test(norm) || !/\bCHECK\s*\(/i.test(norm))
        return null;
    if (/\bNOT\s+VALID\b/i.test(norm))
        return null; // safe path
    const m = /ALTER\s+TABLE\s+([A-Za-z0-9_".]+)/i.exec(norm);
    const fq = m?.[1]?.replace(/"/g, "");
    let table = undefined;
    if (fq) {
        const parts = fq.split(".");
        table = parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: "public", name: parts[0] };
    }
    return { table };
}
function isVacuumFullOrClusterOrNonConcurrentReindex(sql) {
    const up = sql.trim().toUpperCase();
    if (up.startsWith("VACUUM FULL"))
        return { kind: "VACUUM FULL" };
    if (up.startsWith("CLUSTER"))
        return { kind: "CLUSTER" };
    if (up.startsWith("REINDEX") && !up.includes(" CONCURRENTLY"))
        return { kind: "REINDEX" };
    return null;
}
function lockModeForCreateIndexNonConcurrent() {
    // Per PG docs, non-concurrent CREATE INDEX takes SHARE
    return "SHARE";
}
function findTableStats(stats, ref) {
    if (!ref)
        return undefined;
    const hit = stats.tables.find((t) => t.schema.toLowerCase() === ref.schema.toLowerCase() && t.name.toLowerCase() === ref.name.toLowerCase()) ||
        stats.tables.find((t) => t.name.toLowerCase() === ref.name.toLowerCase()); // fallback if schema omitted
    return hit;
}
function formatRows(n) {
    if (!n && n !== 0)
        return "?";
    if (n >= 1000000000)
        return (n / 1000000000).toFixed(2) + "B";
    if (n >= 1000000)
        return (n / 1000000).toFixed(2) + "M";
    if (n >= 1000)
        return (n / 1000).toFixed(2) + "k";
    return String(n);
}
function splitSqlStatements(sql) {
    // Naive splitter by semicolon, ignoring simple cases with semicolons in quotes
    const parts = sql
        .split(/;(?![^'"]*['"])/g)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return parts;
}
function check(input) {
    const sqls = Array.isArray(input.sql)
        ? input.sql.flatMap((s) => splitSqlStatements(s))
        : splitSqlStatements(input.sql);
    const statements = [];
    const violations = [];
    const policy = input.policy;
    // Track if a lock_timeout was set earlier in this batch
    const priorLockTimeoutFlags = [];
    let seenLockTimeout = false;
    for (const sql of sqls) {
        const up = sql.trim().toUpperCase();
        priorLockTimeoutFlags.push(seenLockTimeout);
        if (/^SET\s+LOCK_TIMEOUT\s*=/i.test(up)) {
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
        // R001: Non-concurrent CREATE INDEX
        const m = isCreateIndexNonConcurrent(sql);
        if (m) {
            const lockMode = lockModeForCreateIndexNonConcurrent();
            const tstats = findTableStats(input.stats, m.table);
            const nLive = tstats?.n_live_tup;
            const hitRules = [];
            // Threshold from policy or default 10000
            const redRows = policy.rules?.R001?.red_rows ?? 10000;
            if (typeof nLive === "number" && nLive >= redRows) {
                hitRules.push("R001");
                violations.push({
                    rule_id: "R001",
                    severity: "red",
                    message: `CREATE INDEX without CONCURRENTLY on ${m.table ? m.table.name : "unknown"} (${formatRows(nLive)} rows) takes SHARE lock and may block writes`,
                    remediation_sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS <index_name> ON <table>(<col(s)>);" /* placeholder */,
                    docs_url: "https://www.postgresql.org/docs/current/sql-createindex.html"
                });
            }
            else {
                // Even below threshold, still note lock mode in statement verdict
            }
            // R010: require lock_timeout for hot tables (size_gated)
            const hotRows = policy.rules?.R010?.always_require_lock_timeout_above_rows ?? 1000000;
            if (!priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] && typeof nLive === "number" && nLive >= hotRows) {
                hitRules.push("R010");
                violations.push({
                    rule_id: "R010",
                    severity: "red",
                    message: `Missing lock_timeout for DDL on hot table ${m.table ? m.table.name : "unknown"} (${formatRows(nLive)} rows)`,
                    remediation_sql: "SET lock_timeout = '3s';"
                });
            }
            // Estimated hold is approximate; simple stub range
            const est = typeof nLive === "number"
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
            const tstats = findTableStats(input.stats, addCol.table);
            const nLive = tstats?.n_live_tup;
            const hotRows = policy.rules?.R004?.hot_rows ?? 1000000;
            if (!priorLockTimeoutFlags[priorLockTimeoutFlags.length - 1] && typeof nLive === "number" && nLive >= hotRows) {
                violations.push({
                    rule_id: "R004",
                    severity: (policy.rules?.R004?.require_lock_timeout ? "red" : "yellow"),
                    message: `ADD COLUMN without lock_timeout on hot table ${addCol.table ? addCol.table.name : "unknown"} (${formatRows(nLive)} rows)`,
                    remediation_sql: "SET lock_timeout = '3s';"
                });
            }
            statements.push({
                sql,
                lock_mode: "ACCESS EXCLUSIVE",
                blocks_reads: true,
                blocks_writes: true,
                target: addCol.table,
                n_live_tup: nLive,
                rules_hit: []
            });
            continue;
        }
        // R006: ADD CHECK without NOT VALID
        const addCheck = isAddCheckConstraintWithoutNotValid(sql);
        if (addCheck) {
            const tstats = findTableStats(input.stats, addCheck.table);
            const nLive = tstats?.n_live_tup;
            const redRows = policy.rules?.R006?.red_rows ?? 50000;
            if (typeof nLive === "number" && nLive >= redRows) {
                violations.push({
                    rule_id: "R006",
                    severity: "red",
                    message: `ADD CHECK without NOT VALID on ${addCheck.table ? addCheck.table.name : "unknown"} (${formatRows(nLive)} rows)`,
                    remediation_sql: "ALTER TABLE <table> ADD CONSTRAINT <name> CHECK (<expr>) NOT VALID; ALTER TABLE <table> VALIDATE CONSTRAINT <name>;"
                });
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
    const verdictFlag = failOn === "red" ? (hasRed ? "fail" : "pass") : hasRed || hasYellow ? "fail" : "pass";
    return {
        schema_version: "1",
        verdict: verdictFlag,
        statements,
        violations,
        meta: {
            pg_version: input.pgVersion ?? input.stats.pg_version,
            stats_captured_at: input.stats.captured_at,
            policy_id: policy.id,
            engine: "postgres"
        }
    };
}
//# sourceMappingURL=index.js.map