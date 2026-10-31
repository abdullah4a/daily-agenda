import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3'
import { UserModel } from '../../models/User'
import { hashAccountPassword, parseSignup, signupRateLimits, toPublicUser, toSessionUser } from '../../utils/accounts'
import { connectDb } from '../../utils/db'
import { enforceRateLimits } from '../../utils/rateLimit'

export default defineEventHandler(async (event) => {
  const { email, password, timezone } = parseSignup(await readBody(event))
  await connectDb()
  await enforceRateLimits(event, signupRateLimits(event))

  const passwordHash = await hashAccountPassword(password)
  // No prior lookup: the unique index is the only check that survives a race.
  const user = await UserModel.create({ email, passwordHash, timezone }).catch((error: unknown) => {
    if ((error as { code?: number }).code === 11000) {
      throw createError({ statusCode: 409, statusMessage: 'An account with this email already exists' })
    }
    throw error
  })

  await replaceUserSession(event, { user: toSessionUser(user) })
  setResponseStatus(event, 201)
  return { user: toPublicUser(user) }
})
