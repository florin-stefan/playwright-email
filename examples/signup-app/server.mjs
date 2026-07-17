// Minimal signup app that emails a 6-digit verification code.
// Reads SMTP_HOST / SMTP_PORT from the environment — in tests these are set
// automatically by `playwright-email/global-setup`.
import { createServer } from 'node:http';
import nodemailer from 'nodemailer';

const PORT = Number(process.env.PORT ?? 4001);
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? '127.0.0.1',
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: false,
  tls: { rejectUnauthorized: false },
});

const pendingCodes = new Map();

const page = (body) => `<!doctype html>
<html><head><title>Demo App</title></head><body style="font-family: sans-serif; max-width: 30rem; margin: 3rem auto">
${body}
</body></html>`;

const signupForm = page(`
  <h1>Create your account</h1>
  <form method="POST" action="/signup">
    <label for="email">Email</label><br>
    <input id="email" name="email" type="email" required style="width: 100%; padding: .5rem"><br><br>
    <button type="submit">Sign up</button>
  </form>`);

const verifyForm = (email, error = '') => page(`
  <h1>Check your email</h1>
  <p>We sent a verification code to <strong>${email}</strong>.</p>
  ${error ? `<p style="color: red">${error}</p>` : ''}
  <form method="POST" action="/verify">
    <input type="hidden" name="email" value="${email}">
    <label for="code">Verification code</label><br>
    <input id="code" name="code" inputmode="numeric" required style="width: 100%; padding: .5rem"><br><br>
    <button type="submit">Verify</button>
  </form>`);

async function readForm(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return Object.fromEntries(new URLSearchParams(raw));
}

createServer(async (req, res) => {
  const respond = (html, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  };

  if (req.method === 'GET' && req.url === '/') return respond(signupForm);

  if (req.method === 'POST' && req.url === '/signup') {
    const { email } = await readForm(req);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    pendingCodes.set(email, code);
    await transport.sendMail({
      from: 'Demo App <noreply@demo.test>',
      to: email,
      subject: 'Your code for Demo App',
      text: `Hi!\n\nYour verification code is ${code}. It expires in 10 minutes.\n\nDemo App`,
      html: `<p>Hi!</p><p>Your verification code is:</p><h2>${code}</h2><p>It expires in 10 minutes.</p>`,
    });
    return respond(verifyForm(email));
  }

  if (req.method === 'POST' && req.url === '/verify') {
    const { email, code } = await readForm(req);
    if (pendingCodes.get(email) === code) {
      pendingCodes.delete(email);
      return respond(page('<h1>Welcome aboard! 🎉</h1><p>Your email is verified.</p>'));
    }
    return respond(verifyForm(email, 'That code is not valid.'), 400);
  }

  respond(page('<h1>Not found</h1>'), 404);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`demo app listening on http://127.0.0.1:${PORT}`);
});
