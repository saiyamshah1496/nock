import { createApp } from "./app";
import { R2StatsStore } from "./store.r2";

// Cloudflare Workers entrypoint: export the Hono app
const app = createApp(new R2StatsStore());
export default app;

