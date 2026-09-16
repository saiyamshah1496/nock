import { createApp } from "./server";

// Cloudflare Workers entrypoint: export the Hono app
const app = createApp();
export default app;

