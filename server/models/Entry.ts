import mongoose, { Schema, type Model, type Types } from 'mongoose'
import { isValidDateString, isValidTime } from '../utils/date'

export const BLOCK_STATUSES = ['done', 'skipped'] as const
export type BlockStatusValue = (typeof BLOCK_STATUSES)[number]

/** Snapshot of the block, so history survives later schedule edits. */
export interface BlockStatus {
  blockId: string
  label: string
  start: string
  end: string
  status: BlockStatusValue
  productive: boolean
}

export interface EntryDoc {
  user: Types.ObjectId
  date: string
  morningAnswer: string
  eveningAnswer: string
  /** Client time of the last accepted write per field; drives last-write-wins. */
  morningAnswerAt?: Date
  eveningAnswerAt?: Date
  blockStatuses: BlockStatus[]
  updatedAt: Date
}

const timeField = {
  type: String,
  required: true,
  validate: { validator: isValidTime, message: '{VALUE} is not a valid HH:mm time' },
}

const blockStatusSchema = new Schema<BlockStatus>(
  {
    blockId: { type: String, required: true },
    label: { type: String, required: true },
    start: timeField,
    end: timeField,
    status: { type: String, enum: BLOCK_STATUSES, required: true },
    productive: { type: Boolean, default: false },
  },
  { _id: false },
)

const entrySchema = new Schema<EntryDoc>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: {
      type: String,
      required: true,
      validate: { validator: isValidDateString, message: '{VALUE} is not a valid YYYY-MM-DD date' },
    },
    morningAnswer: { type: String, default: '' },
    eveningAnswer: { type: String, default: '' },
    morningAnswerAt: { type: Date },
    eveningAnswerAt: { type: Date },
    blockStatuses: { type: [blockStatusSchema], default: [] },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
)

entrySchema.index({ user: 1, date: 1 }, { unique: true })

export const EntryModel: Model<EntryDoc>
  = (mongoose.models.Entry as Model<EntryDoc> | undefined) ?? mongoose.model<EntryDoc>('Entry', entrySchema)
