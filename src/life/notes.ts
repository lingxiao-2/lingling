/** 便签的纯函数：颜色、清单、搜索、排序、文字与清单互转。 */
import type { Note, NoteColor, NoteItem } from '../db/schema'

export const NOTE_LIMITS = { title: 40, text: 5000, items: 50, item: 120 }

export const NOTE_COLORS: { id: NoteColor; label: string; bg: string; ink: string }[] = [
  { id: 'pearl', label: '珍珠白', bg: 'linear-gradient(170deg, rgba(255,255,255,0.88), rgba(246,249,253,0.76))', ink: '#3f5674' },
  { id: 'ice', label: '冰蓝', bg: 'linear-gradient(170deg, rgba(232,242,252,0.9), rgba(214,230,247,0.78))', ink: '#34506f' },
  { id: 'mist', label: '雾蓝', bg: 'linear-gradient(170deg, rgba(225,232,243,0.9), rgba(205,216,232,0.8))', ink: '#33475f' },
  { id: 'lilac', label: '淡紫', bg: 'linear-gradient(170deg, rgba(240,235,250,0.9), rgba(224,216,243,0.8))', ink: '#463f66' },
  { id: 'blush', label: '樱粉', bg: 'linear-gradient(170deg, rgba(252,240,244,0.92), rgba(244,222,230,0.8))', ink: '#5e4050' },
  { id: 'mint', label: '薄荷', bg: 'linear-gradient(170deg, rgba(236,248,244,0.92), rgba(214,236,228,0.8))', ink: '#36564c' },
]
export const colorOf = (c: NoteColor | undefined) => NOTE_COLORS.find((x) => x.id === c) ?? NOTE_COLORS[0]

export function isBlankNote(n: Pick<Note, 'title' | 'text' | 'items' | 'kind'>): boolean {
  return !n.title.trim() && (n.kind === 'text' ? !n.text.trim() : !n.items.some((i) => i.text.trim()))
}

/** 文字 → 清单：每行一项；清单 → 文字：每项一行 */
export function toChecklist(text: string, newId: () => string): NoteItem[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)、]|[☐☑✓✔]|\[[ xX]\])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, NOTE_LIMITS.items)
    .map((t) => ({ id: newId(), text: t.slice(0, NOTE_LIMITS.item), done: false }))
}
export function toText(items: NoteItem[]): string {
  return items.map((i) => i.text).filter((t) => t.trim()).join('\n')
}

export function progress(items: NoteItem[]): { done: number; total: number } {
  const real = items.filter((i) => i.text.trim())
  return { done: real.filter((i) => i.done).length, total: real.length }
}

/** 可见的便签：置顶的在前，其余按更新时间从新到旧；支持搜索标题、正文、清单项 */
export function visibleNotes(list: Note[], q = ''): Note[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  return list
    .filter((n) => !n.deletedAt)
    .filter((n) => {
      if (!words.length) return true
      const hay = `${n.title}\n${n.text}\n${n.items.map((i) => i.text).join('\n')}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

/** 便签的预览文字（桌面小组件与列表） */
export function previewLines(n: Note, max = 4): { text: string; done?: boolean }[] {
  if (n.kind === 'checklist') return n.items.filter((i) => i.text.trim()).slice(0, max).map((i) => ({ text: i.text, done: i.done }))
  return n.text.split('\n').filter((l) => l.trim()).slice(0, max).map((text) => ({ text }))
}
