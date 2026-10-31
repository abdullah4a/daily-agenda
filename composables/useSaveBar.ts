/** Tells the bottom dock a save bar is showing, so it moves out of the way. */
export function useSaveBarActive() {
  return useState('save-bar-active', () => false)
}

export function useSaveBar(dirty: Ref<boolean>) {
  const active = useSaveBarActive()
  watch(dirty, (value) => { active.value = value }, { immediate: true })
  onBeforeUnmount(() => { active.value = false })
}
