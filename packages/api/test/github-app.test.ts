import { describe, it, expect } from "vitest";
import {
  verifyGitHubSignature,
  prTouchesTriggerPaths,
  buildNeutralCheckRunPayload,
  CHECK_RUN_NAME,
} from "../src/github_app";

async function hmacHex(secret: string, data: string): Promise<string> {
  // Use Node crypto for the test helper
  const { createHmac } = await import("crypto");
  const h = createHmac("sha256", secret);
  h.update(Buffer.from(data));
  return "sha256=" + h.digest("hex");
}

describe("github_app", () => {
  it("verifies webhook HMAC signature (sha256)", async () => {
    const secret = "topsecret";
    const body = JSON.stringify({ hello: "world" });
    const sig = await hmacHex(secret, body);
    const ok = await verifyGitHubSignature({
      secret,
      signatureHeader: sig,
      rawBody: new TextEncoder().encode(body),
    });
    expect(ok).toBe(true);
  });

  it("rejects invalid signature", async () => {
    const ok = await verifyGitHubSignature({
      secret: "s1",
      signatureHeader: "sha256=deadbeef",
      rawBody: new TextEncoder().encode("{}"),
    });
    expect(ok).toBe(false);
  });

  it("matches default trigger globs", () => {
    expect(
      prTouchesTriggerPaths([
        "services/user/db/migrations/0001_init.sql",
        "src/app/index.ts",
      ])
    ).toBe(true);
    expect(prTouchesTriggerPaths(["src/app/index.ts"])).toBe(false);
    expect(prTouchesTriggerPaths([".nock/estate.json"])).toBe(true);
    expect(prTouchesTriggerPaths(["supabase/migrations/20240101_init/down.sql"])).toBe(true);
    expect(prTouchesTriggerPaths(["db/migrations/1.sql"])).toBe(true);
  });

  it("builds neutral check_run payload with correct name and conclusion", () => {
    const payload = buildNeutralCheckRunPayload({ headSha: "deadbeef" });
    expect(payload.name).toBe(CHECK_RUN_NAME);
    expect(payload.head_sha).toBe("deadbeef");
    expect(payload.status).toBe("completed");
    expect(payload.conclusion).toBe("neutral");
    expect(payload.output && payload.output.title).toBe(CHECK_RUN_NAME);
  });
});

