// Copy this file to `config.js` in the same folder and set your endpoint.
// 1) Formspree (recommended for a quick waitlist sink):
//    - Create a form at https://formspree.io/
//    - Replace 'your-form-id' below with your real ID (looks like 'mnnqrxyz')
//    - Formspree will accept multipart/form-data and return JSON if Accept: application/json is sent
//
// 2) Custom serverless webhook:
//    - Point this at your function URL and accept POSTed FormData with an `email` field.
//    - If you forward internally (e.g., to Slack/CRM), keep secrets in your function, not here.
//
// Do not commit secrets to version control.
window.WAITLIST_FORM_ENDPOINT = 'https://formspree.io/f/your-form-id';

