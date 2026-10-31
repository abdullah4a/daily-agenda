import { createError, defineEventHandler } from 'h3'
import { requireUser } from '../../utils/requireUser'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const key = process.env.VAPID_PUBLIC_KEY?.trim()
  if (!key) throw createError({ statusCode: 503, statusMessage: 'Push notifications are not configured' })
  return { publicKey: key }
})
