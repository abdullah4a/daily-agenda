import mongoose, { Schema, type Model } from 'mongoose'

export interface RateLimitDoc {
  /** SHA-256 of the scope and subject, so no email or IP is stored in clear. */
  key: string
  count: number
  expiresAt: Date
}

const rateLimitSchema = new Schema<RateLimitDoc>({
  key: { type: String, required: true, unique: true },
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
})

// Housekeeping only: MongoDB sweeps TTL indexes about once a minute, so window
// expiry itself is enforced by the update in consumeRateLimit.
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const RateLimitModel: Model<RateLimitDoc>
  = (mongoose.models.RateLimit as Model<RateLimitDoc> | undefined)
    ?? mongoose.model<RateLimitDoc>('RateLimit', rateLimitSchema)
