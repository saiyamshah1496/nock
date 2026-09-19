import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check, type EstateSnapshot } from "../src/index";

describe("R009 — catalogue-aware escalations for DROP operations", () => {
  const dropPkSql = readFileSync(join(__dirname, "../../../fixtures/drop_pk.sql"), "utf8");
  const dropColSql = readFileSync(join(__dirname, "../../../fixtures/drop_column_archived_at.sql"), "utf8");
  const dropUniqueSql = readFileSync(join(__dirname, "../../../fixtures/drop_unique_constraint.sql"), "utf8");
  const bigEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8")
  );

  describe("Drop PK/UNIQUE used as replica identity", () => {
    it("escalates when dropping primary key on table with replica_identity=d", () => {
      const estate: EstateSnapshot = {
        ...bigEstate,
        tables: bigEstate.tables.map((t) =>
          t.name === "sessions" ? { ...t, replica_identity: "d" } : t
        ),
        constraints: [
          { schema: "public", table: "sessions", name: "sessions_pkey", kind: "pk", validated: true, columns: ["id"] }
        ],
        indexes: bigEstate.indexes ?? []
      };
      const policy = {
        id: "nock.postgres.ddl.default",
        version: "1.0.0",
        fail_on: "red",
        rules: { R009: { severity: "yellow" } }
      };
      const v = check({ sql: dropPkSql, estate, policy });
      const msgs = v.violations.filter((x) => x.rule_id === "R009").map((x) => x.message);
      expect(msgs.some((m) => /replica[_ ]identity/i.test(m))).toBe(true);
    });

    it("does not escalate when catalogue sections are omitted (fail-closed)", () => {
      const estate: EstateSnapshot = {
        ...bigEstate,
        tables: bigEstate.tables.map((t) =>
          t.name === "sessions" ? { ...t, replica_identity: "d" } : t
        )
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (estate as any).constraints;
      // indexes omitted too
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (estate as any).indexes;
      const policy = {
        id: "nock.postgres.ddl.default",
        version: "1.0.0",
        fail_on: "red",
        rules: { R009: { severity: "yellow" } }
      };
      const v = check({ sql: dropPkSql, estate, policy });
      const msgs = v.violations.filter((x) => x.rule_id === "R009").map((x) => x.message);
      expect(msgs.some((m) => /replica[_ ]identity/i.test(m))).toBe(false);
    });

    it("does not escalate when constraints[] present but empty (no match)", () => {
      const estate: EstateSnapshot = {
        ...bigEstate,
        tables: bigEstate.tables.map((t) =>
          t.name === "sessions" ? { ...t, replica_identity: "d" } : t
        ),
        constraints: [],
        indexes: []
      };
      const policy = {
        id: "nock.postgres.ddl.default",
        version: "1.0.0",
        fail_on: "red",
        rules: { R009: { severity: "yellow" } }
      };
      const v = check({ sql: dropPkSql, estate, policy });
      const msgs = v.violations.filter((x) => x.rule_id === "R009").map((x) => x.message);
      expect(msgs.some((m) => /replica[_ ]identity/i.test(m))).toBe(false);
    });

    it("escalates when dropping UNIQUE used as replica identity index (replica_identity=i)", () => {
      const estate: EstateSnapshot = {
        ...bigEstate,
        tables: bigEstate.tables.map((t) =>
          t.name === "sessions" ? { ...t, replica_identity: "i" as const } : t
        ),
        constraints: [
          { schema: "public", table: "sessions", name: "sessions_email_unique", kind: "unique", validated: true, columns: ["email"], supporting_index: "uniq_sessions_email" }
        ],
        indexes: [
          { schema: "public", table: "sessions", name: "uniq_sessions_email", unique: true, primary: false, valid: true, ready: true, live: true, immediate: true, columns: ["email"], replica_identity: true }
        ]
      };
      const policy = { id: "p", version: "1.0.0", fail_on: "red", rules: { R009: { } } };
      const v = check({ sql: dropUniqueSql, estate, policy: policy as any });
      const msg = v.violations.find((x) => x.rule_id === "R009" && /replica[_ ]identity/i.test(x.message));
      expect(msg).toBeTruthy();
      expect(msg?.severity).toBe("yellow");
    });

    it("knob-off: red_on_drop_replica_identity=false keeps yellow (default), true makes red", () => {
      const estate: EstateSnapshot = {
        ...bigEstate,
        tables: bigEstate.tables.map((t) =>
          t.name === "sessions" ? { ...t, replica_identity: "d" } : t
        ),
        constraints: [
          { schema: "public", table: "sessions", name: "sessions_pkey", kind: "pk", validated: true, columns: ["id"] }
        ],
        indexes: bigEstate.indexes ?? []
      };
      const basePolicy = { id: "p", version: "1.0.0", fail_on: "red", rules: { R009: { } } };
      const yellowV = check({ sql: dropPkSql, estate, policy: basePolicy as any });
      const yellowR = yellowV.violations.find((x) => /replica[_ ]identity/i.test(x.message));
      expect(yellowR?.severity).toBe("yellow");
      const redV = check({
        sql: dropPkSql,
        estate,
        policy: { id: "p", version: "1.0.0", fail_on: "red", rules: { R009: { red_on_drop_replica_identity: true } } }
      });
      const redR = redV.violations.find((x) => /replica[_ ]identity/i.test(x.message));
      expect(redR?.severity).toBe("red");
    });
  });

  describe("Drop column with dependencies", () => {
    it("escalates when dropped column appears in constraints[]/indexes[]", () => {
      const estate: EstateSnapshot = {
        ...bigEstate,
        constraints: [
          { schema: "public", table: "sessions", name: "sessions_archived_nn", kind: "check", validated: true, columns: ["archived_at"] }
        ],
        indexes: [
          { schema: "public", table: "sessions", name: "idx_sessions_archived_at", unique: false, primary: false, valid: true, ready: true, live: true, immediate: true, columns: ["archived_at"], replica_identity: false }
        ]
      };
      const policy = {
        id: "nock.postgres.ddl.default",
        version: "1.0.0",
        fail_on: "red",
        rules: { R009: { } }
      };
      const v = check({ sql: dropColSql, estate, policy });
      const msg = v.violations.find((x) => x.rule_id === "R009" && /affects dependent/i.test(x.message));
      expect(msg).toBeTruthy();
      expect(msg?.severity).toBe("yellow");
    });

    it("fail-closed when catalogue sections omitted: only generic advisory", () => {
      const estate: EstateSnapshot = { ...bigEstate };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (estate as any).constraints;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (estate as any).indexes;
      const policy = { id: "p", version: "1.0.0", fail_on: "red", rules: { R009: { } } };
      const v = check({ sql: dropColSql, estate, policy: policy as any });
      const msg = v.violations.find((x) => x.rule_id === "R009" && /affects dependent/i.test(x.message));
      expect(msg).toBeUndefined();
    });

    it("knob-off: escalate_drop_column_dependencies=false disables dependency escalation", () => {
      const estate: EstateSnapshot = {
        ...bigEstate,
        constraints: [
          { schema: "public", table: "sessions", name: "sessions_archived_nn", kind: "check", validated: true, columns: ["archived_at"] }
        ],
        indexes: [
          { schema: "public", table: "sessions", name: "idx_sessions_archived_at", unique: false, primary: false, valid: true, ready: true, live: true, immediate: true, columns: ["archived_at"], replica_identity: false }
        ]
      };
      const policy = { id: "p", version: "1.0.0", fail_on: "red", rules: { R009: { escalate_drop_column_dependencies: false } } };
      const v = check({ sql: dropColSql, estate, policy: policy as any });
      const msg = v.violations.find((x) => x.rule_id === "R009" && /affects dependent/i.test(x.message));
      expect(msg).toBeUndefined();
    });
  });
});

