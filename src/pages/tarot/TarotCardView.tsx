/** 一张塔罗牌：牌背（星光纹样）与牌面（编号、图案、名称），轻柔的翻牌动画；逆位时牌面倒转 */
import { Icon, type IconName } from '../../theme/icons'
import { cardById, ROMAN, SUIT_INFO, type DrawnCard } from '../../tarot/deck'

const MAJOR_ICON: IconName[] = ['tarotFootprints', 'tarotWandSparkles', 'tarotEye', 'giftFlower2', 'tarotCrown', 'tarotChurch', 'tarotHeartHandshake', 'tarotMountain', 'giftCat', 'tarotLightbulb', 'tarotOrbit', 'tarotScale', 'tarotHourglass', 'tarotFeather', 'tarotWaves', 'tarotLock', 'tarotZap', 'giftStar', 'tarotMoon', 'wxSun', 'giftBell', 'tarotGlobe']
const SUIT_ICON: Record<'wands' | 'cups' | 'swords' | 'pentacles', IconName> = { wands: 'tarotWandSparkles', cups: 'tarotWine', swords: 'tarotSword', pentacles: 'tarotCoins' }
const RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'P', 'Kn', 'Q', 'K']

export function iconOf(cardId: string): IconName {
  const c = cardById(cardId)
  if (!c) return 'sparkle'
  return c.suit === 'major' ? MAJOR_ICON[c.number] : SUIT_ICON[c.suit]
}

export default function TarotCardView({ drawn, revealed, theme, onReveal, size = 'md' }: { drawn: DrawnCard; revealed: boolean; theme: 'ice' | 'silver' | 'night'; onReveal?: () => void; size?: 'sm' | 'md' }) {
  const c = cardById(drawn.cardId)
  if (!c) return null
  const num = c.suit === 'major' ? ROMAN[c.number] : RANK_LABEL[c.number - 1]
  const w = size === 'sm' ? 92 : 112
  return (
    <button
      type="button"
      className={`tarot-card tarot-${theme} ${revealed ? 'is-revealed' : ''}`}
      style={{ width: w, height: Math.round(w * 1.66) }}
      onClick={onReveal}
      disabled={revealed || !onReveal}
      aria-label={revealed ? `${drawn.position}：${c.name}${drawn.reversed ? '（逆位）' : '（正位）'}` : `${drawn.position}：点按翻开`}
    >
      <span className="tarot-inner">
        <span className="tarot-back" aria-hidden>
          <span className="tarot-back-star"><Icon name="sparkle" size="md" stroke="thin" /></span>
        </span>
        <span className={`tarot-face ${drawn.reversed ? 'is-reversed' : ''}`} aria-hidden>
          <span className="tarot-num">{num}</span>
          <span className="tarot-motif"><Icon name={iconOf(c.id)} size="lg" stroke="thin" /></span>
          <span className="tarot-name serif-zh">{c.name}</span>
          <span className="tarot-en">{c.suit === 'major' ? c.en.replace(/^The /, '') : SUIT_INFO[c.suit].en}</span>
        </span>
      </span>
    </button>
  )
}
