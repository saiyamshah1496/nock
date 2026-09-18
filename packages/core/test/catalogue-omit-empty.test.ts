import { describe, it, expect } from "vitest";
import { type EstateSnapshot, hasCatalogueSection } from "../src";

describe("catalogue omit vs empty semantics", () => {
  it("omits section key to indicate catalogue absent", () => {
    const snap: EstateSnapshot = {
      schema_version: "1",
      captured_at: "2026-09-16T05:00:00Z",
      pg_version: "16.4",
      source: "fixture",
      tables: [{ schema: "public", name: "t", n_live_tup: 0 }]
      // columns/constraints/indexes intentionally omitted
    };
    expect(hasCatalogueSection(snap, "columns")).toBe(false);
    expect(hasCatalogueSection(snap, "constraints")).toBe(false);
    expect(hasCatalogueSection(snap, "indexes")).toBe(false);
  });

  it("uses empty array [] to indicate synced none found", () => {
    const snap: EstateSnapshot = {
      schema_version: "1",
      captured_at: "2026-09-16T05:00:00Z",
      pg_version: "16.4",
      source: "fixture",
      tables: [{ schema: "public", name: "t", n_live_tup: 0 }],
      columns: [],
      constraints: [],
      indexes: []
    };
    expect(hasCatalogueSection(snap, "columns")).toBe(true);
    expect(hasCatalogueSection(snap, "constraints")).toBe(true);
    expect(hasCatalogueSection(snap, "indexes")).toBe(true);
  });
});

