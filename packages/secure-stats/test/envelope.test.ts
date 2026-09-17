import { describe, it, expect } from "vitest";
import { envelopeEncrypt, envelopeDecryptToSnapshot } from "../src/index";

const sample = {
  schema_version: "1",
  captured_at: "2026-09-16T05:00:00Z",
  pg_version: "16.4",
  source: "sync-estate",
  tables: [
    { schema: "public", name: "a", n_live_tup: 123, n_dead_tup: 0, relation_bytes: 10, total_bytes: 20, last_analyze: null, last_autoanalyze: null }
  ]
};

describe("secure-estate envelope", () => {
  it("encrypts and decrypts roundtrip", () => {
    const kek = Buffer.alloc(32, 7).toString("base64");
    const env = envelopeEncrypt(sample as any, kek);
    const out = envelopeDecryptToSnapshot(env, kek);
    expect(out).toEqual(sample);
  });
});

