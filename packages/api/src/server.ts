import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { LocalFileStatsStore } from "./store";
import type { StatsSnapshot } from "@nock/core";
import { envelopeDecryptToSnapshot, type EnvelopeV1 } from "@nock/secure-stats";

function requireToken(c: any): string | null {
  const header = c.req.header("authorization") || c.req.header("Authorization");
  if (!header) return null;
  const m = header.match(/^Bearer (.+)$/i);
  return m ? m[1] : null;
}

function okJson(c: any, body: any, status = 200) {
  return c.json(body, status);
}
function errJson(c: any, message: string, status = 400) {
  return c.json({ error: message }, status);
}

export function createApp() {
  const app = new Hono();
  const store = new LocalFileStatsStore();
  // Health
  app.get("/healthz", (c) => c.text("ok"));
  // POST /v1/stats/:repoId
  app.post("/v1/stats/:repoId", async (c) => {
    const repoId = c.req.param("repoId");
    const token = requireToken(c);
    const expected = process.env.NOCK_STATS_API_TOKEN || "";
    if (!expected) return errJson(c, "server not configured", 500);
    if (!token || token !== expected) return errJson(c, "unauthorized", 401);
    const isDevPlain = process.env.NOCK_DEV_PLAINTEXT_STATS === "1";
    try {
      const body = await c.req.json();
      if (isDevPlain) {
        const snapshot = body as StatsSnapshot;
        await store.savePlaintext(repoId, snapshot);
        return okJson(c, { status: "ok", mode: "plaintext" }, 200);
      } else {
        const env = body as EnvelopeV1;
        const kek = process.env.NOCK_STATS_KEK;
        if (!kek) return errJson(c, "server missing NOCK_STATS_KEK", 500);
        envelopeDecryptToSnapshot(env, kek);
        await store.saveEnvelope(repoId, env);
        return okJson(c, { status: "ok", mode: "envelope" }, 200);
      }
    } catch (e: any) {
      return errJson(c, e?.message || "invalid request", 400);
    }
  });
  // GET /v1/stats/:repoId
  app.get("/v1/stats/:repoId", async (c) => {
    const repoId = c.req.param("repoId");
    const isDevPlain = process.env.NOCK_DEV_PLAINTEXT_STATS === "1";
    if (isDevPlain) {
      const pt = await store.loadPlaintext(repoId);
      if (!pt) return errJson(c, "not found", 404);
      return okJson(c, pt, 200);
    } else {
      const env = await store.loadEnvelope(repoId);
      if (!env) return errJson(c, "not found", 404);
      const kek = process.env.NOCK_STATS_KEK;
      if (!kek) return errJson(c, "server missing NOCK_STATS_KEK", 500);
      try {
        const snap = envelopeDecryptToSnapshot(env, kek);
        return okJson(c, snap, 200);
      } catch (e: any) {
        return errJson(c, "decrypt failed", 500);
      }
    }
  });
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  console.log(`Nock API listening on :${port}`);
  const app = createApp();
  serve({ fetch: app.fetch, port });
}

