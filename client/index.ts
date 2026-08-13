import { Context, icons } from '@koishijs/client'
import RelifeLunaPage from './page.vue'
import RelifeIcon from './relife-icon.vue'

icons.register('relifeluna:relife', RelifeIcon)

export default (ctx: Context) => {
  ctx.page({
    name: 'RelifeLuna',
    desc: '管理 OneBot / Milky 机器人的身份预设',
    path: '/relifeluna',
    icon: 'relifeluna:relife',
    order: 750,
    authority: 4,
    fields: ['database'],
    component: RelifeLunaPage,
  })
}
