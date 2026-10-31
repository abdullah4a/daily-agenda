import { defineStore } from 'pinia'
import { apiErrorMessage } from './auth'
import { useSyncStore } from './sync'
import type { DayBlock, DayEntry } from '~/composables/todayTime'

export type CheckStatus = 'done' | 'skipped'
interface BlockStatusRow { blockId: string, status: CheckStatus }
interface TodayResponse { entry: TodayEntry, blockStatuses?: BlockStatusRow[] }
interface TodayRead { body: TodayResponse, cached: boolean }

export type AnswerField = 'morningAnswer' | 'eveningAnswer'
export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'offline' | 'error' | 'auth'

export type TodayEntry = DayEntry
export type ParkedAnswer = Extract<SyncOp, { kind: 'answer' }>

const FIELDS: AnswerField[] = ['morningAnswer', 'eveningAnswer']
const DEBOUNCE_MS = 800
const REVALIDATE_RETRY_MS = 15000
const ROLLOVER_READ_TIMEOUT_MS = 3000
const DAY_NOTICE_MS = 6000

export const useTodayStore = defineStore('today', () => {
  const sync = useSyncStore()
  const date = ref('')
  const drafts = reactive<Record<AnswerField, string>>({ morningAnswer: '', eveningAnswer: '' })
  const editedAt = reactive<Record<AnswerField, string | null>>({ morningAnswer: null, eveningAnswer: null })
  const blocks = ref<DayBlock[]>([])
  const checks = ref<Record<string, CheckStatus>>({})

  const entryStatus = ref<'loading' | 'ready' | 'error'>('loading')
  const entryError = ref('')
  const scheduleStatus = ref<'loading' | 'ready' | 'error'>('loading')
  const scheduleError = ref('')

  /** True while something on screen came from the service worker's cache and is not yet confirmed. */
  const entryCached = ref(false)
  const scheduleCached = ref(false)
  const offlineCopy = computed(() => entryCached.value || scheduleCached.value)
  /** The answer being typed in: a read never swaps the text under the cursor. */
  const editing = ref<AnswerField | null>(null)
  /** The date that field had when focused. Until blur its keystrokes save there, whatever the page shows. */
  let boundDate = ''
  let boundUnconfirmed = false
  let readHeldBack = false
  const dayNotice = ref(false)
  /** The entry behind the page, for a field that joins the new day on blur. */
  let dayEntry: TodayEntry | null = null
  /** No live read has shown this day yet, so a blank answer may only look blank. */
  let dayUnconfirmed = false
  /** The server has text this field's local text never saw: its writes keep merging until reconciled. */
  const mergePending: Record<AnswerField, boolean> = { morningAnswer: false, eveningAnswer: false }
  /** The last live read was behind this device's clock, so the server's day is the one on screen. */
  let serverBehind = false
  /** Today is on screen. Off it, nothing polls. */
  let active = false

  /** The queue is the source of truth for what has not reached the server. */
  const dirty = computed(() => {
    const flags: Record<AnswerField, boolean> = { morningAnswer: false, eveningAnswer: false }
    for (const op of sync.ops) if (op.kind === 'answer' && op.date === date.value) flags[op.field] = true
    return flags
  })
  /** Too long to send, on a day no field here can reach: only the Today notice can resolve these. */
  const strandedOps = computed(() => (date.value
    ? sync.ops.filter((op): op is SyncOp & ParkedAnswer => op.kind === 'answer' && !!op.parked && op.date !== date.value)
    : []))
  /** What is still on its way. Stranded answers are not: the notice speaks for them. */
  const unsaved = computed(() => sync.pending - strandedOps.value.length)
  const saveState = computed<SaveState>(() => {
    if (!unsaved.value) return sync.lastSyncedAt ? 'saved' : 'idle'
    if (sync.status === 'auth') return 'auth'
    if (!sync.online) return 'offline'
    if (sync.status === 'retrying') return 'error'
    return sync.status === 'syncing' ? 'saving' : 'pending'
  })
  const saveError = computed(() => (sync.status === 'retrying' ? 'Could not reach the server. Your changes are kept here and will retry.' : ''))

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let revalidateTimer: ReturnType<typeof setTimeout> | null = null
  let noticeTimer: ReturnType<typeof setTimeout> | null = null
  /** Bumped by each load, rollover and reset, so a slower older read cannot land on top of them. */
  let readSeq = 0

  function clearTimers() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = null
  }

  function clearRevalidate() {
    if (revalidateTimer) clearTimeout(revalidateTimer)
    revalidateTimer = null
  }

  function clearNotice() {
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = null
    dayNotice.value = false
  }

  function fadeNotice() {
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(clearNotice, DAY_NOTICE_MS)
  }

  /** Queued edits for this date always win over what a read returned: they are newer or still unsent. */
  function overlayQueued() {
    for (const op of sync.ops) {
      if (op.kind !== 'answer' || op.date !== date.value) continue
      if (op.field === editing.value && boundDate !== date.value) continue
      drafts[op.field] = op.value
      editedAt[op.field] = op.clientUpdatedAt
    }
  }

  function applyEntry(entry: TodayEntry, force = false) {
    date.value = entry.date
    for (const f of FIELDS) {
      if (f === editing.value) {
        readHeldBack = true
        // A new day: what stays on screen until blur no longer belongs to this date's history.
        if (force) editedAt[f] = null
        continue
      }
      const serverAt = entry[`${f}At`]
      const local = editedAt[f]
      // A cached read can be older than what this tab already synced.
      const stale = !force && local && (!serverAt || serverAt < local)
      if (!stale) {
        drafts[f] = entry[f]
        editedAt[f] = serverAt
      }
    }
    overlayQueued()
  }

  function applyChecks(rows: BlockStatusRow[] | undefined) {
    const next: Record<string, CheckStatus> = {}
    for (const r of rows ?? []) next[r.blockId] = r.status
    for (const op of sync.ops) {
      if (op.kind !== 'check' || op.date !== date.value) continue
      if (op.status) next[op.blockId] = op.status
      else Reflect.deleteProperty(next, op.blockId)
    }
    checks.value = next
  }

  /** A live read has shown the day: what was typed against nothing can now be settled, field by field. */
  function settleUnconfirmed(entry: TodayEntry, wasUnconfirmed: boolean) {
    if (boundDate === entry.date) boundUnconfirmed = false
    let released = false
    for (const f of FIELDS) {
      const op = sync.ops.find(o => o.kind === 'answer' && o.date === entry.date && o.field === f && o.unconfirmed)
      if (!op) {
        // Held back under the cursor: the first keystroke must not replace text this field never showed.
        const unseen = f === editing.value && boundDate === entry.date && !!entry[f].trim() && drafts[f] !== entry[f]
        mergePending[f] = unseen && (mergePending[f] || wasUnconfirmed)
      }
      else if (!entry[f].trim() || (op.kind === 'answer' && entry[f] === op.value)) {
        mergePending[f] = false
        sync.enqueue({ ...op, unconfirmed: false, hold: false } as SyncChange)
        released = true
      }
      else mergePending[f] = true
    }
    if (released) void sync.trigger()
  }

  function applyDay(entry: TodayEntry, rows: BlockStatusRow[] | undefined, live: boolean, stale = false) {
    const moved = entry.date !== date.value
    const wasUnconfirmed = dayUnconfirmed
    if (moved) {
      if (date.value && entry.date > date.value) {
        dayNotice.value = true
        if (!editing.value) fadeNotice()
      }
      if (editing.value) boundUnconfirmed ||= dayUnconfirmed
      mergePending.morningAnswer = mergePending.eveningAnswer = false
    }
    dayEntry = entry
    dayUnconfirmed = !live
    applyEntry(entry, moved)
    if (moved || !stale) applyChecks(rows)
    if (live) settleUnconfirmed(entry, wasUnconfirmed && !moved)
  }

  function currentDate() {
    return zonedClock(useAuthStore().user?.timezone).date
  }

  /** In a held queue, a 401 stays with the sync status and its Sign in button. */
  function readHeaders(fresh: boolean) {
    return {
      ...(fresh ? { [FRESH_HEADER]: '1' } : {}),
      ...(sync.status === 'auth' ? { [BACKGROUND_HEADER]: '1' } : {}),
    }
  }

  async function readToday(fresh = false, timeout?: number): Promise<TodayRead> {
    const res = await $fetch.raw<TodayResponse>('/api/entries/today' as string, { headers: readHeaders(fresh), timeout })
    return { body: res._data!, cached: res.headers.has(CACHE_HEADER) }
  }

  /**
   * Applies a read. A live read is the authority on the date, even behind this device's clock: that
   * day stays on screen and is polled until the server moves on. Only a cached copy can be out of
   * date, so only that old day becomes a blank today, and edits land on the date really meant.
   */
  function applyToday({ body, cached }: TodayRead) {
    const today = currentDate()
    if (!cached) {
      serverBehind = body.entry.date < today
      applyDay(body.entry, body.blockStatuses, true)
      entryCached.value = false
      if (serverBehind) scheduleRevalidate()
      return
    }
    // A flaky connection must not trade what the network already gave us for an older copy.
    if (!entryCached.value && entryStatus.value === 'ready' && (serverBehind || date.value === today)) return scheduleRevalidate()
    const { entry, blockStatuses, stale } = resolveDay(body, today)
    applyDay(entry, blockStatuses as BlockStatusRow[], false, stale)
    entryCached.value = true
    scheduleRevalidate()
  }

  function scheduleRevalidate() {
    clearRevalidate()
    if (active) revalidateTimer = setTimeout(() => void revalidate(), REVALIDATE_RETRY_MS)
  }

  /**
   * After a cached answer, asks the network directly and retries until it responds. The worker's
   * own request may still be pending, and it has no way of telling the page when it lands.
   */
  async function revalidate() {
    revalidateTimer = null
    const seq = readSeq
    const startedAt = sync.epoch
    const needSchedule = scheduleCached.value
    const [entry, schedule] = await Promise.allSettled([
      readToday(true),
      needSchedule ? $fetch<{ blocks: DayBlock[] }>('/api/schedule', { headers: readHeaders(true) }) : Promise.resolve(null),
    ])
    if (seq !== readSeq) return
    if (schedule.status === 'fulfilled' && schedule.value) {
      blocks.value = schedule.value.blocks
      scheduleCached.value = false
    }
    if (entry.status === 'fulfilled' && startedAt !== sync.epoch) return scheduleRevalidate() // A flush overtook it.
    if (entry.status === 'fulfilled') {
      if (entryCached.value) void useAuthStore().fetchMe({ fresh: true })
      applyToday(entry.value)
    }
    const failure = [entry, schedule].find(r => r.status === 'rejected')
    if (failure?.status === 'rejected' && classifyFailure(failure.reason) !== 'auth') scheduleRevalidate()
  }

  function enqueue(change: SyncChange) {
    if (!sync.enqueue(change)) useToast().error('Could not store this change on your device. Keep this page open until it syncs.')
  }

  /** Marks a block done/skipped, or clears it (null). Applied at once and queued for the server. */
  function setCheck(blockId: string, status: CheckStatus | null) {
    if (!date.value) return
    if ((checks.value[blockId] ?? null) === status) return
    const known = blocks.value.find(b => b.id === blockId)
    const block = status && known ? { label: known.label, start: known.start, end: known.end, productive: known.productive } : undefined
    const next = { ...checks.value }
    if (status) next[blockId] = status
    else Reflect.deleteProperty(next, blockId)
    checks.value = next
    enqueue({ kind: 'check', date: date.value, blockId, status, ...(block ? { block } : {}) })
    void sync.trigger()
  }

  async function loadEntry() {
    const seq = ++readSeq
    active = true
    entryStatus.value = 'loading'
    entryError.value = ''
    try {
      const read = await readToday()
      if (seq !== readSeq) return
      applyToday(read)
      entryStatus.value = 'ready'
    }
    catch (e) {
      if (seq !== readSeq) return
      entryError.value = apiErrorMessage(e, 'We could not load today. Check your connection and try again.')
      entryStatus.value = 'error'
    }
  }

  async function loadSchedule() {
    scheduleStatus.value = 'loading'
    scheduleError.value = ''
    try {
      const res = await $fetch.raw<{ blocks: DayBlock[] }>('/api/schedule' as string, { headers: readHeaders(false) })
      blocks.value = res._data!.blocks
      scheduleCached.value = res.headers.has(CACHE_HEADER)
      if (scheduleCached.value) scheduleRevalidate()
      scheduleStatus.value = 'ready'
    }
    catch (e) {
      scheduleError.value = apiErrorMessage(e, 'We could not load your schedule.')
      scheduleStatus.value = 'error'
    }
  }

  function load() {
    return Promise.all([loadEntry(), loadSchedule()])
  }

  /** Silent re-sync (tab came back, queue flushed). Queued edits and the text being typed are kept. */
  async function refresh() {
    if (!active || entryStatus.value === 'loading') return
    const seq = readSeq
    const startedAt = sync.epoch
    try {
      const read = await readToday()
      if (seq !== readSeq || startedAt !== sync.epoch) return // A newer flush reconciles again.
      applyToday(read)
    }
    catch { /* silent: the next explicit action surfaces errors */ }
  }

  /**
   * This device's midnight passed. The server decides first, as its clock may disagree: nothing is
   * blanked if it still says yesterday. With no answer the page moves on by itself, without a
   * loading state. A field in use keeps its focus, text and date until blur.
   */
  async function rollover() {
    const seq = ++readSeq
    const day = currentDate()
    void flush()
    try {
      const read = await readToday(true, ROLLOVER_READ_TIMEOUT_MS)
      if (seq !== readSeq) return
      applyToday(read)
    }
    catch {
      if (seq !== readSeq) return
      if (day > date.value) {
        serverBehind = false
        applyDay(blankEntry(day), [], false)
      }
      entryCached.value = true
      scheduleRevalidate()
    }
    entryStatus.value = 'ready'
    entryError.value = ''
  }

  function startEditing(field: AnswerField) {
    editing.value = field
    boundDate = date.value
    boundUnconfirmed = false
  }

  function stopEditing() {
    const field = editing.value
    const movedOn = field !== null && boundDate !== date.value
    editing.value = null
    boundDate = ''
    boundUnconfirmed = false
    sync.releaseHeld()
    if (movedOn && dayEntry) {
      drafts[field] = dayEntry[field]
      editedAt[field] = dayEntry[`${field}At`]
      overlayQueued()
      readHeldBack = true
    }
    if (dayNotice.value) fadeNotice()
    void flush().then(() => {
      if (!readHeldBack) return
      readHeldBack = false
      return refresh()
    })
  }

  function setDraft(field: AnswerField, value: string) {
    if (drafts[field] === value || !date.value) return
    const at = new Date().toISOString()
    const typing = field === editing.value
    const target = typing ? boundDate : date.value
    const unconfirmed = target === date.value
      ? (dayUnconfirmed && !dayEntry?.[field]) || mergePending[field]
      : boundUnconfirmed
    // The server would refuse this for good and the queue would drop it, so it waits here until it fits.
    const parked = value.length > MAX_ANSWER_LENGTH
    drafts[field] = value
    editedAt[field] = at
    // Durable before the handler returns, stamped with the real edit time and the day it was made on.
    enqueue({ kind: 'answer', date: target, field, value, clientUpdatedAt: at, ...(unconfirmed ? { unconfirmed, hold: typing } : {}), ...(parked ? { parked } : {}) })
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => void flush(), DEBOUNCE_MS)
  }

  /** Sends everything queued now. Safe to call repeatedly; the queue serializes writes. */
  async function flush(): Promise<void> {
    clearTimers()
    await sync.trigger()
  }

  /** The page is leaving. Queued text stays queued. */
  function dispose() {
    clearTimers()
    clearRevalidate()
    clearNotice()
    readSeq++
    active = false
    editing.value = null
    boundDate = ''
    boundUnconfirmed = false
    readHeldBack = false
    sync.releaseHeld()
  }

  function reset() {
    dispose()
    dayEntry = null
    dayUnconfirmed = serverBehind = false
    mergePending.morningAnswer = mergePending.eveningAnswer = false
    entryCached.value = scheduleCached.value = false
    date.value = ''
    for (const f of FIELDS) {
      drafts[f] = ''
      editedAt[f] = null
    }
    blocks.value = []
    checks.value = {}
    entryStatus.value = scheduleStatus.value = 'loading'
  }

  return {
    date, drafts, dirty, blocks, checks, setCheck, entryStatus, entryError, scheduleStatus, scheduleError,
    saveState, saveError, offlineCopy, dayNotice, strandedOps, unsaved,
    load, loadEntry, loadSchedule, refresh, rollover, setDraft, flush, reset, dispose, startEditing, stopEditing,
  }
})
