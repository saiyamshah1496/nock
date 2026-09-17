import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import YAML from "yaml";

describe("policy.default.yml keys map to fields used by core check()", () => {
  it("has the rule keys that check() reads", () => {
    const text = readFileSync(join(__dirname, "../../../policy.default.yml"), "utf8");
    const doc = YAML.parse(text);
    expect(doc).toBeTruthy();
    // Top-level
    expect(doc.fail_on).toBeDefined();
    expect(["always", "size_gated"]).toContain(doc.require_lock_timeout);
    // R001 threshold
    expect(doc.rules?.R001?.red_rows).toBeDefined();
    expect(typeof doc.rules.R001.red_rows).toBe("number");
    // R004 knobs
    expect(doc.rules?.R004?.hot_rows).toBeDefined();
    expect(typeof doc.rules.R004.hot_rows).toBe("number");
    expect(typeof doc.rules.R004.require_lock_timeout === "boolean" || typeof doc.rules.R004.require_lock_timeout === "string").toBe(
      true
    );
    // R010 threshold used by check()
    expect(doc.rules?.R010?.always_require_lock_timeout_above_rows).toBeDefined();
    expect(typeof doc.rules.R010.always_require_lock_timeout_above_rows).toBe("number");
  });
});

