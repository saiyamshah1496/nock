// Lightweight formatter helpers intentionally avoid importing @nockhq/core
// to keep unit tests decoupled from package build order.

function fmt(num?: number): string {
  if (num === undefined) return "?";
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + "B";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(2) + "k";
  return String(num);
}

function resolveViolationTable(
  violation: { rule_id: string; message: string },
  statements: Array<{ target?: { schema: string; name: string }; rules_hit?: string[] }>
): { schema?: string; name?: string; display: string } {
  const hit = statements.find((s) => s.target && (s.rules_hit || []).includes(violation.rule_id));
  if (hit?.target) {
    const { schema, name } = hit.target;
    return { schema, name, display: `${schema}.${name}` };
  }
  const msg = violation.message || "";
  let schema: string | undefined;
  let name: string | undefined;
  {
    const m = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/.exec(msg);
    if (m) {
      schema = m[1];
      name = m[2];
    }
  }
  if (!name) {
    const m =
      /\bon\s+hot\s+table\s+([A-Za-z0-9_".]+)/i.exec(msg) ||
      /\bon\s+([A-Za-z0-9_".]+)/i.exec(msg) ||
      /\btouched\s+table\s+([A-Za-z0-9_".]+)/i.exec(msg);
    if (m) {
      const raw = m[1].replace(/"/g, "");
      if (raw.includes(".")) {
        const parts = raw.split(".");
        schema = parts[0];
        name = parts[1];
      } else {
        name = raw;
        // Try to fill schema from statements that reference the same table name
        const hit = statements.find(
          (st) => st.target && st.target.name.toLowerCase() === raw.toLowerCase()
        );
        if (hit?.target?.schema) {
          schema = hit.target.schema;
        }
      }
    }
  }
  const display = schema && name ? `${schema}.${name}` : name ? name : "unknown";
  return { schema, name, display };
}

function findRowsForTableLike(
  t: { schema?: string; name?: string },
  statements: Array<{ target?: { schema: string; name: string }; n_live_tup?: number }>
): number | undefined {
  if (!t) return undefined;
  if (t.schema && t.name) {
    const s = statements.find(
      (st) =>
        st.target &&
        st.target.schema.toLowerCase() === t.schema!.toLowerCase() &&
        st.target.name.toLowerCase() === t.name!.toLowerCase() &&
        typeof st.n_live_tup === "number"
    );
    if (s) return s.n_live_tup;
  }
  if (t.name) {
    const s2 = statements.find(
      (st) => st.target && st.target.name.toLowerCase() === t.name!.toLowerCase() && typeof st.n_live_tup === "number"
    );
    if (s2) return s2.n_live_tup;
  }
  return undefined;
}

const SIZE_GATED = new Set([
  "R001",
  "R003",
  "R004",
  "R005",
  "R006",
  "R007",
  "R008",
  "R010",
  "R013",
  "R014",
  "R015",
  "R016",
  "R017",
  "R018",
  "R022",
  "R024",
  "R025",
  "R026"
]);
const CATALOGUE_RULES = new Set(["R023", "R024", "R025", "R026", "R009"]);

export function renderComment(verdict: any): string {
  const violations = Array.isArray(verdict?.violations) ? verdict.violations : [];
  const statements = Array.isArray(verdict?.statements) ? verdict.statements : [];
  const redCount = violations.filter((v: any) => v.severity === "red").length;
  const yellowCount = violations.filter((v: any) => v.severity === "yellow").length;
  const status = redCount > 0 ? "RED" : yellowCount > 0 ? "YELLOW" : "PASS";

  const lines: string[] = [];
  lines.push("<!-- nock:verdict -->");
  lines.push(`### Nock — ${status}`);

  if (status === "PASS") {
    lines.push("No violations. Updating status to PASS.");
    lines.push("<!-- /nock:verdict -->");
    return lines.join("\n");
  }

  lines.push(`Violations: ${redCount} red, ${yellowCount} yellow.`);

  for (const v of violations as Array<{
    rule_id: string;
    severity: "red" | "yellow";
    message: string;
    remediation_sql?: string;
    docs_url?: string;
  }>) {
    const tref = resolveViolationTable(v, statements);
    const rows = findRowsForTableLike(tref, statements);
    const whyBits: string[] = [];
    if (typeof rows === "number") {
      whyBits.push("`n_live_tup` ≈ " + fmt(rows) + " (from statement/estate)");
    } else {
      whyBits.push("estate size: unknown");
    }
    if (CATALOGUE_RULES.has(v.rule_id)) {
      whyBits.push("catalogue signalled");
    } else if (SIZE_GATED.has(v.rule_id)) {
      whyBits.push("size-gated severity");
    }

    lines.push("");
    lines.push(`#### ${v.rule_id} · ${tref.display} · ${v.severity}`);
    lines.push(`**Why this estate:** ${whyBits.join(" — ")}`);
    lines.push(`**Finding:** ${v.message}`);
    if (v.remediation_sql && v.remediation_sql.trim().length > 0) {
      lines.push("**Remediation** (pasteable):");
      lines.push("```sql");
      lines.push(v.remediation_sql.trim());
      lines.push("```");
    }
    if (v.docs_url && v.docs_url.trim().length > 0) {
      lines.push(`Docs: ${v.docs_url.trim()}`);
    }
  }
  lines.push("");
  lines.push("<!-- /nock:verdict -->");
  return lines.join("\n");
}

