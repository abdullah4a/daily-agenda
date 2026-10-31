import { defineEventHandler, readBody } from 'h3'
import { PushSubscriptionModel } from '../../models/PushSubscription'
import { connectDb } from '../../utils/db'
import { parseEndpoint } from '../../utils/settings'
import { requireUser } from '../../utils/requireUser'

export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  const body = await readBody<{ endpoint?: unknown } | null>(event)
  const endpoint = parseEndpoint(body?.endpoint)
  await connectDb()
  await PushSubscriptionModel.deleteOne({ user: userId, endpoint })
  return { ok: true }
})
