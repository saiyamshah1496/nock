"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.envelopeEncrypt = envelopeEncrypt;
exports.envelopeDecryptToSnapshot = envelopeDecryptToSnapshot;
const crypto_1 = require("crypto");
function toB64(buf) {
    return buf.toString("base64");
}
function fromB64(s) {
    return Buffer.from(s, "base64");
}
function aesGcmEncrypt(plaintext, key, aad) {
    if (key.length !== 32)
        throw new Error("AES-GCM requires 32-byte key");
    const iv = (0, crypto_1.randomBytes)(12);
    const cipher = (0, crypto_1.createCipheriv)("aes-256-gcm", key, iv, { authTagLength: 16 });
    if (aad)
        cipher.setAAD(aad);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { ct: toB64(ct), iv: toB64(iv), tag: toB64(tag) };
}
function aesGcmDecrypt(box, key, aad) {
    if (key.length !== 32)
        throw new Error("AES-GCM requires 32-byte key");
    const iv = fromB64(box.iv);
    const tag = fromB64(box.tag);
    const decipher = (0, crypto_1.createDecipheriv)("aes-256-gcm", key, iv, { authTagLength: 16 });
    if (aad)
        decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const ct = fromB64(box.ct);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt;
}
function envelopeEncrypt(snapshot, kekB64) {
    const kek = fromB64(kekB64);
    if (kek.length !== 32)
        throw new Error("NOCK_STATS_KEK must be base64 32 bytes");
    const plaintext = Buffer.from(JSON.stringify(snapshot), "utf8");
    const dek = (0, crypto_1.randomBytes)(32);
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
function envelopeDecryptToSnapshot(envelope, kekB64) {
    if (envelope.version !== "v1")
        throw new Error("Unsupported envelope version");
    const kek = fromB64(kekB64);
    if (kek.length !== 32)
        throw new Error("NOCK_STATS_KEK must be base64 32 bytes");
    const dek = aesGcmDecrypt(envelope.dek, kek);
    const plaintext = aesGcmDecrypt(envelope.payload, dek);
    const json = JSON.parse(plaintext.toString("utf8"));
    return json;
}
//# sourceMappingURL=index.js.map