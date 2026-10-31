import { createError, type H3Event } from 'h3'
import { UserModel } from '../models/User'
import { connectDb } from './db'

/**
 * Returns the signed-in user's id, or throws 401. The cookie is sealed but cannot be
 * revoked, so each call reads sessionVersion to reject sessions older than a password
 * reset. Sessions and accounts from before the field existed both count as version 0.
 */
export async function requireUser(event: H3Event): Promise<string> {
  const { user } = await requireUserSession(event)
  await connectDb()
  const current = await UserModel.findById(user.id).select('sessionVersion -_id').lean()
  if (!current || (current.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return user.id
}
