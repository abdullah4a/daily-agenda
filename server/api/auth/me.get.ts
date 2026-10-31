import { createError, defineEventHandler } from 'h3'
import { UserModel } from '../../models/User'
import { toPublicUser } from '../../utils/accounts'
import { connectDb } from '../../utils/db'
import { requireUser } from '../../utils/requireUser'

export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  await connectDb()
  const user = await UserModel.findById(userId)
  if (!user) {
    // The account is gone but its sealed cookie is still valid.
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return { user: toPublicUser(user) }
})
