/**
 * 在 iPhone「快捷指令」App 中手动创建快捷指令的步骤。
 * 聆聆无法替你生成或分发快捷指令（没有经过审核的安装链接），所以这里不放「一键安装」按钮，只给照着做的步骤。
 * 操作名称以 iOS 17 / 18 简体中文界面为准；不同版本可能略有差别。
 */
import { RECOMMENDED } from './shortcuts'

export interface Recipe {
  purpose: 'test' | 'reminder' | 'calendar'
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
  {
    purpose: 'reminder',
    name: RECOMMENDED.reminder,
    title: '创建 iPhone 提醒事项',
    why: '收到聆聆传来的标题和时间，在系统「提醒事项」App 中新建一条带提醒时间的提醒事项。',
    steps: [
      `新建快捷指令，命名为「${RECOMMENDED.reminder}」`,
      '添加「从输入获取词典」，输入选「快捷指令输入」',
      '添加「获取词典值」：获取「值」，键填 title',
      '再添加「获取词典值」：键填 due（输入选第 2 步的「词典」）',
      '添加「从输入中获取日期」，输入选上一步的「词典值」',
      '添加「添加新提醒事项」：内容选第 3 步的「词典值」；打开「提醒」，时间选上一步的「日期」',
      '添加「停止并输出」，内容填文字 ok',
      '保存后先在快捷指令 App 里手动运行一次，允许它访问提醒事项（之后从聆聆运行不再询问）',
    ],
    sample: '{"v":1,"type":"reminder","title":"去买东西","due":"2026-11-08 15:00","notes":""}',
  },
  {
    purpose: 'calendar',
    name: RECOMMENDED.calendar,
    title: '创建 iPhone 日历事件',
    why: '收到聆聆传来的标题、开始和结束时间、地点、备注，在系统「日历」App 中新建事件。',
    steps: [
      `新建快捷指令，命名为「${RECOMMENDED.calendar}」`,
      '添加「从输入获取词典」，输入选「快捷指令输入」',
      '添加 4 个「获取词典值」，键分别填 title、start、end、location（输入都选第 2 步的「词典」）',
      '添加「从输入中获取日期」，输入选 start 的词典值；再添加一个，输入选 end 的词典值',
      '添加「添加新日历事件」：标题选 title，开始日期选 start 的日期，结束日期选 end 的日期，位置选 location',
      '添加「停止并输出」，内容填文字 ok',
      '保存后先在快捷指令 App 里手动运行一次，允许它访问日历',
    ],
    sample: '{"v":1,"type":"calendar","title":"面试","start":"2026-11-13 10:00","end":"2026-11-13 11:00","location":"","notes":""}',
  },
]

export const recipeFor = (p: Recipe['purpose']) => RECIPES.find((r) => r.purpose === p)
