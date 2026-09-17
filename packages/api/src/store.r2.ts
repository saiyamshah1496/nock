import { type EstateSnapshot } from "@nockhq/core";
import { type EnvelopeV1 } from "@nockhq/secure-estate";
import { AwsClient } from "aws4fetch";

export interface EstateStore {
  savePlaintext(repoId: string, snapshot: EstateSnapshot): Promise<void>;
  saveEnvelope(repoId: string, envelope: EnvelopeV1): Promise<void>;
  hasPlaintext(repoId: string): Promise<boolean> | boolean;
  hasEnvelope(repoId: string): Promise<boolean> | boolean;
  loadPlaintext(repoId: string): Promise<EstateSnapshot | null>;
  loadEnvelope(repoId: string): Promise<EnvelopeV1 | null>;
}

export class R2EstateStore implements EstateStore {
  private aws: AwsClient;
  private baseUrl: string;
  private bucket: string;

  constructor(opts?: {
    accountId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucket?: string;
  }) {
    const accountId = opts?.accountId || requiredEnv("R2_ACCOUNT_ID");
    const accessKeyId = opts?.accessKeyId || requiredEnv("R2_ACCESS_KEY_ID");
    const secretAccessKey = opts?.secretAccessKey || requiredEnv("R2_SECRET_ACCESS_KEY");
    this.bucket = opts?.bucket || requiredEnv("R2_BUCKET");
    // R2 S3-compatible endpoint; region must be "auto" and service "s3"
    this.baseUrl = `https://${accountId}.r2.cloudflarestorage.com`;
    this.aws = new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }

  private keyPrefix(repoId: string): string {
    return `estate/${sanitize(repoId)}`;
  }
  private plaintextKey(repoId: string): string {
    return `${this.keyPrefix(repoId)}/last.json`;
  }
  private envelopeKey(repoId: string): string {
    return `${this.keyPrefix(repoId)}/last.envelope.json`;
  }
  private urlFor(key: string): string {
    return `${this.baseUrl}/${encodeURIComponent(this.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  async savePlaintext(repoId: string, snapshot: EstateSnapshot): Promise<void> {
    const body = JSON.stringify(snapshot, null, 2) + "\n";
    const url = this.urlFor(this.plaintextKey(repoId));
    const res = await this.aws.fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!res.ok) {
      throw new Error(`R2 PUT failed (${res.status}) for ${url}`);
    }
  }

  async saveEnvelope(repoId: string, envelope: EnvelopeV1): Promise<void> {
    const body = JSON.stringify(envelope, null, 2) + "\n";
    const url = this.urlFor(this.envelopeKey(repoId));
    const res = await this.aws.fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!res.ok) {
      throw new Error(`R2 PUT failed (${res.status}) for ${url}`);
    }
  }

  async hasPlaintext(repoId: string): Promise<boolean> {
    const url = this.urlFor(this.plaintextKey(repoId));
    const res = await this.aws.fetch(url, { method: "HEAD" });
    return res.ok;
  }

  async hasEnvelope(repoId: string): Promise<boolean> {
    const url = this.urlFor(this.envelopeKey(repoId));
    const res = await this.aws.fetch(url, { method: "HEAD" });
    return res.ok;
  }

  async loadPlaintext(repoId: string): Promise<EstateSnapshot | null> {
    const url = this.urlFor(this.plaintextKey(repoId));
    const res = await this.aws.fetch(url, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 GET failed (${res.status}) for ${url}`);
    return (await res.json()) as EstateSnapshot;
  }

  async loadEnvelope(repoId: string): Promise<EnvelopeV1 | null> {
    const url = this.urlFor(this.envelopeKey(repoId));
    const res = await this.aws.fetch(url, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 GET failed (${res.status}) for ${url}`);
    return (await res.json()) as EnvelopeV1;
  }
}

function requiredEnv(name: string): string {
  const v = (globalThis as any).process?.env?.[name];
  if (!v) throw new Error(`Missing ${name} for R2EstateStore`);
  return v;
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

