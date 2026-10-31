import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enablePush, PUSH_TIMEOUTS, PushSetupError } from '../utils/push'

const never = new Promise<never>(() => {})
const goodKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url')
const subscription = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } }) }

function browser(pushManager: Record<string, unknown>, ready: Promise<unknown> = Promise.resolve({ pushManager })) {
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({}), register: async () => ({}), ready } })
}
const server = (impl: (url: string) => Promise<unknown>) => vi.stubGlobal('$fetch', vi.fn(impl))

/** Runs enablePush past every timeout and returns which failure it ended with. */
async function failure() {
  const result = enablePush().then(() => null, (e: unknown) => e)
  await vi.advanceTimersByTimeAsync(Math.max(...Object.values(PUSH_TIMEOUTS)) * 2)
  const error = await result
  expect(error).toBeInstanceOf(PushSetupError)
  return (error as PushSetupError).failure
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('enablePush', () => {
  const idle = { getSubscription: async () => null, subscribe: async () => subscription }

  it('stops waiting when no service worker ever becomes ready', async () => {
    browser(idle, never)
    server(async () => ({ publicKey: goodKey }))
    expect(await failure()).toBe('no-service-worker')
  })

  it('reports a missing public key', async () => {
    browser(idle)
    server(async () => { throw Object.assign(new Error('x'), { statusCode: 503 }) })
    expect(await failure()).toBe('public-key-missing')
  })

  it('reports a malformed public key', async () => {
    browser(idle)
    server(async () => ({ publicKey: 'not-a-key' }))
    expect(await failure()).toBe('public-key-missing')
  })

  it('stops waiting when the push service never answers', async () => {
    browser({ getSubscription: async () => null, subscribe: () => never })
    server(async () => ({ publicKey: goodKey }))
    expect(await failure()).toBe('push-service-unavailable')
  })

  it('reports a push service error', async () => {
    browser({ getSubscription: async () => null, subscribe: async () => { throw new Error('AbortError') } })
    server(async () => ({ publicKey: goodKey }))
    expect(await failure()).toBe('push-service-unavailable')
  })

  it('reports the server refusing the subscription', async () => {
    browser(idle)
    server(async (url) => {
      if (url.endsWith('public-key')) return { publicKey: goodKey }
      throw Object.assign(new Error('x'), { statusCode: 400 })
    })
    expect(await failure()).toBe('server-rejected')
  })

  it('succeeds when every step answers', async () => {
    browser(idle)
    server(async () => ({ publicKey: goodKey }))
    await expect(enablePush()).resolves.toBeUndefined()
  })
})
