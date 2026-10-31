import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { connectDb } from '../../utils/db'
import { parseDateParam, parseEntryPatch, saveEntry } from '../../utils/entries'
import { requireUser } from '../../utils/requireUser'

export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  const date = parseDateParam(getRouterParam(event, 'date'))
  const patch = parseEntryPatch(await readBody(event))
  await connectDb()
  return { entry: await saveEntry(userId, date, patch) }
})
