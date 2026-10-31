import { defineEventHandler, readBody } from 'h3'
import { PushSubscriptionModel } from '../../models/PushSubscription'
import { connectDb } from '../../utils/db'
import { parsePushSubscription, PUSH_LIMITS } from '../../utils/settings'
import { requireUser } from '../../utils/requireUser'

export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  const { endpoint, keys } = parsePushSubscription(await readBody(event))
  await connectDb()

  // Upsert by endpoint and reassign it to the caller, so a shared device stops notifying the previous user.
  await PushSubscriptionModel.findOneAndUpdate(
    { endpoint },
    {
      $set: { user: userId, keys },
      $unset: { lastMorningReminderDate: '', lastEveningReminderDate: '' },
    },
    { upsert: true, runValidators: true },
  )

  // Keep only the newest few devices per user.
  const stale = await PushSubscriptionModel.find({ user: userId })
    .sort({ updatedAt: -1 }).skip(PUSH_LIMITS.perUser).select('_id').lean()
  if (stale.length) await PushSubscriptionModel.deleteMany({ _id: { $in: stale.map(s => s._id) }, user: userId })

  return { ok: true }
})
