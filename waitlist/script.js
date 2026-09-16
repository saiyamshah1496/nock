(() => {
  const form = document.getElementById('waitlist-form');
  const emailInput = document.getElementById('email');
  const submitBtn = document.getElementById('submit-btn');
  const statusEl = document.getElementById('form-status');

  const setStatus = (msg, type) => {
    statusEl.textContent = msg;
    statusEl.classList.remove('success', 'error');
    if (type) statusEl.classList.add(type);
  };

  const validateEmail = (email) => {
    if (!email) return false;
    // Simple RFC 5322‑ish check
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const endpoint = (window && window.WAITLIST_FORM_ENDPOINT) || '';
    const email = (emailInput.value || '').trim();

    if (!endpoint) {
      setStatus('Configure WAITLIST_FORM_ENDPOINT in waitlist/config.js before submitting.', 'error');
      return;
    }
    if (!validateEmail(email)) {
      setStatus('Enter a valid work email.', 'error');
      emailInput.focus();
      return;
    }

    setStatus('Submitting…');
    submitBtn.disabled = true;

    try {
      const fd = new FormData(form);
      // Include a basic source tag to help downstreams
      if (!fd.has('source')) fd.set('source', 'nock-waitlist');

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: fd
      });

      if (res.ok) {
        setStatus('Thanks — you’re on the list. We’ll be in touch soon.', 'success');
        form.reset();
      } else {
        // Try to read error for Formspree‑style APIs
        let message = 'Something went wrong. Please try again.';
        try {
          const data = await res.json();
          if (data && (data.error || data.message)) {
            message = data.error || data.message;
          }
        } catch (_) { /* no-op */ }
        setStatus(message, 'error');
      }
    } catch (err) {
      setStatus('Network error. Check your connection and try again.', 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });
})();

