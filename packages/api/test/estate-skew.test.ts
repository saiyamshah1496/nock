import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/server";
import { envelopeEncrypt } from "@nockhq/secure-estate";
import fs from "fs";
import os from "os";
import path from "path";

const makeSnapshot = (capturedAtIso: string) => ({
  schema_version: "1",
  captured_at: capturedAtIso,
  pg_version: "16.4",
  source: "sync-estate",
  tables: [],
});

describe("POST /v1/estate/:owner/:repo skew validation", () => {
  beforeEach(() => {
    process.env.NOCK_ESTATE_API_TOKEN = "t";
    process.env.NOCK_ESTATE_KEK = Buffer.alloc(32, 7).toString("base64");
    delete process.env.NOCK_DEV_PLAINTEXT_ESTATE;
    // Isolate store to a temp dir to avoid polluting repo
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nock-api-test-"));
    process.env.NOCK_ESTATE_STORE_DIR = dir;
  });

  it("accepts envelope when captured_at within 1 hour", async () => {
    const app = createApp();
    const now = Date.now();
    const okSnap = makeSnapshot(new Date(now - 30 * 60 * 1000).toISOString()); // 30m ago
    const env = envelopeEncrypt(okSnap as any, String(process.env.NOCK_ESTATE_KEK));
    const res = await app.request("/v1/estate/acme/repo1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer t",
      },
      body: JSON.stringify(env),
    });
    expect(res.status).toBe(200);
  });

  it("rejects envelope when captured_at skew exceeds 1 hour", async () => {
    const app = createApp();
    const now = Date.now();
    const badSnap = makeSnapshot(new Date(now - 2 * 60 * 60 * 1000).toISOString()); // 2h ago
    const env = envelopeEncrypt(badSnap as any, String(process.env.NOCK_ESTATE_KEK));
    const res = await app.request("/v1/estate/acme/repo2", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer t",
      },
      body: JSON.stringify(env),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error || "").toMatch(/skew/i);
  });
});

