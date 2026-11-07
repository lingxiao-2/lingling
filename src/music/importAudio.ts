/**
 * 从「文件」导入音频（只在浏览器中运行）：检查格式与大小 → 读取标签与封面 → 读取时长 → 保存到本机。
 * 只导入你自己选择的文件；不下载、不联网。
 */
import { addTrack, AUDIO_EXT, MUSIC_LIMITS } from '../db/musicRepo'
import { readId3, titleFromFile } from './id3'

export interface MusicImportResult {
  ok: number
  failed: { name: string; reason: string }[]
  /** 存储空间提醒 */
  warning?: string
}

const MIME_BY_EXT: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', caf: 'audio/x-caf', aif: 'audio/aiff', aiff: 'audio/aiff' }

export function mimeOf(f: { name: string; type: string }): string {
  if (f.type.startsWith('audio/')) return f.type
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? ''
}

async function coverToDataUrl(data: Uint8Array, mime: string): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(new Blob([data], { type: mime }))
    const k = Math.min(1, 300 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k)
    c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.82)
  } catch {
    return undefined
  }
}

function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio()
    const url = URL.createObjectURL(blob)
    const done = (d: number) => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(d) ? d : 0)
    }
    const t = setTimeout(() => done(0), 8000)
    a.preload = 'metadata'
    a.onloadedmetadata = () => {
      clearTimeout(t)
      done(a.duration)
    }
    a.onerror = () => {
      clearTimeout(t)
      done(-1)
    }
    a.src = url
  })
}

export async function importAudioFiles(files: File[], onProgress?: (i: number, n: number) => void): Promise<MusicImportResult> {
  const r: MusicImportResult = { ok: 0, failed: [] }
  const list = files.slice(0, MUSIC_LIMITS.batch)
  if (files.length > list.length) r.failed.push({ name: `另外 ${files.length - list.length} 个`, reason: `一次最多导入 ${MUSIC_LIMITS.batch} 首` })
  const probe = new Audio()
  for (const [i, f] of list.entries()) {
    onProgress?.(i, list.length)
    const mime = mimeOf(f)
    if (!mime && !AUDIO_EXT.test(f.name)) {
      r.failed.push({ name: f.name, reason: '不是音频文件' })
      continue
    }
    if (f.size > MUSIC_LIMITS.fileBytes) {
      r.failed.push({ name: f.name, reason: `文件太大（超过 ${MUSIC_LIMITS.fileBytes / 1024 / 1024} MB）` })
      continue
    }
    if (mime && probe.canPlayType(mime) === '') {
      r.failed.push({ name: f.name, reason: '这台设备的浏览器不能播放这种格式' })
      continue
    }
    try {
      const head = new Uint8Array(await f.slice(0, Math.min(f.size, 2 * 1024 * 1024)).arrayBuffer())
      const tags = readId3(head)
      const fromName = titleFromFile(f.name)
      const blob = mime && f.type !== mime ? new Blob([f], { type: mime }) : f
      const duration = await probeDuration(blob)
      if (duration < 0) {
        r.failed.push({ name: f.name, reason: '文件损坏或无法解码' })
        continue
      }
      await addTrack(
        { title: tags.title || fromName.title, artist: tags.artist || fromName.artist || '', album: tags.album || '', duration, mime: mime || 'audio/mpeg', bytes: f.size, fileName: f.name, cover: tags.cover ? await coverToDataUrl(tags.cover.data, tags.cover.mime) : undefined },
        blob,
      )
      r.ok++
    } catch (e) {
      const quota = (e as Error)?.name === 'QuotaExceededError'
      r.failed.push({ name: f.name, reason: quota ? '本机存储空间不足' : `保存失败：${(e as Error)?.message ?? e}` })
      if (quota) break
    }
  }
  try {
    const est = await navigator.storage?.estimate?.()
    if (est?.quota && est.usage && est.usage / est.quota > 0.8) r.warning = `聆聆已使用约 ${Math.round((est.usage / est.quota) * 100)}% 的可用存储空间，建议导出备份或删除不需要的歌曲`
  } catch {
    /* 不支持 */
  }
  return r
}
