import { defineEventHandler, readBody } from 'h3'
import { UserModel } from '../../models/User'
import { forgotPasswordRateLimits, normaliseEmail } from '../../utils/accounts'
import { connectDb } from '../../utils/db'
import {
  FORGOT_PASSWORD_RESPONSE,
  RESET_TOKEN_TTL_MS,
  createResetToken,
  hashResetToken,
  resetBaseUrl,
  resetLink,
  runAfterResponse,
  sendResetEmail,
} from '../../utils/passwordReset'
import { enforceRateLimits } from '../../utils/rateLimit'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as { email?: unknown } | null
  const email = normaliseEmail(body?.email)
  await connectDb()
  await enforceRateLimits(event, forgotPasswordRateLimits(event, email))
  if (!email) return FORGOT_PASSWORD_RESPONSE

  const baseUrl = resetBaseUrl(event)
  if (!baseUrl) {
    console.error('[password-reset] APP_BASE_URL is missing or invalid; no reset link can be built')
    return FORGOT_PASSWORD_RESPONSE
  }

  const token = createResetToken()
  // One update whether or not the account exists, so both take the same time.
  // Overwriting also retires any earlier link.
  const { matchedCount } = await UserModel.updateOne({ email }, {
    $set: {
      passwordReset: {
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    },
  })
  if (matchedCount) await runAfterResponse(event, () => sendResetEmail(email, resetLink(baseUrl, token)))
  return FORGOT_PASSWORD_RESPONSE
})
