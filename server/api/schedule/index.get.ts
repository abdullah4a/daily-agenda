import { defineEventHandler } from 'h3'
import { ScheduleModel } from '../../models/Schedule'
import { connectDb } from '../../utils/db'
import { requireUser } from '../../utils/requireUser'
import { findScheduleBlocks } from '../../utils/schedule'

export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  await connectDb()
  return { blocks: await findScheduleBlocks(ScheduleModel, userId) }
})
