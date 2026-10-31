import { createError, defineEventHandler } from 'h3'
import { UserModel } from '../../models/User'
import { toSettings } from '../../utils/accounts'
import { connectDb } from '../../utils/db'
import { requireUser } from '../../utils/requireUser'

export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  await connectDb()
  const user = await UserModel.findById(userId)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return { settings: toSettings(user) }
})
