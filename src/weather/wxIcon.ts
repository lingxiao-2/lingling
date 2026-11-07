import type { IconName } from '../theme/icons'
import { describeCode } from './openMeteo'

const WX_ICON: Record<ReturnType<typeof describeCode>['icon'], IconName> = { sun: 'wxSun', moon: 'wxMoon', cloudSun: 'wxCloudSun', cloud: 'wxCloud', fog: 'wxFog', drizzle: 'wxDrizzle', rain: 'wxRain', snow: 'wxSnow', storm: 'wxStorm' }
export const wxIcon = (code: number, isDay = true): IconName => WX_ICON[describeCode(code, isDay).icon]
