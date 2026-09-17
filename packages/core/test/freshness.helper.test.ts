import { describe, it, expect } from "vitest";
import { computeFreshness, FRESHNESS_WARN_MS, FRESHNESS_STALE_MS } from "../src/index";

describe("computeFreshness", () => {
  const now = new Date("2026-09-17T06:00:00Z");

  it("returns missing when capturedAt is null/undefined/unparseable", () => {
    expect(computeFreshness(undefined, now)).toBe("missing");
    expect(computeFreshness(null as any, now)).toBe("missing");
    expect(computeFreshness("not-a-date", now)).toBe("missing");
  });

  it("classifies fresh when age <= 7d", () => {
    const justNow = new Date(now.getTime());
    expect(computeFreshness(justNow, now)).toBe("fresh");
    const at7d = new Date(now.getTime() - FRESHNESS_WARN_MS);
    expect(computeFreshness(at7d, now)).toBe("fresh");
    const within7d = new Date(now.getTime() - (FRESHNESS_WARN_MS - 1));
    expect(computeFreshness(within7d, now)).toBe("fresh");
  });

  it("classifies warn when 7d < age <= 30d", () => {
    const justOver7d = new Date(now.getTime() - (FRESHNESS_WARN_MS + 1));
    expect(computeFreshness(justOver7d, now)).toBe("warn");
    const at30d = new Date(now.getTime() - FRESHNESS_STALE_MS);
    expect(computeFreshness(at30d, now)).toBe("warn");
  });

  it("classifies stale when age > 30d", () => {
    const over30d = new Date(now.getTime() - (FRESHNESS_STALE_MS + 1));
    expect(computeFreshness(over30d, now)).toBe("stale");
  });

  it("accepts ISO string input", () => {
    const ts = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000)); // 2d
    expect(computeFreshness(ts.toISOString(), now)).toBe("fresh");
  });
});

