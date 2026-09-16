import { describe, it, expect } from "vitest";

// Skip unless R2 creds are present in env
const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;
const haveCreds = required.every((k) => !!process.env[k]);

describe("R2StatsStore (integration, optional)", () => {
  (haveCreds ? it : it.skip)("saves and reads envelope roundtrip", async () => {
    // Dynamic import to avoid bundling unless used
    const { R2EstateStore } = await import("../src/store.r2");
    const store = new R2EstateStore();
    const repoId = "it-r2-store-test";
    const env = {
      v: "1",
      a: "A", // alg
      s: "B", // salt
      i: "C", // iv
      t: "D", // tag
      d: "{}", // ciphertext
    };
    await store.saveEnvelope(repoId, env as any);
    const out = await store.loadEnvelope(repoId);
    expect(out).toEqual(env);
  });
});

