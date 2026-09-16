import { serve } from "@hono/node-server";
import { createApp as createApiApp } from "./app";
import { createStatsStoreFromEnv } from "./store.factory";
import { InMemoryPolicyAuditStore, type PolicyAuditStoreFactory } from "./policy_audit_store";

export function createApp() {
  const stats = createStatsStoreFromEnv();
  // Singleton in-memory policy/audit store for local dev
  const factory: PolicyAuditStoreFactory = () => {
    if (!(globalThis as any).__nockInMemPolicyAudit) {
      (globalThis as any).__nockInMemPolicyAudit = new InMemoryPolicyAuditStore();
    }
    return (globalThis as any).__nockInMemPolicyAudit as InMemoryPolicyAuditStore;
  };
  return createApiApp(stats, factory);
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  console.log(`Nock API listening on :${port}`);
  const app = createApp();
  serve({ fetch: app.fetch, port });
}

