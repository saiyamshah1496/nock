import { LocalFileStatsStore, type EstateStore } from "./store";

export function createStatsStoreFromEnv(): EstateStore {
  const which = (process.env.NOCK_ESTATE_STORE || process.env.NOCK_STATS_STORE || "file").toLowerCase();
  if (which === "r2") {
    // Lazy require to avoid pulling R2 deps unless selected
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./store.r2") as any;
    return new mod.R2EstateStore();
  }
  return new LocalFileStatsStore();
}

