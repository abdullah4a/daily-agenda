import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { ScheduleModel } from '../../../../models/Schedule'
import { connectDb } from '../../../../utils/db'
import { parseDateParam } from '../../../../utils/entries'
import { getOrCreateSchedule } from '../../../../utils/schedule'
import { getBlockStatuses, parseBlockId, parseBlockSnapshot, parseStatusBody, setBlockStatus, snapshotBlock } from '../../../../utils/tracking'
import { requireUser } from '../../../../utils/requireUser'

export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  const date = parseDateParam(getRouterParam(event, 'date'))
  const blockId = parseBlockId(getRouterParam(event, 'blockId'))
  const body = await readBody(event)
  const status = parseStatusBody(body)
  const supplied = status === null ? null : parseBlockSnapshot(body)
  await connectDb()

  if (status === null) {
    await setBlockStatus(userId, date, blockId, null)
  }
  else {
    // A queued check-off carries its block: the schedule may have changed since it was made.
    const blocks = supplied ? [] : await getOrCreateSchedule(ScheduleModel, userId)
    const block = supplied ? { ...supplied, id: blockId } : blocks.find(b => b.id === blockId)
    if (!block) throw createError({ statusCode: 404, statusMessage: 'Block not found in your schedule' })
    await setBlockStatus(userId, date, blockId, snapshotBlock(block, status))
  }
  return { date, blockStatuses: await getBlockStatuses(userId, date) }
})
