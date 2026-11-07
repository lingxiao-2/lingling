/**
 * 全局音乐播放器（整个聆聆只有一个 <audio>）：离开音乐页面后继续播放，桌面音乐小组件读取同一个状态。
 *  - 播放队列、当前位置、音量、循环 / 随机保存在设置里，刷新后恢复（不会自动开始播放）
 *  - 锁屏 / 控制中心的播放控制（Media Session，浏览器支持时）
 *  - 睡眠定时：到时间暂停，或播完当前这首后停止
 *  - iPhone 上网页不能调节系统音量（只能用侧边音量键），检测到时如实显示
 */
import { useSyncExternalStore } from 'react'
import { db } from '../db/db'
import type { Track } from '../db/schema'
import { getTrackBlob } from '../db/musicRepo'
import { nextIndex, prevIndex, shuffledOrder, type Repeat } from './queue'

export interface PlayerState {
  queue: string[]
  index: number
  order: number[]
  track?: Track
  playing: boolean
  loading: boolean
  position: number
  duration: number
  volume: number
  /** 网页无法调节音量（iPhone） */
  volumeLocked: boolean
  repeat: Repeat
  shuffle: boolean
  /** 睡眠定时：到某个时间暂停，或播完当前这首 */
  sleep: { at: number } | { endOfTrack: true } | null
  error?: string
}

const STATE_KEY = 'music-state'
let state: PlayerState = { queue: [], index: -1, order: [], playing: false, loading: false, position: 0, duration: 0, volume: 1, volumeLocked: false, repeat: 'off', shuffle: false, sleep: null }
const listeners = new Set<() => void>()
let audio: HTMLAudioElement | null = null
let objectUrl = ''
let sleepTimer: ReturnType<typeof setTimeout> | undefined
let lastSaved = 0
let restored = false

function set(patch: Partial<PlayerState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}
export const getPlayer = () => state

export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      void restore()
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

async function save(force = false) {
  if (!force && Date.now() - lastSaved < 4000) return
  lastSaved = Date.now()
  const { queue, index, position, volume, repeat, shuffle } = state
  await db.settings.put({ key: STATE_KEY, value: { queue, index, position: Math.floor(position), volume, repeat, shuffle } }).catch(() => {})
}

/** 刷新后恢复上次的队列与位置（暂停状态，不自动播放） */
export async function restore(): Promise<void> {
  if (restored) return
  restored = true
  const v = (await db.settings.get(STATE_KEY))?.value as Partial<PlayerState> | undefined
  if (!v || !Array.isArray(v.queue) || !v.queue.length) return
  const tracks = await db.tracks.bulkGet(v.queue)
  const queue = v.queue.filter((_, i) => tracks[i])
  if (!queue.length) return
  const index = Math.min(Math.max(0, Number(v.index) || 0), queue.length - 1)
  const track = (await db.tracks.get(queue[index])) ?? undefined
  set({ queue, index, order: v.shuffle ? shuffledOrder(queue.length, index) : [], track, position: Number(v.position) || 0, duration: track?.duration ?? 0, volume: typeof v.volume === 'number' ? v.volume : 1, repeat: v.repeat === 'all' || v.repeat === 'one' ? v.repeat : 'off', shuffle: !!v.shuffle })
}

function el(): HTMLAudioElement {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'metadata'
  audio.setAttribute('playsinline', '')
  audio.addEventListener('timeupdate', () => {
    set({ position: audio!.currentTime })
    void save()
  })
  audio.addEventListener('loadedmetadata', () => {
    const d = audio!.duration
    if (Number.isFinite(d)) {
      set({ duration: d })
      if (state.track && !state.track.duration) void db.tracks.update(state.track.id, { duration: d })
    }
  })
  audio.addEventListener('play', () => set({ playing: true, error: undefined }))
  audio.addEventListener('pause', () => {
    set({ playing: false })
    void save(true)
  })
  audio.addEventListener('ended', () => {
    if (state.sleep && 'endOfTrack' in state.sleep) {
      set({ sleep: null, playing: false })
      return
    }
    const n = nextIndex(state, 'auto')
    if (n < 0) set({ playing: false, position: 0 })
    else void load(n, true)
  })
  audio.addEventListener('error', () => {
    if (!state.track) return
    set({ playing: false, loading: false, error: `「${state.track.title}」无法播放：这台设备的浏览器可能不支持这个格式` })
  })
  setupMediaSession()
  return audio
}

function setupMediaSession() {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
  if (!ms) return
  const h = (a: MediaSessionAction, f: MediaSessionActionHandler) => {
    try {
      ms.setActionHandler(a, f)
    } catch {
      /* 不支持的操作 */
    }
  }
  h('play', () => void play())
  h('pause', () => pause())
  h('previoustrack', () => void prev())
  h('nexttrack', () => void next())
  h('seekto', (d) => d.seekTime !== undefined && seek(d.seekTime))
}

function updateMediaSession(t: Track) {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
  if (!ms || typeof MediaMetadata === 'undefined') return
  ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: t.cover ? [{ src: t.cover, sizes: '300x300' }] : [] })
}

async function load(index: number, autoplay: boolean, startAt = 0): Promise<void> {
  const id = state.queue[index]
  const track = id ? await db.tracks.get(id) : undefined
  if (!track) {
    // 曲目已被删除：从队列中去掉
    const queue = state.queue.filter((_, i) => i !== index)
    set({ queue, order: state.shuffle ? shuffledOrder(queue.length, Math.min(index, queue.length - 1)) : [] })
    if (queue.length) return load(Math.min(index, queue.length - 1), autoplay)
    return stop()
  }
  const blob = await getTrackBlob(id)
  if (!blob) return set({ error: `「${track.title}」的音频文件丢失了` })
  const a = el()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(blob)
  set({ index, track, position: startAt, duration: track.duration, loading: true, error: undefined })
  a.src = objectUrl
  if (startAt) a.currentTime = startAt
  updateMediaSession(track)
  void save(true)
  if (autoplay) {
    try {
      await a.play()
    } catch (e) {
      set({ playing: false, error: (e as Error)?.name === 'NotAllowedError' ? '浏览器需要你点一下播放才能开始' : `无法播放：${(e as Error)?.message ?? e}` })
    }
  }
  set({ loading: false })
}

/** 播放一组曲目，从第 start 首开始（必须由点按触发，iOS 才允许出声） */
export async function playQueue(ids: string[], start = 0): Promise<void> {
  if (!ids.length) return
  const s = Math.min(Math.max(0, start), ids.length - 1)
  set({ queue: [...ids], order: state.shuffle ? shuffledOrder(ids.length, s) : [] })
  await load(s, true)
}

export async function play(): Promise<void> {
  const a = el()
  if (!state.track) {
    if (state.queue.length) return load(Math.max(0, state.index), true)
    return
  }
  if (!a.src) return load(state.index, true, state.position)
  try {
    await a.play()
  } catch (e) {
    set({ error: `无法播放：${(e as Error)?.message ?? e}` })
  }
}

export function pause() {
  audio?.pause()
}

export function toggle() {
  if (state.playing) pause()
  else void play()
}

export async function next() {
  const n = nextIndex(state, 'manual')
  if (n >= 0) await load(n, state.playing || true)
}

/** 播放超过 3 秒时「上一首」回到开头 */
export async function prev() {
  if (audio && audio.currentTime > 3) return seek(0)
  const p = prevIndex(state)
  if (p >= 0) await load(p, true)
}

export function seek(sec: number) {
  const a = el()
  const t = Math.max(0, Math.min(sec, Number.isFinite(a.duration) ? a.duration : sec))
  a.currentTime = t
  set({ position: t })
}

export function setVolume(v: number) {
  const a = el()
  const want = Math.max(0, Math.min(1, v))
  a.volume = want
  // iPhone 上 volume 只读：设置后不会变化
  set({ volume: a.volume, volumeLocked: Math.abs(a.volume - want) > 0.01 })
  void save(true)
}

export function setRepeat(r: Repeat) {
  set({ repeat: r })
  void save(true)
}

export function setShuffle(on: boolean) {
  set({ shuffle: on, order: on ? shuffledOrder(state.queue.length, state.index) : [] })
  void save(true)
}

/** 睡眠定时：分钟数、'track'（播完这首）或 null（取消） */
export function setSleep(v: number | 'track' | null) {
  clearTimeout(sleepTimer)
  if (v === null) return set({ sleep: null })
  if (v === 'track') return set({ sleep: { endOfTrack: true } })
  const at = Date.now() + v * 60_000
  set({ sleep: { at } })
  sleepTimer = setTimeout(() => {
    pause()
    set({ sleep: null })
  }, v * 60_000)
}

export function stop() {
  audio?.pause()
  if (audio) audio.removeAttribute('src')
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
  set({ queue: [], index: -1, order: [], track: undefined, playing: false, position: 0, duration: 0 })
  void save(true)
}

/** 曲目被删除时调用：正在播放的被删就停止 */
export async function onTracksDeleted(ids: string[]) {
  if (state.track && ids.includes(state.track.id)) stop()
  else if (state.queue.some((q) => ids.includes(q))) {
    const queue = state.queue.filter((q) => !ids.includes(q))
    const index = state.track ? queue.indexOf(state.track.id) : -1
    set({ queue, index, order: state.shuffle ? shuffledOrder(queue.length, index) : [] })
    void save(true)
  }
}
