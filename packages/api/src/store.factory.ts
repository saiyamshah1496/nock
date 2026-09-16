import { LocalFileStatsStore, type StatsStore } from "./store";

export function createStatsStoreFromEnv(): StatsStore {
  const which = (process.env.NOCK_STATS_STORE || "file").toLowerCase();
  if (which === "r2") {
    // Lazy require to avoid pulling R2 deps unless selected
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./store.r2") as any;
    return new mod.R2StatsStore();
  }
  return new LocalFileStatsStore();
}

