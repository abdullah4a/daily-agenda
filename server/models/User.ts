import mongoose, { Schema, type Model } from 'mongoose'
import { isValidTime, isValidTimezone } from '../utils/date'

export interface UserDoc {
  email: string
  passwordHash: string
  timezone: string
  reminderTimes: { morning: string, evening: string }
  /** Absent on accounts that predate it: both reminders default to on. */
  reminderEnabled?: { morning: boolean, evening: boolean }
  passwordReset?: { tokenHash?: string, expiresAt?: Date }
  /** Bumped to revoke every existing session. Absent on accounts that predate it. */
  sessionVersion?: number
  createdAt: Date
  updatedAt: Date
}

const timeField = (defaultValue: string) => ({
  type: String,
  default: defaultValue,
  validate: { validator: isValidTime, message: '{VALUE} is not a valid HH:mm time' },
})

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    timezone: {
      type: String,
      default: 'UTC',
      validate: { validator: isValidTimezone, message: '{VALUE} is not a valid IANA timezone' },
    },
    reminderTimes: {
      morning: timeField('08:00'),
      evening: timeField('20:00'),
    },
    reminderEnabled: {
      morning: { type: Boolean, default: true },
      evening: { type: Boolean, default: true },
    },
    passwordReset: {
      tokenHash: { type: String },
      expiresAt: { type: Date },
    },
    sessionVersion: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.passwordHash
        delete ret.passwordReset
        return ret
      },
    },
  },
)

userSchema.index({ 'passwordReset.tokenHash': 1 }, { sparse: true })

export const UserModel: Model<UserDoc>
  = (mongoose.models.User as Model<UserDoc> | undefined) ?? mongoose.model<UserDoc>('User', userSchema)
