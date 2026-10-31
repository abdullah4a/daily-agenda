import { createError, defineEventHandler, readBody } from 'h3'
import { ScheduleModel } from '../../models/Schedule'
import { connectDb } from '../../utils/db'
import { requireUser } from '../../utils/requireUser'
import { validateBlocks } from '../../utils/schedule'

export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  await connectDb()
  const body = await readBody<{ blocks?: unknown } | null>(event)
  const result = validateBlocks(body?.blocks)
  if (!result.ok) throw createError({ statusCode: 400, statusMessage: 'Invalid schedule', data: { message: result.message } })

  const schedule = await ScheduleModel.findOneAndUpdate(
    { user: userId },
    { $set: { blocks: result.blocks } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean()
  return { blocks: schedule!.blocks }
})
