import mongoose, { Schema, type Model, type Types } from 'mongoose'
import { isValidDateString } from '../utils/date'

export interface PushSubscriptionDoc {
  user: Types.ObjectId
  endpoint: string
  keys: { p256dh: string, auth: string }
  /** Local date of the last reminder sent, so a cron retry cannot send twice in a day. */
  lastMorningReminderDate?: string
  lastEveningReminderDate?: string
  createdAt: Date
  updatedAt: Date
}

const reminderDateField = {
  type: String,
  validate: { validator: isValidDateString, message: '{VALUE} is not a valid YYYY-MM-DD date' },
}

const pushSubscriptionSchema = new Schema<PushSubscriptionDoc>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    lastMorningReminderDate: reminderDateField,
    lastEveningReminderDate: reminderDateField,
  },
  { timestamps: true },
)

export const PushSubscriptionModel: Model<PushSubscriptionDoc>
  = (mongoose.models.PushSubscription as Model<PushSubscriptionDoc> | undefined)
    ?? mongoose.model<PushSubscriptionDoc>('PushSubscription', pushSubscriptionSchema)
