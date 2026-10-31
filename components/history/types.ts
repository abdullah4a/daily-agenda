export interface HistoryBlock {
  blockId: string
  label: string
  start: string
  end: string
  productive: boolean
}

export interface HistoryItem {
  date: string
  morningAnswer: string
  eveningAnswer: string
  completedBlocks: HistoryBlock[]
}

export interface HistoryPage {
  items: HistoryItem[]
  nextCursor: string | null
}
