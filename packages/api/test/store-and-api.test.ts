import { describe, it, expect, beforeEach } from "vitest";
import { LocalFileStatsStore } from "../src/store";
import { envelopeEncrypt } from "@nock/secure-stats";
import { createApp } from "../src/server";
import fs from "fs";
import os from "os";
import path from "path";

const sample = {
  schema_version: "1",
  captured_at: "2026-09-16T05:00:00Z",
  pg_version: "16.4",
  source: "sync-stats",
  tables: [{ schema: "public", name: "a", n_live_tup: 123, n_dead_tup: 0, relation_bytes: 10, total_bytes: 20, last_analyze: null, last_autoanalyze: null }]
};

describe("LocalFileStatsStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nock-api-test-"));
    process.env.NOCK_STATS_STORE_DIR = dir;
  });
  it("saves and reads plaintext", async () => {
    const s = new LocalFileStatsStore(dir);
    await s.savePlaintext("repo1", sample as any);
    const out = await s.loadPlaintext("repo1");
    expect(out).toEqual(sample);
  });
  it("saves and reads envelope", async () => {
    const s = new LocalFileStatsStore(dir);
    const kek = Buffer.alloc(32, 7).toString("base64");
    const env = envelopeEncrypt(sample as any, kek);
    await s.saveEnvelope("repo1", env);
    const out = await s.loadEnvelope("repo1");
    expect(out).toEqual(env);
  });
});

describe("API GET last-good", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nock-api-test-"));
    process.env.NOCK_STATS_STORE_DIR = dir;
    process.env.NOCK_STATS_API_TOKEN = "t";
    delete process.env.NOCK_DEV_PLAINTEXT_STATS;
  });
  it("returns decrypted stats when envelope present", async () => {
    const kek = Buffer.alloc(32, 7).toString("base64");
    process.env.NOCK_STATS_KEK = kek;
    const s = new LocalFileStatsStore(dir);
    const env = envelopeEncrypt(sample as any, kek);
    await s.saveEnvelope("repoX", env);
    const app = createApp();
    const res = await app.request("/v1/stats/repoX");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(sample);
  });
});

