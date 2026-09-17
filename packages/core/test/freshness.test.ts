import { describe, it, expect } from "vitest";
import { evaluateEstateFreshness, type EstateSnapshot } from "../src";

function snapAt(deltaMs: number): EstateSnapshot {
  return {
    tables: [],
    captured_at: new Date(Date.now() + deltaMs).toISOString(),
  };
}

describe("estate freshness classification", () => {
  it("classifies fresh under 7 days", () => {
    const fres = evaluateEstateFreshness(snapAt(-3 * 24 * 3600 * 1000));
    expect(fres.classification).toBe("fresh");
  });
  it("warns at >= 7 days", () => {
    const fres = evaluateEstateFreshness(snapAt(-7 * 24 * 3600 * 1000));
    expect(fres.classification).toBe("warn");
  });
  it("neutral stale at > 30 days", () => {
    const fres = evaluateEstateFreshness(snapAt(-31 * 24 * 3600 * 1000));
    expect(fres.classification).toBe("neutral_stale");
  });
  it("rejects skew > 1 hour", () => {
    const fres = evaluateEstateFreshness(snapAt(-2 * 3600 * 1000), undefined, "push-validate");
    expect(fres.classification).toBe("reject_skew");
  });
});

