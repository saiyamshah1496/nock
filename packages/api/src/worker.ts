import { createApp } from "./app";
import { R2EstateStore } from "./store.r2";
import { D1PolicyAuditStore } from "./policy_audit_store.d1";

// Cloudflare Workers entrypoint: build app per-request with env bindings
export default {
  fetch(request: Request, env: any, ctx: any) {
    const stats = new R2EstateStore();
    const policyFactory = () => new D1PolicyAuditStore(env.NOCK_D1);
    const app = createApp(stats, policyFactory);
    return app.fetch(request, env, ctx);
  },
};

