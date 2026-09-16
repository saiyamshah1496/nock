export interface StatsStore {
  savePlaintext(repoId: string, snapshot: import("@nock/core").StatsSnapshot): Promise<void>;
  saveEnvelope(repoId: string, envelope: import("@nock/secure-stats").EnvelopeV1): Promise<void>;
  hasPlaintext(repoId: string): Promise<boolean> | boolean;
  hasEnvelope(repoId: string): Promise<boolean> | boolean;
  loadPlaintext(repoId: string): Promise<import("@nock/core").StatsSnapshot | null>;
  loadEnvelope(repoId: string): Promise<import("@nock/secure-stats").EnvelopeV1 | null>;
}

