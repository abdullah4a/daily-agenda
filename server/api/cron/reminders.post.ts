import { defineEventHandler } from 'h3'
import { handleReminderCron } from '../../utils/reminders'

export default defineEventHandler(handleReminderCron)
