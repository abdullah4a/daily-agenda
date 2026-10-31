import { createError, defineEventHandler, readBody } from 'h3'
import { UserModel } from '../../models/User'
import { toSettings } from '../../utils/accounts'
import { connectDb } from '../../utils/db'
import { requireUser } from '../../utils/requireUser'
import { parseSettingsPatch } from '../../utils/settings'

export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  const patch = parseSettingsPatch(await readBody(event))
  await connectDb()
  const user = await UserModel.findByIdAndUpdate(userId, { $set: patch }, { returnDocument: 'after', runValidators: true })
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return { settings: toSettings(user) }
})
