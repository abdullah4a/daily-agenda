import nodemailer from 'nodemailer'

export interface MailMessage {
  to: string
  subject: string
  html: string
  text: string
}

const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 }
/** Plain local catchers such as Mailpit; they offer no TLS. */
const LOCAL_PLAIN_PORTS = new Set([1025, 1026])

export function escapeHtml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }
  return value.replace(/[&<>"']/g, char => entities[char] ?? char)
}

export function isSmtpConfigured(): boolean {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_FROM } = process.env
  return Boolean(SMTP_HOST && Number.isInteger(Number(SMTP_PORT)) && Number(SMTP_PORT) > 0 && (SMTP_FROM || SMTP_USER))
}

/**
 * A transport per send: serverless instances freeze between requests, so a pool
 * would only hold dead sockets. `secure` follows the port because a wrong flag
 * hangs instead of failing.
 */
function createTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, NODE_ENV } = process.env
  const port = Number(SMTP_PORT)
  const secure = port === 465
  const plainLocal = NODE_ENV !== 'production' && LOCAL_PLAIN_PORTS.has(port)
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    requireTLS: !secure && !plainLocal,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    ...TIMEOUTS,
  })
}

/** Returns false, after a warning, when SMTP is not configured. Throws if sending fails. */
export async function sendMail(message: MailMessage): Promise<boolean> {
  if (!isSmtpConfigured()) {
    console.warn('[mail] SMTP is not configured (SMTP_HOST, SMTP_PORT, SMTP_FROM or SMTP_USER); email not sent')
    return false
  }
  const transport = createTransport()
  try {
    await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, ...message })
    return true
  }
  finally {
    transport.close()
  }
}
