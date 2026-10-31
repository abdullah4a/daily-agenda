import mongoose from 'mongoose'

interface MongooseCache {
  promise: Promise<typeof mongoose> | null
}

// Kept on globalThis so warm serverless invocations and dev reloads reuse one connection.
const globalStore = globalThis as typeof globalThis & { __mongooseCache?: MongooseCache }
const cache: MongooseCache = (globalStore.__mongooseCache ??= { promise: null })

export interface ConnectDbOptions {
  uri?: string
  /** Overrides the database named in the URI. */
  dbName?: string
}

export async function connectDb(options: ConnectDbOptions = {}): Promise<typeof mongoose> {
  if (cache.promise) return cache.promise

  const uri = options.uri ?? process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')

  cache.promise = mongoose.connect(uri, {
    dbName: options.dbName,
    bufferCommands: false,
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
  })

  try {
    return await cache.promise
  }
  catch (error) {
    // Do not cache a failure: the next invocation must be able to retry.
    cache.promise = null
    throw error
  }
}

export async function disconnectDb(): Promise<void> {
  cache.promise = null
  await mongoose.disconnect()
}
