import { createError, defineEventHandler } from 'h3'
import { UserModel } from '../../models/User'
import { localDateString } from '../../utils/date'
import { connectDb } from '../../utils/db'
import { findEntry } from '../../utils/entries'
import { requireUser } from '../../utils/requireUser'
import { getBlockStatuses } from '../../utils/tracking'

export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  await connectDb()
  const user = await UserModel.findById(userId).select('timezone').lean()
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const date = localDateString(user.timezone)
  const [entry, blockStatuses] = await Promise.all([findEntry(userId, date), getBlockStatuses(userId, date)])
  return { entry, blockStatuses }
})
