import { createError, defineEventHandler, readBody } from 'h3'
import { UserModel } from '../../models/User'
import { hashAccountPassword, resetPasswordRateLimits } from '../../utils/accounts'
import { connectDb } from '../../utils/db'
import { INVALID_RESET_TOKEN, hashResetToken, parseResetPassword } from '../../utils/passwordReset'
import { enforceRateLimits } from '../../utils/rateLimit'

export default defineEventHandler(async (event) => {
  const { token, password } = parseResetPassword(await readBody(event))
  await connectDb()
  await enforceRateLimits(event, resetPasswordRateLimits(event))

  const passwordHash = await hashAccountPassword(password)
  // One atomic update: of two concurrent uses of a token, only one can match.
  const user = await UserModel.findOneAndUpdate(
    { 'passwordReset.tokenHash': hashResetToken(token), 'passwordReset.expiresAt': { $gt: new Date() } },
    { $set: { passwordHash }, $unset: { passwordReset: 1 }, $inc: { sessionVersion: 1 } },
    { projection: { _id: 1 } },
  )
  if (!user) throw createError({ statusCode: 400, statusMessage: INVALID_RESET_TOKEN })
  // Any session in this browser is now out of date; without this its cookie still reads as signed in.
  await clearUserSession(event)
  return { ok: true }
})
