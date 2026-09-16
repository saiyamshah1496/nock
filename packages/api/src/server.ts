import { serve } from "@hono/node-server";
import { createApp as createAppWithStore } from "./app";
import { createStatsStoreFromEnv } from "./store.factory";

export function createApp() {
  const store = createStatsStoreFromEnv();
  return createAppWithStore(store);
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  console.log(`Nock API listening on :${port}`);
  const app = createApp();
  serve({ fetch: app.fetch, port });
}

