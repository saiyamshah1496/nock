(function () {
  const SQL_NAIVE = `CREATE INDEX sessions_archived_at_idx
  ON sessions (archived_at);`;

  const SQL_FIX = `CREATE INDEX CONCURRENTLY IF NOT EXISTS
  sessions_archived_at_idx
  ON sessions (archived_at);
-- and drop / skip redundant indexes (R026)`;

  const JSON_IDLE = `{
  "status": "ready",
  "hint": "Run Nock check on the proposed DDL"
}`;

  const JSON_FAIL = `{
  "verdict": "fail",
  "rule_hits": [
    {
      "id": "R025",
      "severity": "red",
      "table": "sessions",
      "n_live_tup": 500000,
      "reason_code": "write_cost_index_on_hot_table"
    },
    {
      "id": "R026",
      "severity": "red",
      "table": "sessions",
      "reason_code": "redundant_index_risk"
    }
  ]
}`;

  const JSON_PASS = `{
  "verdict": "pass",
  "rule_hits": [],
  "note": "Concurrent build + no redundant sibling"
}`;

  const PLAIN_IDLE =
    "Estate knows <strong>sessions</strong> is write-heavy (~500k live tuples). Pattern lint alone would shrug.";
  const PLAIN_FAIL =
    "<strong>Blocked.</strong> R025 write-cost on a hot table + R026 redundant-index risk — fail-closed. Same engine in CLI, CI, and Cursor MCP.";
  const PLAIN_PASS =
    "<strong>Cleared after remediation.</strong> Concurrent index build; skip the redundant path. Verdict vignette only — Nock never applies migrations.";

  const sqlPane = document.getElementById("sql-pane");
  const jsonPane = document.getElementById("json-pane");
  const plainPane = document.getElementById("plain-pane");
  const chip = document.getElementById("verdict-chip");
  const label = document.getElementById("verdict-label");
  const runBtn = document.getElementById("run-check");
  const fixBtn = document.getElementById("show-fix");
  const tabs = Array.from(document.querySelectorAll(".tab"));

  function setChip(kind, text) {
    chip.className = "chip " + kind;
    chip.textContent = text;
  }

  function showStep(step) {
    tabs.forEach((t) => {
      const on = t.dataset.step === step;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });

    if (step === "propose") {
      sqlPane.textContent = SQL_NAIVE;
      jsonPane.textContent = JSON_IDLE;
      plainPane.innerHTML = PLAIN_IDLE;
      label.textContent = "pending";
      setChip("idle", "Idle");
      fixBtn.hidden = true;
      runBtn.hidden = false;
    } else if (step === "fail") {
      sqlPane.textContent = SQL_NAIVE;
      jsonPane.textContent = JSON_FAIL;
      plainPane.innerHTML = PLAIN_FAIL;
      label.textContent = 'verdict: "fail"';
      setChip("fail", "FAIL");
      fixBtn.hidden = false;
      runBtn.hidden = true;
    } else {
      sqlPane.textContent = SQL_FIX;
      jsonPane.textContent = JSON_PASS;
      plainPane.innerHTML = PLAIN_PASS;
      label.textContent = 'verdict: "pass"';
      setChip("pass", "PASS");
      fixBtn.hidden = true;
      runBtn.hidden = false;
      runBtn.textContent = "Reset vignette";
    }
  }

  showStep("propose");

  tabs.forEach((t) =>
    t.addEventListener("click", () => {
      runBtn.textContent = "Run Nock check";
      showStep(t.dataset.step);
    })
  );

  runBtn.addEventListener("click", () => {
    if (runBtn.textContent === "Reset vignette") {
      runBtn.textContent = "Run Nock check";
      showStep("propose");
      return;
    }
    showStep("fail");
  });

  fixBtn.addEventListener("click", () => {
    runBtn.textContent = "Reset vignette";
    showStep("fix");
  });

  // Copy buttons
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sel = btn.getAttribute("data-copy");
      const el = document.querySelector(sel);
      if (!el) return;
      const text = el.textContent.trim();
      try {
        await navigator.clipboard.writeText(text);
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = prev), 1200);
      } catch (_) {
        btn.textContent = "Select & copy";
      }
    });
  });

  // Waitlist form → Formspree
  const form = document.getElementById("waitlist-form");
  const status = document.getElementById("form-status");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.className = "form-status";
    status.textContent = "";
    const endpoint = window.WAITLIST_FORM_ENDPOINT;
    if (!endpoint || endpoint.includes("your-form-id")) {
      status.className = "form-status err";
      status.textContent = "Form endpoint not configured.";
      return;
    }
    const email = form.email.value.trim();
    if (!email || !email.includes("@")) {
      status.className = "form-status err";
      status.textContent = "Enter a valid work email.";
      form.email.focus();
      return;
    }
    const fd = new FormData(form);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: fd,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("bad status");
      status.className = "form-status ok";
      status.textContent = "You’re on the list. We’ll be in touch.";
      form.reset();
    } catch (_) {
      status.className = "form-status err";
      status.textContent = "Couldn’t submit — try again or email via GitHub.";
    } finally {
      btn.disabled = false;
    }
  });
})();
