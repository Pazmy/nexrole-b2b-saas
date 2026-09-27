// Explicit local production-test preload only. Never imported by the app.
// Captures the Resend HTTP boundary into private previews; no real email is sent.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is required for this Node --require preload. */
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
if (process.env.RESEND_API_KEY !== 're_e2e_preview') throw new Error('This preload requires the test-only Resend credential.');
const originalFetch = global.fetch;
global.fetch = async function (input, options) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url !== 'https://api.resend.com/emails') return originalFetch(input, options);
  if (options?.headers?.Authorization !== 'Bearer re_e2e_preview') throw new Error('Unexpected email credentials in test transport.');
  const body = JSON.parse(options.body);
  if (!Array.isArray(body.to) || body.to.length !== 1 || !body.to[0].endsWith('@example.test')) throw new Error('Only fixture recipients are allowed.');
  if (body.to[0].startsWith('fail-')) return new Response(null, { status: 503 });
  const directory = path.resolve(process.cwd(), '.email-previews');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, `${Date.now()}-${randomUUID()}.txt`), `To: ${body.to[0]}\nSubject: ${body.subject}\n\n${body.text}`, { mode: 0o600, flag: 'wx' });
  return new Response('{}', { status: 200 });
};
