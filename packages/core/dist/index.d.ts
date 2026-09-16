export type LockMode = "ACCESS EXCLUSIVE" | "ACCESS SHARE" | "SHARE" | "SHARE UPDATE EXCLUSIVE" | "SHARE ROW EXCLUSIVE";
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
    estimated_hold_ms?: {
        min: number;
        max: number;
    };
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
export interface StatsTable {
    schema: string;
    name: string;
    n_live_tup: number;
    n_dead_tup?: number;
    relation_bytes?: number;
    total_bytes?: number;
    last_analyze?: string | null;
    last_autoanalyze?: string | null;
}
export interface StatsSnapshot {
    schema_version?: string;
    captured_at?: string;
    pg_version?: string;
    source?: string;
    tables: StatsTable[];
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
        stats_captured_at?: string;
        stats_age_hours?: number;
        policy_id: string;
        engine: "postgres";
    };
}
export interface CheckInput {
    sql: string | string[];
    stats: StatsSnapshot;
    policy: PolicyResolved;
    pgVersion?: string;
}
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
    stats: StatsSnapshot;
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
export declare function check(input: CheckInput): VerdictV1;
