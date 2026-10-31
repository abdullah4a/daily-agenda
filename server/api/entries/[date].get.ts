import { defineEventHandler, getRouterParam } from 'h3'
import { connectDb } from '../../utils/db'
import { findEntry, parseDateParam } from '../../utils/entries'
import { requireUser } from '../../utils/requireUser'

export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  const date = parseDateParam(getRouterParam(event, 'date'))
  await connectDb()
  return { entry: await findEntry(userId, date) }
})
