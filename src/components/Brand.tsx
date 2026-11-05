/** 顶部品牌标题：中文「聆聆」为主，小字号英文 LINGLING 作点缀 */
export default function Brand() {
  return (
    <span className="brand" aria-label="聆聆 Lingling">
      <span className="brand-zh">聆聆</span>
      <span className="brand-en" aria-hidden="true">
        <span className="brand-en-text">LINGLING</span>
      </span>
    </span>
  )
}
