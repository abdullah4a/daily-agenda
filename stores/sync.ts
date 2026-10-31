import { defineStore } from 'pinia'
import { apiErrorMessage } from './auth'

export type SyncStatus = 'idle' | 'syncing' | 'retrying' | 'auth'
type AnswerOp = Extract<SyncOp, { kind: 'answer' }>

const LOCK_BUSY_RECHECK_MS = 5000
/** A 401 here must hold the queue and offer Sign in, not pull the user off the page. */
const BACKGROUND = { [BACKGROUND_HEADER]: '1' }

/** Runs the offline queue for the signed-in user. Only ever does work in the browser. */
export const useSyncStore = defineStore('sync', () => {
  const userId = ref<string | null>(null)
  const ops = shallowRef<SyncOp[]>([])
  const status = ref<SyncStatus>('idle')
  const online = ref(true)
  const lastSyncedAt = ref<number | null>(null)
  /** Bumps whenever items leave the queue, so a read that began earlier can be discarded. */
  const epoch = ref(0)
  const pending = computed(() => ops.value.length)
  /** Answers the server refused for good, by queue key, so a field never claims to be saved. */
  const rejected = ref<Record<string, string>>({})

  let queue: SyncQueue | null = null
  let generation = 0
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let rerun = false
  const reconcilers: (() => unknown)[] = []

  function refreshOps() {
    ops.value = queue?.list() ?? []
  }

  function clearTimer() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function schedule(delay: number) {
    clearTimer()
    timer = setTimeout(() => void trigger(), delay)
  }

  function onReconcile(fn: () => unknown) {
    reconcilers.push(fn)
  }

  function reconcile() {
    epoch.value++
    for (const fn of reconcilers) void fn()
  }

  /** Attaches the queue of this account. Items of any other account stay untouched in storage. */
  function start(id: string) {
    if (userId.value !== id) {
      generation++
      attempt = 0
      userId.value = id
      queue = createSyncQueue(localStorage, id)
      releaseHeld() // Holds belong to a field in use, and that page is gone.
    }
    localStorage.setItem(ACTIVE_USER_KEY, id)
    status.value = 'idle'
    online.value = navigator.onLine
    refreshOps()
    return trigger()
  }

  /** Detaches from the account. Its queued items are kept unless discard() ran first. */
  function stop() {
    generation++
    clearTimer()
    if (userId.value && localStorage.getItem(ACTIVE_USER_KEY) === userId.value) localStorage.removeItem(ACTIVE_USER_KEY)
    userId.value = null
    queue = null
    ops.value = []
    status.value = 'idle'
  }

  /** Forgets an account's queued items. Works after stop(), so it can wait until sign-out succeeded. */
  function discardFor(id: string) {
    createSyncQueue(localStorage, id).clear()
  }

  function enqueue(change: SyncChange): boolean {
    if (!queue) return false
    const stored = queue.put(change)
    refreshOps()
    if (change.kind === 'answer') {
      const key = Object.keys(rejected.value).find(k => k.endsWith(`:a:${change.date}:${change.field}`))
      if (key) rejected.value = Object.fromEntries(Object.entries(rejected.value).filter(([k]) => k !== key))
    }
    return stored
  }

  /** Throws away one queued item at the user's word. False if a newer version took its place, which stays. */
  function discardOp(op: SyncOp): boolean {
    queue?.remove(op)
    refreshOps()
    return !ops.value.some(o => o.key === op.key)
  }

  /** Lets answers held for a field in use go out. */
  function releaseHeld() {
    for (const op of queue?.list() ?? []) {
      if (op.kind === 'answer' && op.hold) queue!.put({ ...op, hold: false })
    }
    refreshOps()
  }

  function putAnswer(op: AnswerOp, value: string, at: string) {
    return $fetch<{ entry: Record<SyncField, string> }>(`/api/entries/${op.date}` as string, {
      method: 'PUT',
      headers: BACKGROUND,
      body: { [op.field]: value, clientUpdatedAt: { [op.field]: at } },
    })
  }

  /** The hold-back: an answer from an unconfirmed day goes out only once the server's text is known. */
  async function sendUnconfirmed(op: AnswerOp) {
    let entry: { morningAnswer: string, eveningAnswer: string, morningAnswerAt: string | null, eveningAnswerAt: string | null }
    try {
      ({ entry } = await $fetch<{ entry: typeof entry }>(`/api/entries/${op.date}` as string, { headers: { ...BACKGROUND, [FRESH_HEADER]: '1' } }))
    }
    catch (error) {
      if (classifyFailure(error) !== 'drop') throw error
      return putAnswer(op, op.value, op.clientUpdatedAt) // It cannot be confirmed: plain last-write-wins.
    }
    const plan = planUnconfirmed(entry[op.field], op.value)
    if (plan.action === 'skip') return
    if (plan.action === 'park') {
      queue?.put({ ...op, value: plan.value, unconfirmed: false, hold: false, parked: true })
      useToast().push(`Your ${op.field === 'morningAnswer' ? 'morning' : 'evening'} answer for ${op.date} also has text from another device, and together they are too long. Shorten it to save it.`, 'error', 0)
      return
    }
    const saved = await putAnswer(op, plan.value, mergeStamp(op.clientUpdatedAt, entry[`${op.field}At`]))
    if (saved.entry[op.field] !== plan.value) throw new Error('Another write landed first') // Retried, and merged again.
  }

  function send(op: SyncOp) {
    if (op.kind === 'answer') return op.unconfirmed ? sendUnconfirmed(op) : putAnswer(op, op.value, op.clientUpdatedAt)
    return $fetch<unknown>(`/api/entries/${op.date}/blocks/${encodeURIComponent(op.blockId)}` as string, {
      method: 'PUT',
      headers: BACKGROUND,
      body: { status: op.status, ...(op.status && op.block ? { block: op.block } : {}) },
    })
  }

  function reportDropped(dropped: DrainResult['dropped']) {
    const toast = useToast()
    for (const { op, error } of dropped) {
      const what = op.kind === 'answer' ? `Your ${op.field === 'morningAnswer' ? 'morning' : 'evening'} answer` : 'A block check-off'
      if (op.kind === 'answer') rejected.value = { ...rejected.value, [op.key]: apiErrorMessage(error, 'The server rejected it') }
      toast.push(`${what} for ${op.date} could not be saved and was removed: ${apiErrorMessage(error, 'the server rejected it')}.`, 'error', 0)
    }
  }

  function retryLater() {
    status.value = 'retrying'
    schedule(backoffMs(attempt++))
  }

  /** One run, holding the lock. The session is re-checked first so a queue never replays under another account. */
  async function drain(owner: string, run: number, activeQueue: SyncQueue) {
    const stillOwner = () => run === generation && localStorage.getItem(ACTIVE_USER_KEY) === owner
    if (!stillOwner()) return void (status.value = 'auth')
    status.value = 'syncing'
    try {
      const me = await $fetch<{ user: { id: string } }>('/api/auth/me', { headers: BACKGROUND })
      if (me.user.id !== owner) return void (status.value = 'auth')
    }
    catch (error) {
      if (run !== generation) return
      if (classifyFailure(error) === 'auth') status.value = 'auth'
      else retryLater()
      return
    }

    const result = await drainQueue({
      queue: activeQueue,
      send,
      canContinue: () => stillOwner() && navigator.onLine,
      onProgress: () => { if (run === generation) refreshOps() },
    })
    if (run !== generation) return
    refreshOps()
    reportDropped(result.dropped)
    if (result.synced) lastSyncedAt.value = Date.now()
    if (result.stop === 'empty') attempt = 0
    if (result.stop === 'retry') retryLater()
    else status.value = result.stop === 'auth' || (result.stop === 'halted' && !stillOwner()) ? 'auth' : 'idle'
    if (result.synced || result.dropped.length) reconcile()
  }

  /** The Web Lock lets one tab drain at a time. Browsers without it may double-send, which is harmless: PUTs are idempotent. */
  async function withLock(owner: string, work: () => Promise<void>) {
    if (!navigator.locks) return work()
    await navigator.locks.request(`da-sync:${owner}`, { ifAvailable: true }, async (lock) => {
      if (lock) await work()
      else schedule(LOCK_BUSY_RECHECK_MS) // Another tab is on it. Check back in case that tab dies.
    })
  }

  /** Flushes now. Safe to call at any time and from any number of events. */
  function trigger(): Promise<void> {
    refreshOps()
    online.value = navigator.onLine
    if (running) {
      rerun = true
      return running
    }
    if (!queue || !ops.value.length) {
      if (status.value === 'retrying') status.value = 'idle'
      return Promise.resolve()
    }
    if (!navigator.onLine) return Promise.resolve() // The online event restarts it.
    clearTimer()
    const owner = userId.value!
    const activeQueue = queue
    const run = generation
    running = (async () => {
      do {
        rerun = false
        await withLock(owner, () => drain(owner, run, activeQueue))
      } while (rerun && run === generation && navigator.onLine && status.value === 'idle' && activeQueue.list().length)
    })().catch(() => retryLater()).finally(() => { running = null })
    return running
  }

  /** Another tab changed the queue or the account. */
  function onStorage(key: string | null) {
    if (key === ACTIVE_USER_KEY) return void trigger()
    if (!isSyncKey(key)) return
    const before = ops.value.length
    refreshOps()
    if (ops.value.length >= before) return
    lastSyncedAt.value = Date.now()
    if (!ops.value.length) {
      if (status.value === 'retrying') status.value = 'idle'
      reconcile()
    }
  }

  function setOnline(value: boolean) {
    online.value = value
    if (!value) return
    attempt = 0
    void trigger()
  }

  return { userId, ops, rejected, status, online, pending, lastSyncedAt, epoch, start, stop, discardFor, discardOp, enqueue, releaseHeld, trigger, onReconcile, onStorage, setOnline }
})
