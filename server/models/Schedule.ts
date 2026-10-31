import mongoose, { Schema, type Model, type Types } from 'mongoose'
import { isValidTime } from '../utils/date'

export interface ScheduleBlock {
  id: string
  label: string
  start: string
  end: string
  productive: boolean
}

export interface ScheduleDoc {
  user: Types.ObjectId
  blocks: ScheduleBlock[]
  createdAt: Date
  updatedAt: Date
}

const timeField = {
  type: String,
  required: true,
  validate: { validator: isValidTime, message: '{VALUE} is not a valid HH:mm time' },
}

// id: false stops Mongoose's virtual `id` from clashing with the stored block id.
const blockSchema = new Schema<ScheduleBlock>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true, trim: true },
    start: timeField,
    end: timeField,
    productive: { type: Boolean, default: false },
  },
  { _id: false, id: false },
)

const scheduleSchema = new Schema<ScheduleDoc>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    blocks: {
      type: [blockSchema],
      default: [],
      validate: {
        // Entry.blockStatuses refers to blocks by id, so ids must not repeat.
        validator: (blocks: ScheduleBlock[]) => new Set(blocks.map(b => b.id)).size === blocks.length,
        message: 'Block ids must be unique within a schedule',
      },
    },
  },
  { timestamps: true },
)

export const ScheduleModel: Model<ScheduleDoc>
  = (mongoose.models.Schedule as Model<ScheduleDoc> | undefined)
    ?? mongoose.model<ScheduleDoc>('Schedule', scheduleSchema)
