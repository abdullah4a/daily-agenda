import { defineEventHandler, readBody } from 'h3'
import { PushSubscriptionModel } from '../../models/PushSubscription'
import { connectDb } from '../../utils/db'
import { parseEndpoint } from '../../utils/settings'

/**
 * Takes this device's push endpoint in the same request: the client only touches its own
 * subscription after this succeeds, by when the session a separate unsubscribe needs is gone.
 * Signing out must always work, so a push cleanup failure never fails it.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ endpoint?: unknown } | null>(event).catch(() => null)
  const { user } = await getUserSession(event)
  if (user?.id && body?.endpoint) {
    try {
      await connectDb()
      await PushSubscriptionModel.deleteOne({ user: user.id, endpoint: parseEndpoint(body.endpoint) })
    }
    catch { /* best effort */ }
  }
  await clearUserSession(event)
  return { ok: true }
})
