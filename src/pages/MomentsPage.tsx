import NavBar from '../components/NavBar'
import { Empty } from '../components/ui'

export default function MomentsPage() {
  return (
    <>
      <NavBar title="动态" />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Empty
          title="朋友圈将在 V0.2 开放"
          hint="发布动态、角色动态、点赞与评论、可见范围等功能尚未开发。数据结构已经预留，后续版本会直接接入。"
        />
      </div>
    </>
  )
}
