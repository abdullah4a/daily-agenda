import { createError, defineEventHandler, readBody } from 'h3'
import { authenticate, INVALID_CREDENTIALS, loginRateLimits, parseLogin, toPublicUser, toSessionUser } from '../../utils/accounts'
import { connectDb } from '../../utils/db'
import { enforceRateLimits } from '../../utils/rateLimit'

export default defineEventHandler(async (event) => {
  const credentials = parseLogin(await readBody(event))
  await connectDb()
  await enforceRateLimits(event, loginRateLimits(event, credentials.email))

  const user = await authenticate(credentials)
  if (!user) throw createError({ statusCode: 401, statusMessage: INVALID_CREDENTIALS })

  await replaceUserSession(event, { user: toSessionUser(user) })
  return { user: toPublicUser(user) }
})
