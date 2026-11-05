# Winter Letter 素材

本目录下的素材都是代码生成的原创矢量图，可以随时替换：

| 文件 | 内容 | 替换方式 |
|---|---|---|
| `windowScene.ts` | 聊天默认壁纸「冬日窗景」：雪松林、窗框、纱帘、路灯暖光、雪丘、细雪 | 用户可在「我的 → 主题与壁纸 → 聊天背景」上传自己的图片；如需更换默认壁纸，把图片放到 `src/assets/winter/` 并在 `components/Wallpaper.tsx` 的 `wallpaperStyle(…, 'chat')` 中引用 |
| `ornaments.ts` | 细线雪花、四角星光、丝带蝴蝶结 | 替换 `BOW_SVG` / `snowflakePath()`，或改为导入 PNG/SVG 文件 |

默认头像图案（雪花、星光、月亮）在 `components/Avatar.tsx` 中，同样是原创 SVG。

如果要达到参考图那种"手绘插画"级别的质感，需要提供有使用授权的高清素材，建议：

- 聊天壁纸：竖版 ≥ 1290×2796 px（iPhone Pro Max 比例），窗景构图，主体留在两侧，中间偏亮、低对比，便于阅读文字。
- 丝带 / 蕾丝装饰：透明背景 PNG（≥ 3 倍图）或 SVG。
- 默认头像：角色与用户各一张，正方形 ≥ 180×180 px。
