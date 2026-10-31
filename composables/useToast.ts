export type ToastKind = 'info' | 'success' | 'error'
export interface ToastItem { id: number, kind: ToastKind, message: string }

export function useToast() {
  const toasts = useState<ToastItem[]>('toasts', () => [])
  const counter = useState<number>('toast-counter', () => 0)

  function dismiss(id: number) {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  function push(message: string, kind: ToastKind = 'info', duration = 5000) {
    const id = ++counter.value
    toasts.value = [...toasts.value, { id, kind, message }]
    if (import.meta.client && duration > 0) setTimeout(() => dismiss(id), duration)
    return id
  }

  return {
    toasts,
    dismiss,
    push,
    success: (m: string) => push(m, 'success'),
    error: (m: string) => push(m, 'error', 7000),
    info: (m: string) => push(m, 'info'),
  }
}
