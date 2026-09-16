import { type StatsSnapshot } from "@nock/core";
export interface GcmBox {
    ct: string;
    iv: string;
    tag: string;
}
export interface EnvelopeV1 {
    version: "v1";
    payload: GcmBox;
    dek: GcmBox;
    schema_version?: string;
    captured_at?: string;
    source?: string;
}
export declare function envelopeEncrypt(snapshot: StatsSnapshot, kekB64: string): EnvelopeV1;
export declare function envelopeDecryptToSnapshot(envelope: EnvelopeV1, kekB64: string): StatsSnapshot;
