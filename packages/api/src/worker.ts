import { createApp } from "./app";
import { R2StatsStore } from "./store.r2";

// Worker entrypoint must remain Workers-only:
// - Do NOT import Node server (`@hono/node-server`) or file-backed store.
// - Only import the Hono app factory and the R2-backed StatsStore.
// Cloudflare Workers entrypoint: export the Hono app
const app = createApp(new R2StatsStore());
export default app;

