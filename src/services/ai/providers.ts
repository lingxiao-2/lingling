/**
 * 「连接 AI」向导与 API 设置页使用的服务商预设（均为 OpenAI Chat Completions 兼容接口）。
 *
 * 只有 DeepSeek 的地址与模型名在开发时对照过官方文档（2026-11）；
 * 其他服务商只预填公开文档中的接口地址，模型名请到对方控制台复制——
 * 模型名经常更新，写死很容易过期。
 */
export interface ProviderPreset {
  id: string
  name: string
  /** 一句话说明，显示在列表中 */
  note: string
  baseUrl: string
  /** 推荐模型；留空表示需要用户到控制台复制 */
  model: string
  /** 获取 API Key 的控制台页面 */
  keyUrl: string
  /** 获取 Key 的简短步骤 */
  steps: string[]
  recommended?: boolean
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 深度求索',
    note: '推荐 · 中文对话自然，按用量计费，价格较低',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    steps: ['用手机号登录 DeepSeek 开放平台', '完成实名认证，并按需充值少量余额（按用量扣费）', '在「API Keys」里创建一个新 Key，复制下来'],
    recommended: true,
  },
  {
    id: 'bailian',
    name: '阿里云百炼（通义千问）',
    note: '模型选择多，新用户通常有免费额度',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: '',
    keyUrl: 'https://bailian.console.aliyun.com/',
    steps: ['登录阿里云百炼控制台', '开通模型服务后，在「API Key」页面创建 Key', '在模型广场复制想用的模型名称（例如 Flash 系列）'],
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    note: '汇集多家开源模型，部分模型免费',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: '',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    steps: ['登录硅基流动', '在「API 密钥」页面新建密钥', '在模型广场复制模型名称'],
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    note: '长文本能力强',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: '',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    steps: ['登录 Kimi 开放平台', '在「API Key 管理」中新建 Key', '在模型列表中复制模型名称'],
  },
  {
    id: 'zhipu',
    name: '智谱 BigModel（GLM）',
    note: '有部分免费模型',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: '',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    steps: ['登录智谱开放平台', '在「API Keys」中添加新的 Key', '在模型列表中复制模型名称'],
  },
  {
    id: 'other',
    name: '其他 OpenAI 兼容服务',
    note: '自己填写接口地址和模型名称',
    baseUrl: '',
    model: '',
    keyUrl: '',
    steps: ['在服务商控制台创建 API Key', '找到「OpenAI 兼容」接口地址（通常以 /v1 结尾）', '复制模型名称'],
  },
]

/** 已知已更名的模型：提示用户更新（不自动修改用户已保存的配置） */
export function modelRenameHint(baseUrl: string, model: string): string | null {
  if (/deepseek\.com/i.test(baseUrl) && /^deepseek-(chat|reasoner)$/i.test(model.trim())) {
    return 'DeepSeek 官方文档目前使用的模型名是 deepseek-flash（或 deepseek-v4-pro）。如果测试时提示模型不存在，请改用新名称。'
  }
  return null
}

export function findProvider(baseUrl: string): ProviderPreset | undefined {
  const u = baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  return PROVIDERS.find((p) => p.baseUrl && p.baseUrl.replace(/\/v1$/, '') === u)
}
