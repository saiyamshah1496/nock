# Nock — Waitlist One-Pager

Private beta / waitlist landing page for Nock. Static HTML/CSS/JS — no framework required.

## Production configuration
- This branch commits `waitlist/config.js` pointing to the production Formspree endpoint:  
  `https://formspree.io/f/xyezgqoy`
- You can override this for staging/local testing by editing `waitlist/config.js` or using the sample file below.

## What this is
- Single-page landing focused on the problem, what Nock does, how it thinks, and a pricing teaser
- Email capture that POSTs to a configurable endpoint (Formspree or your serverless webhook)
- Completely separate from any application/CLI code

## Preview locally
From the repo root:
```bash
cd waitlist
# Option A: Python (built-in)
python3 -m http.server 8080
# Option B: Node
npx serve -l 8080 .
```
Then open `http://localhost:8080/`.

## Configure the waitlist endpoint
Already configured for production:
- `waitlist/config.js` is set to `https://formspree.io/f/xyezgqoy`

To use a different sink, either edit `waitlist/config.js` directly, or copy the sample as a starting point:
```bash
cd waitlist
cp config.sample.js config.js
# then edit config.js and set:
# window.WAITLIST_FORM_ENDPOINT = 'https://formspree.io/f/<your-form-id>'
```

2) Choose your sink:
- Formspree (recommended to start): create a form and set  
  `window.WAITLIST_FORM_ENDPOINT = 'https://formspree.io/f/<your-form-id>'`
- Custom serverless webhook: point `WAITLIST_FORM_ENDPOINT` at your function URL and accept a `POST` with multipart `email` (and optional `source`) fields

The form submitter sends:
- Method: `POST`
- Headers: `Accept: application/json`
- Body: `multipart/form-data` (via `FormData`), fields: `email`, `source='nock-waitlist'`

The UI will show a success message on any 2xx response, or surface JSON `{ error | message }` strings when available (Formspree-style).

## Editing copy or styles
- Update `index.html` sections inline
- Styles live in `style.css`
- Form behavior is in `script.js`

## Notes
- This is framed as "Private beta · Waitlist" — not a public launch site
- No invented outage figures; tone is sharp, technical, credible for platform/SRE leads
- `waitlist/config.js` is committed with the production endpoint; override locally by editing it or using `config.sample.js`

