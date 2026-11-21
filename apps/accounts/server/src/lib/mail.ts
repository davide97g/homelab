import { Resend } from 'resend'
import { env } from '../env.ts'

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function frame(title: string, body: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${esc(cta.url)}" style="background:#f2f2f3;color:#0a0a0b;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">${esc(cta.label)}</a></p>`
    : ''
  return `<!doctype html><html><body style="margin:0;background:#0a0a0b;font-family:-apple-system,system-ui,sans-serif;color:#f2f2f3">
<div style="max-width:480px;margin:0 auto;padding:40px 24px">
<h1 style="font-size:22px;margin:0 0 16px">${esc(title)}</h1>
<div style="font-size:15px;line-height:1.6;color:#c8c8cc">${body}</div>${button}
<p style="font-size:12px;color:#6e6e76;margin-top:40px">accounts.davideghiotto.it</p>
</div></body></html>`
}

async function send(to: string, subject: string, html: string, text: string) {
  if (!resend) {
    console.log(`[mail] to ${to}: ${subject}\n${text}`)
    return
  }
  const { error } = await resend.emails.send({ from: env.MAIL_FROM, to, subject, html, text })
  if (error) {
    console.error(`[mail] send failed: ${error.message}`)
    throw new Error('Email non inviata, riprova tra poco')
  }
}

export async function sendCode(email: string, otp: string) {
  if (env.DEV_OTP) {
    console.log(`[mail] dev code for ${email}: ${otp}`)
    return
  }
  const body = `Il tuo codice di accesso:<br><span style="font-size:32px;letter-spacing:6px;font-weight:700;color:#f2f2f3">${otp}</span><br><br>Scade tra 10 minuti. Se non sei stato tu, ignora questa email.`
  await send(email, `${otp} è il tuo codice`, frame('Codice di accesso', body), `Codice: ${otp} (scade tra 10 minuti)`)
}

export async function sendInvite(email: string, url: string, apps: string[], from: string) {
  const list = apps.length ? apps.join(', ') : 'i servizi di casa'
  const body = `${esc(from)} ti ha invitato a usare ${esc(list)}.<br>Apri il link e conferma la tua email con un codice: nessuna password da ricordare.`
  await send(email, 'Sei stato invitato', frame('Sei stato invitato', body, { label: 'Accetta invito', url }), `${from} ti ha invitato (${list}). Accetta: ${url}`)
}
