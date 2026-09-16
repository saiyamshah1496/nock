import fs from "fs";
import path from "path";
import os from "os";
import { type StatsSnapshot } from "@nock/core";
import { type EnvelopeV1 } from "@nock/secure-stats";

export interface StatsStore {
  savePlaintext(repoId: string, snapshot: StatsSnapshot): Promise<void>;
  saveEnvelope(repoId: string, envelope: EnvelopeV1): Promise<void>;
  hasPlaintext(repoId: string): boolean;
  hasEnvelope(repoId: string): boolean;
  loadPlaintext(repoId: string): Promise<StatsSnapshot | null>;
  loadEnvelope(repoId: string): Promise<EnvelopeV1 | null>;
}

export class LocalFileStatsStore implements StatsStore {
  private rootDir: string;
  constructor(rootDir?: string) {
    this.rootDir = rootDir || process.env.NOCK_STATS_STORE_DIR || path.resolve("data/stats");
  }
  private dirFor(repoId: string): string {
    return path.join(this.rootDir, sanitize(repoId));
  }
  private plaintextPath(repoId: string): string {
    return path.join(this.dirFor(repoId), "last.json");
  }
  private envelopePath(repoId: string): string {
    return path.join(this.dirFor(repoId), "last.envelope.json");
  }
  private async atomicWrite(filePath: string, data: string): Promise<void> {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = path.join(os.tmpdir(), `nock-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, filePath);
  }
  async savePlaintext(repoId: string, snapshot: StatsSnapshot): Promise<void> {
    await this.atomicWrite(this.plaintextPath(repoId), JSON.stringify(snapshot, null, 2) + "\n");
  }
  async saveEnvelope(repoId: string, envelope: EnvelopeV1): Promise<void> {
    await this.atomicWrite(this.envelopePath(repoId), JSON.stringify(envelope, null, 2) + "\n");
  }
  hasPlaintext(repoId: string): boolean {
    return fs.existsSync(this.plaintextPath(repoId));
  }
  hasEnvelope(repoId: string): boolean {
    return fs.existsSync(this.envelopePath(repoId));
  }
  async loadPlaintext(repoId: string): Promise<StatsSnapshot | null> {
    const p = this.plaintextPath(repoId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  async loadEnvelope(repoId: string): Promise<EnvelopeV1 | null> {
    const p = this.envelopePath(repoId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

