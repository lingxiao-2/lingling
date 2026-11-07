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

/** 「分享到聆聆」的快捷指令步骤（地址取当前聆聆的网址） */
export function shareRecipes(prefix: (kind?: 'image' | 'file') => string): { name: string; title: string; why: string; steps: string[] }[] {
  return [
    {
      name: '分享到聆聆',
      title: '文字与网页链接',
      why: '在任何 App 里选中文字或在 Safari 里点分享，选「分享到聆聆」，内容会出现在聆聆的预览页。最多 4000 字。',
      steps: [
        '新建快捷指令，命名为「分享到聆聆」',
        '点底部的「ⓘ」（详细信息），打开「在共享表单中显示」，接收类型只勾选「文本」「URL」「Safari 网页」',
        '添加「URL 编码」，输入选「快捷指令输入」',
        `添加「文本」，内容填：${prefix()}，然后在末尾插入上一步的「URL 编码后的文本」`,
        '添加「打开 URL」，输入选上一步的「文本」',
        '保存。之后在分享菜单最下方「编辑操作」里可以把它放到前面',
      ],
    },
    {
      name: '图片发到聆聆',
      title: '图片（通过剪贴板，不经过网络）',
      why: '图片太大，不能放进链接。快捷指令把图片拷贝到剪贴板，再打开聆聆，你在预览页点「粘贴图片」。',
      steps: [
        '新建快捷指令，命名为「图片发到聆聆」，在详细信息中打开「在共享表单中显示」，接收类型只勾选「图像」',
        '添加「拷贝到剪贴板」，输入选「快捷指令输入」',
        `添加「打开 URL」，网址填：${prefix('image')}`,
        '保存。在照片里点分享 →「图片发到聆聆」→ 聆聆打开后点「粘贴图片」，iPhone 询问时点「允许粘贴」',
      ],
    },
    {
      name: '文件信息发到聆聆',
      title: '文件名与大小（不传文件内容）',
      why: '只把文件名和大小交给聆聆，例如想让角色帮你记下「已经收到合同」。',
      steps: [
        '新建快捷指令，命名为「文件信息发到聆聆」，在共享表单中接收「文件」',
        '添加「获取文件的详细信息」→ 名称；再添加一个 → 文件大小',
        '添加「文本」：文件：（名称） 大小：（文件大小）',
        '添加「URL 编码」，输入选上一步的「文本」',
        `添加「文本」：${prefix('file')}，末尾插入「URL 编码后的文本」，再添加「打开 URL」`,
      ],
    },
  ]
}
