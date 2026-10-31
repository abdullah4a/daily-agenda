// Durable offline write queue. No Nuxt imports so it is unit-testable.
//
// localStorage rather than IndexedDB because writes are synchronous: a keystroke is durable before
// the handler returns, so a reload or crash right after typing loses nothing, with no async commit
// to race pagehide. The payload is tiny (at most two 5,000 character answers per day plus
// check-offs), and `storage` events give tab-to-tab updates for free. Each item has its own key, so
// tabs never rewrite each other's items through a shared blob.

const PREFIX = 'da-sync:v1:'
/** The account this browser's cookie belongs to. Tabs read it before every send. */
export const ACTIVE_USER_KEY = 'da-sync:active-user'

const BACKOFF_BASE_MS = 2000
const BACKOFF_MAX_MS = 60000

export type StorageLike = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>
export type SyncField = 'morningAnswer' | 'eveningAnswer'
export type SyncCheckStatus = 'done' | 'skipped'

/**
 * unconfirmed: typed on a day no live read has shown, so the server may hold text the writer never
 * saw. The send reads the server first and merges (see planUnconfirmed).
 * hold: not sent yet, as the field is still being typed in.
 * parked: the merge does not fit an answer. Kept here, unsent, until the user shortens it.
 */
export interface AnswerChange {
  kind: 'answer'
  date: string
  field: SyncField
  value: string
  clientUpdatedAt: string
  unconfirmed?: boolean
  hold?: boolean
  parked?: boolean
}
export interface SyncBlockSnapshot { label: string, start: string, end: string, productive: boolean }
/**
 * Check-offs carry no timestamp because the server stores none: the last one to arrive wins.
 * block is the block as it was when checked, so a later schedule edit cannot change or lose it.
 */
export interface CheckChange { kind: 'check', date: string, blockId: string, status: SyncCheckStatus | null, block?: SyncBlockSnapshot }
export type SyncChange = AnswerChange | CheckChange
/** rev identifies this exact version, so a send can never delete a newer edit of the same item. */
export type SyncOp = SyncChange & { key: string, rev: string, order: number }

export interface SyncQueue {
  /** Items oldest first. */
  list(): SyncOp[]
  /** Stores a change, replacing any older one for the same date and field or block. False if storage refused it. */
  put(change: SyncChange): boolean
  /** Removes an item only if it is still the version given. */
  remove(op: SyncOp): void
  clear(): void
}

export function isSendable(op: SyncOp): boolean {
  return op.kind !== 'answer' || !(op.hold || op.parked)
}

export const MAX_ANSWER_LENGTH = 5000
export const MERGE_SEPARATOR = '\n\n---\n'

export type UnconfirmedPlan =
  | { action: 'send', value: string }
  | { action: 'skip' }
  | { action: 'park', value: string }

/** What to do with text written without seeing the server's. Neither side is ever lost. */
export function planUnconfirmed(server: string, local: string, max: number = MAX_ANSWER_LENGTH): UnconfirmedPlan {
  if (!server.trim() || local.includes(server.trim())) return { action: 'send', value: local }
  if (server.includes(local.trim())) return { action: 'skip' } // Includes a local blank, and a repeat of a merge already sent.
  const value = `${server}${MERGE_SEPARATOR}${local}`
  return value.length <= max ? { action: 'send', value } : { action: 'park', value }
}

/** A stamp the server's last-write-wins cannot refuse, whatever this device's clock says. */
export function mergeStamp(clientUpdatedAt: string, serverAt: string | null, now: number = Date.now()): string {
  const after = serverAt ? Date.parse(serverAt) + 1 : 0
  return new Date(Math.max(Date.parse(clientUpdatedAt), after, now)).toISOString()
}

export function isSyncKey(key: string | null): boolean {
  return !!key && key.startsWith(PREFIX)
}

export function createSyncQueue(storage: StorageLike, userId: string): SyncQueue {
  const scope = `${PREFIX}${encodeURIComponent(userId)}:`
  let lastOrder = 0

  const keyOf = (change: SyncChange) => change.kind === 'answer'
    ? `${scope}a:${change.date}:${change.field}`
    : `${scope}c:${change.date}:${encodeURIComponent(change.blockId)}`

  function read(key: string): SyncOp | null {
    try {
      return JSON.parse(storage.getItem(key) ?? 'null') as SyncOp | null
    }
    catch {
      return null // Unreadable items are skipped and left in place, never deleted.
    }
  }

  function keys(): string[] {
    const found: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(scope)) found.push(key)
    }
    return found
  }

  return {
    list() {
      return keys()
        .map(read)
        .filter((op): op is SyncOp => op !== null)
        .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
    },
    put(change) {
      const key = keyOf(change)
      const existing = read(key)
      // Another tab may already hold a newer edit of this answer.
      if (change.kind === 'answer' && existing?.kind === 'answer' && existing.clientUpdatedAt > change.clientUpdatedAt) return true
      lastOrder = Math.max(Date.now(), lastOrder + 1)
      const op = { ...change, key, rev: `${lastOrder}-${Math.random().toString(36).slice(2)}`, order: lastOrder } as SyncOp
      try {
        storage.setItem(key, JSON.stringify(op))
        return true
      }
      catch {
        return false
      }
    },
    remove(op) {
      if (read(op.key)?.rev === op.rev) storage.removeItem(op.key)
    },
    clear() {
      for (const key of keys()) storage.removeItem(key)
    },
  }
}

export type FailureAction = 'retry' | 'auth' | 'drop'

/** Network errors and server trouble retry. 401 holds the queue. Any other 4xx can never succeed. */
export function classifyFailure(error: unknown): FailureAction {
  const e = error as { statusCode?: number, status?: number, response?: { status?: number } } | null
  const status = e?.statusCode ?? e?.status ?? e?.response?.status
  if (!status || status === 408 || status === 425 || status === 429 || status >= 500) return 'retry'
  if (status === 401) return 'auth'
  return status >= 400 ? 'drop' : 'retry'
}

export function backoffMs(attempt: number, random: number = Math.random()): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt)
  return Math.round(ceiling * (0.5 + random / 2))
}

export interface DrainResult {
  stop: 'empty' | 'retry' | 'auth' | 'halted'
  synced: number
  dropped: { op: SyncOp, error: unknown }[]
}

export interface DrainOptions {
  queue: SyncQueue
  send: (op: SyncOp) => Promise<unknown>
  /** Checked before every send, so a switch of account or a lost connection stops the run. */
  canContinue: () => boolean
  onProgress?: () => void
}

/** Sends items oldest first, one at a time, until the queue is empty or something stops it. */
export async function drainQueue({ queue, send, canContinue, onProgress }: DrainOptions): Promise<DrainResult> {
  const result: DrainResult = { stop: 'empty', synced: 0, dropped: [] }
  for (;;) {
    if (!canContinue()) return { ...result, stop: 'halted' }
    const op = queue.list().find(isSendable)
    if (!op) return result
    try {
      await send(op)
      queue.remove(op)
      result.synced++
    }
    catch (error) {
      const action = classifyFailure(error)
      if (action !== 'drop') return { ...result, stop: action }
      queue.remove(op)
      result.dropped.push({ op, error })
    }
    onProgress?.()
  }
}
