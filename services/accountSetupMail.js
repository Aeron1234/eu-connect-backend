import { setTimeout as delay } from 'node:timers/promises';

// EmailJS accepts one request per second. Serialize this process's mail and bound
// both queue size and total wait. No automatic retry can duplicate a delivery.
let tail = Promise.resolve();
let waiting = 0;
let lastStarted = 0;

// Only these bounded diagnostics may cross into application logs. Provider
// response bodies and fetch exceptions can contain credentials or setup links.
export class AccountSetupMailError extends Error {
  constructor(code, httpStatus) {
    super(['EMAIL_CONFIGURATION_REQUIRED', 'EMAIL_QUEUE_BUSY'].includes(code) ? code : 'EMAIL_DELIVERY_UNCONFIRMED');
    this.code = code;
    if (Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599) this.httpStatus = httpStatus;
  }
}

export async function sendAccountSetupEmail({ to, username, token, invitation }) {
  const names = ['EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY', 'CLIENT_URL'];
  if (names.some(name => !process.env[name]?.trim())) throw new AccountSetupMailError('EMAIL_CONFIGURATION_REQUIRED');
  let base;
  try { base = new URL(process.env.CLIENT_URL); }
  catch { throw new AccountSetupMailError('EMAIL_CONFIGURATION_REQUIRED'); }
  if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))) {
    throw new AccountSetupMailError('EMAIL_CONFIGURATION_REQUIRED');
  }
  const setupUrl = new URL('/set-password', base);
  setupUrl.searchParams.set('token', token);
  if (waiting >= 20) throw new AccountSetupMailError('EMAIL_QUEUE_BUSY');
  const deadline = Date.now() + 20_000;
  waiting++;
  const run = tail.then(async () => {
    const pause = Math.max(0, 1100 - (Date.now() - lastStarted));
    if (Date.now() + pause >= deadline) throw new AccountSetupMailError('EMAIL_DELIVERY_TIMEOUT');
    if (pause) await delay(pause);
    lastStarted = Date.now();
    // Credentials and setup tokens never leave the backend except in the intended
    // message. Do not log request options, provider response bodies or setup URLs.
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        accessToken: process.env.EMAILJS_PRIVATE_KEY,
        template_params: {
          to_email: to, username, setup_url: setupUrl.toString(),
          subject: invitation ? 'Set up your EU-Connect account' : 'Reset your EU-Connect password',
          heading: invitation ? 'Your account is ready to set up' : 'Password reset requested',
          instructions: invitation ? 'Your school created your account. Choose your own password using the button below.' : 'Use the button below to choose a new password. If you did not request this, ignore this email.',
          expiry_text: invitation ? '24 hours' : '30 minutes',
        },
      }),
    });
    void res.body?.cancel().catch(() => {});
    if (!res.ok) throw new AccountSetupMailError('EMAIL_PROVIDER_REJECTED', res.status);
  });
  tail = run.catch(() => {});
  try { await run; }
  catch (error) {
    if (error instanceof AccountSetupMailError) throw error;
    throw new AccountSetupMailError(['TimeoutError', 'AbortError'].includes(error?.name) ? 'EMAIL_DELIVERY_TIMEOUT' : 'EMAIL_NETWORK_ERROR');
  } finally { waiting--; }
}
