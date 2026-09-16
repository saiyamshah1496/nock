import { createApp } from "./app";

// Cloudflare Workers entrypoint: export the Hono app
const app = createApp();
export default app;

