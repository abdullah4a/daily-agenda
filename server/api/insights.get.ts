import { defineEventHandler, getQuery } from 'h3'
import { connectDb } from '../utils/db'
import { requireUser } from '../utils/requireUser'
import { computeInsights, parseRange } from '../utils/tracking'

export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  const { from, to } = parseRange(getQuery(event))
  await connectDb()
  return computeInsights(userId, from, to)
})
