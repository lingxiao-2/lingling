export function uid(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return prefix ? `${prefix}_${rand}` : rand
}

const pad = (n: number) => String(n).padStart(2, '0')

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** 会话列表使用的时间：今天 HH:mm，昨天，同年 M/D，其他 YYYY/M/D */
export function formatListTime(ts: number, now = Date.now()): string {
  if (!ts) return ''
  const d = new Date(ts)
  const today = startOfDay(new Date(now))
  if (ts >= today) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (ts >= today - 86400000) return '昨天'
  if (d.getFullYear() === new Date(now).getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** 聊天内时间分隔条 */
export function formatChatTime(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const today = startOfDay(new Date(now))
  if (ts >= today) return hm
  if (ts >= today - 86400000) return `昨天 ${hm}`
  if (d.getFullYear() === new Date(now).getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

/** 读取图片并压缩为正方形 dataURL，用于头像 */
export function imageToAvatar(file: Blob, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('无法处理图片'))
        return
      }
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

export function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** 读取图片并裁成 16:9 封面 dataURL */
export function imageToCover(file: File, width = 960, height = 540): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const target = width / height
      let sw = img.width
      let sh = img.width / target
      if (sh > img.height) {
        sh = img.height
        sw = img.height * target
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      URL.revokeObjectURL(url)
      if (!ctx) {
        reject(new Error('无法处理图片'))
        return
      }
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

/**
 * 动态配图：缩小到最长边 maxSide 以内，转成 JPEG dataURL；体积超过 maxBytes 时逐步降低质量。
 * 透明背景填成白色。只在本机处理，不上传。
 */
export function imageToMomentPhoto(file: Blob, maxSide = 1280, maxBytes = 900_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(file.type) && file.type !== '') {
      reject(new Error('只支持 JPG、PNG、WebP、GIF 图片'))
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const k = Math.min(1, maxSide / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * k))
      canvas.height = Math.max(1, Math.round(img.height * k))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('无法处理图片'))
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      let q = 0.85
      let out = canvas.toDataURL('image/jpeg', q)
      while (out.length * 0.75 > maxBytes && q > 0.45) {
        q -= 0.1
        out = canvas.toDataURL('image/jpeg', q)
      }
      resolve(out)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败，换一张试试'))
    }
    img.src = url
  })
}
