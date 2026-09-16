import { type StatsSnapshot } from "@nock/core";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface GcmBox {
  ct: string; // base64
  iv: string; // base64
  tag: string; // base64
}

export interface EnvelopeV1 {
  version: "v1";
  payload: GcmBox;
  dek: GcmBox;
  schema_version?: string;
  captured_at?: string;
  source?: string;
}

function toB64(buf: Buffer): string {
  return buf.toString("base64");
}

function fromB64(s: string): Buffer {
  return Buffer.from(s, "base64");
}

function aesGcmEncrypt(plaintext: Buffer, key: Buffer, aad?: Buffer): GcmBox {
  if (key.length !== 32) throw new Error("AES-GCM requires 32-byte key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  if (aad) cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ct: toB64(ct), iv: toB64(iv), tag: toB64(tag) };
}

function aesGcmDecrypt(box: GcmBox, key: Buffer, aad?: Buffer): Buffer {
  if (key.length !== 32) throw new Error("AES-GCM requires 32-byte key");
  const iv = fromB64(box.iv);
  const tag = fromB64(box.tag);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const ct = fromB64(box.ct);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt;
}

export function envelopeEncrypt(snapshot: StatsSnapshot, kekB64: string): EnvelopeV1 {
  const kek = fromB64(kekB64);
  if (kek.length !== 32) throw new Error("NOCK_STATS_KEK must be base64 32 bytes");
  const plaintext = Buffer.from(JSON.stringify(snapshot), "utf8");
  const dek = randomBytes(32);
  const payload = aesGcmEncrypt(plaintext, dek);
  const dekBox = aesGcmEncrypt(dek, kek);
  return {
    version: "v1",
    payload,
    dek: dekBox,
    schema_version: snapshot.schema_version,
    captured_at: snapshot.captured_at,
    source: snapshot.source
  };
}

export function envelopeDecryptToSnapshot(envelope: EnvelopeV1, kekB64: string): StatsSnapshot {
  if (envelope.version !== "v1") throw new Error("Unsupported envelope version");
  const kek = fromB64(kekB64);
  if (kek.length !== 32) throw new Error("NOCK_STATS_KEK must be base64 32 bytes");
  const dek = aesGcmDecrypt(envelope.dek, kek);
  const plaintext = aesGcmDecrypt(envelope.payload, dek);
  const json = JSON.parse(plaintext.toString("utf8"));
  return json as StatsSnapshot;
}

