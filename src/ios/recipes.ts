/**
 * 在 iPhone「快捷指令」App 中手动创建快捷指令的步骤。
 * 聆聆无法替你生成或分发快捷指令（没有经过审核的安装链接），所以这里不放「一键安装」按钮，只给照着做的步骤。
 * 操作名称以 iOS 17 / 18 简体中文界面为准；不同版本可能略有差别。
 */
import { RECOMMENDED, type ShortcutPurpose } from './shortcuts'

export interface Recipe {
  purpose: Exclude<ShortcutPurpose, 'custom'>
  name: string
  title: string
  why: string
  steps: string[]
  /** 聆聆会传给它的输入示例 */
  sample?: string
}

export const RECIPES: Recipe[] = [
  {
    purpose: 'test',
    name: RECOMMENDED.test,
    title: '测试连接',
    why: '把收到的文字原样交回给聆聆，用来确认「能打开快捷指令」「能收到参数」「能回到聆聆」。',
    steps: [
      '打开「快捷指令」App，点右上角「＋」新建快捷指令',
      `点顶部名称，改为「${RECOMMENDED.test}」（必须完全一致）`,
      '点「添加操作」，搜索「停止并输出」，添加',
      '把「停止并输出」里的内容设为「快捷指令输入」',
      '点「完成」保存',
    ],
    sample: '聆聆测试 1a2b3c',
  },
]

export const recipeFor = (p: Recipe['purpose']) => RECIPES.find((r) => r.purpose === p)
