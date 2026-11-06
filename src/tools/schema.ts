/**
 * 工具参数的严格校验（JSON Schema 的一个很小的子集，只支持工具定义里实际用到的写法）。
 *  - 对象：只允许 properties 里列出的键（多出来的键一律拒绝），required 必须存在
 *  - 字符串：必须声明 maxLength；可选 minLength、enum、format（date = YYYY-MM-DD 真实日期，time = HH:MM）
 *  - 整数 / 数字：可选 minimum、maximum；整数必须是整数
 *  - 数组：必须声明 maxItems；items 逐个校验
 * 校验失败返回中文原因，不抛异常；校验通过返回一份只含已声明字段的新对象。
 */
import { isDateString } from '../life/diary'

export type Schema =
  | { type: 'string'; description?: string; maxLength: number; minLength?: number; enum?: readonly string[]; format?: 'date' | 'time' }
  | { type: 'integer' | 'number'; description?: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; description?: string; items: Schema; maxItems: number }
  | ObjectSchema

export interface ObjectSchema {
  type: 'object'
  description?: string
  properties: Record<string, Schema>
  required?: readonly string[]
}

export type Validated = { ok: true; value: unknown } | { ok: false; error: string }

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function check(s: Schema, v: unknown, path: string): Validated {
  const at = path || '参数'
  switch (s.type) {
    case 'string': {
      if (typeof v !== 'string') return { ok: false, error: `${at} 应该是文字` }
      if (v.length > s.maxLength) return { ok: false, error: `${at} 太长（最多 ${s.maxLength} 个字）` }
      if (s.minLength !== undefined && v.trim().length < s.minLength) return { ok: false, error: `${at} 不能为空` }
      if (s.enum && !s.enum.includes(v)) return { ok: false, error: `${at} 只能是 ${s.enum.join(' / ')}` }
      if (s.format === 'date' && !isDateString(v)) return { ok: false, error: `${at} 不是有效日期（YYYY-MM-DD）` }
      if (s.format === 'time' && !TIME.test(v)) return { ok: false, error: `${at} 不是有效时间（HH:MM）` }
      return { ok: true, value: v }
    }
    case 'integer':
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `${at} 应该是数字` }
      if (s.type === 'integer' && !Number.isInteger(v)) return { ok: false, error: `${at} 应该是整数` }
      if (s.minimum !== undefined && v < s.minimum) return { ok: false, error: `${at} 不能小于 ${s.minimum}` }
      if (s.maximum !== undefined && v > s.maximum) return { ok: false, error: `${at} 不能大于 ${s.maximum}` }
      return { ok: true, value: v }
    }
    case 'boolean':
      return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, error: `${at} 应该是 true 或 false` }
    case 'array': {
      if (!Array.isArray(v)) return { ok: false, error: `${at} 应该是列表` }
      if (v.length > s.maxItems) return { ok: false, error: `${at} 最多 ${s.maxItems} 项` }
      const out: unknown[] = []
      for (const [i, x] of v.entries()) {
        const r = check(s.items, x, `${at}[${i}]`)
        if (!r.ok) return r
        out.push(r.value)
      }
      return { ok: true, value: out }
    }
    case 'object': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, error: `${at} 应该是对象` }
      const obj = v as Record<string, unknown>
      for (const k of Object.keys(obj)) {
        if (!Object.prototype.hasOwnProperty.call(s.properties, k)) return { ok: false, error: `不认识的参数：${path ? `${path}.` : ''}${k}` }
      }
      for (const k of s.required ?? []) {
        if (obj[k] === undefined || obj[k] === null) return { ok: false, error: `缺少参数：${path ? `${path}.` : ''}${k}` }
      }
      const out: Record<string, unknown> = {}
      for (const [k, sub] of Object.entries(s.properties)) {
        if (obj[k] === undefined || obj[k] === null) continue
        const r = check(sub, obj[k], path ? `${path}.${k}` : k)
        if (!r.ok) return r
        out[k] = r.value
      }
      return { ok: true, value: out }
    }
  }
}

export function validate(schema: ObjectSchema, value: unknown): Validated {
  return check(schema, value, '')
}

/** 工具定义本身是否合法（注册时检查，写错的定义直接拒绝注册） */
export function schemaProblem(s: Schema, path = '参数'): string | null {
  switch (s.type) {
    case 'string':
      return Number.isInteger(s.maxLength) && s.maxLength > 0 ? null : `${path}：文字参数必须声明 maxLength`
    case 'array':
      if (!Number.isInteger(s.maxItems) || s.maxItems <= 0) return `${path}：列表参数必须声明 maxItems`
      return schemaProblem(s.items, `${path}[]`)
    case 'object':
      for (const k of s.required ?? []) if (!s.properties[k]) return `${path}：required 中的 ${k} 没有定义`
      for (const [k, sub] of Object.entries(s.properties)) {
        const p = schemaProblem(sub, `${path}.${k}`)
        if (p) return p
      }
      return null
    case 'integer':
    case 'number':
    case 'boolean':
      return null
    default:
      return `${path}：不支持的类型`
  }
}

/** 发给模型的 JSON Schema（加上 additionalProperties: false，与本地的严格校验一致） */
export function toJsonSchema(s: Schema): Record<string, unknown> {
  if (s.type === 'object') {
    return {
      type: 'object',
      ...(s.description ? { description: s.description } : {}),
      properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)])),
      required: [...(s.required ?? [])],
      additionalProperties: false,
    }
  }
  if (s.type === 'array') return { type: 'array', ...(s.description ? { description: s.description } : {}), items: toJsonSchema(s.items), maxItems: s.maxItems }
  if (s.type === 'string') {
    const { format, ...rest } = s
    return { ...rest, ...(format === 'date' ? { pattern: '^\\d{4}-\\d{2}-\\d{2}$' } : format === 'time' ? { pattern: '^\\d{2}:\\d{2}$' } : {}), ...(s.enum ? { enum: [...s.enum] } : {}) }
  }
  return { ...s }
}
