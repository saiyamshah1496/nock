import { serve } from "@hono/node-server";
export { createApp } from "./app";
import { createApp } from "./app";

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  console.log(`Nock API listening on :${port}`);
  const app = createApp();
  serve({ fetch: app.fetch, port });
}

