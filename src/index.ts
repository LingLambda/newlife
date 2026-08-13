import { Bot, Context, Schema } from 'koishi'
import {} from '@koishijs/plugin-console'
import {} from '@koishijs/plugin-server'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { RelifeLunaService, type PresetInput, type PresetUpdateInput, type PresetView } from './service'
import { AVATAR_ROUTE, decodeAvatarDataUrl, getAvatarPreviewUrl, getAvatarRoot, getSessionGroupId, isSupportedBot, persistAvatar, sniffAvatarType, type ApplyResult, type ProtocolProfile } from './protocols'

export const name = 'relifeluna'

export const inject = {
  required: ['database'],
  optional: ['console', 'server', 'chatluna'],
}

export interface Config {
  sendGreeting: boolean
  chatlunaTools: ChatLunaToolName[]
}

export type ChatLunaToolName =
  | 'relifeluna_list_presets'
  | 'relifeluna_get_profile'
  | 'relifeluna_create_preset'
  | 'relifeluna_update_preset'
  | 'relifeluna_delete_preset'
  | 'relifeluna_apply_preset'
  | 'relifeluna_set_group_card'

export const CHATLUNA_TOOLS: ChatLunaToolName[] = [
  'relifeluna_list_presets',
  'relifeluna_get_profile',
  'relifeluna_create_preset',
  'relifeluna_update_preset',
  'relifeluna_delete_preset',
  'relifeluna_apply_preset',
  'relifeluna_set_group_card',
]

export const Config: Schema<Config> = Schema.object({
  sendGreeting: Schema.boolean()
    .default(true)
    .description('通过聊天命令切换预设后，发送预设中的寒暄模板。'),
  chatlunaTools: Schema.array(Schema.union([
    Schema.const('relifeluna_list_presets').description('获取身份预设列表'),
    Schema.const('relifeluna_get_profile').description('获取当前机器人资料'),
    Schema.const('relifeluna_create_preset').description('创建身份预设'),
    Schema.const('relifeluna_update_preset').description('修改身份预设'),
    Schema.const('relifeluna_delete_preset').description('删除身份预设'),
    Schema.const('relifeluna_apply_preset').description('切换机器人身份'),
    Schema.const('relifeluna_set_group_card').description('单独设置当前群的机器人群名片'),
  ])).role('checkbox').default(CHATLUNA_TOOLS).description('选择要向 ChatLuna 注册的工具；修改后需要重载插件。'),
}).description('身份预设、头像和寒暄模板请在 Koishi 控制台侧边栏的 RelifeLuna WebUI 中管理。')

export interface BotView {
  platform: string
  selfId: string
  name: string
  avatar?: string
  status: string
  supported: boolean
}

export interface AvatarUploadResult {
  url: string
  previewUrl: string
  permanent: boolean
}

export interface ConsolePresetView extends PresetView {
  avatarPreview?: string
}

declare module '@koishijs/plugin-console' {
  interface Events {
    'relifeluna/presets/list'(enabledOnly?: boolean): Promise<ConsolePresetView[]>
    'relifeluna/presets/create'(input: PresetInput): Promise<PresetView>
    'relifeluna/presets/update'(id: number, input: PresetUpdateInput): Promise<PresetView>
    'relifeluna/presets/remove'(id: number): Promise<void>
    'relifeluna/bots/list'(): BotView[]
    'relifeluna/profiles/get'(platform: string, selfId: string): Promise<ProtocolProfile>
    'relifeluna/apply'(name: string, platform: string, selfId: string): Promise<ApplyResult>
    'relifeluna/config/current'(): Config
    'relifeluna/avatar/upload'(dataUrl: string): Promise<AvatarUploadResult>
  }
}

const MAX_LISTED_PRESETS = 30
function toBotView(bot: Bot): BotView {
  return {
    platform: bot.platform,
    selfId: bot.selfId,
    name: bot.user?.name ?? '',
    avatar: bot.user?.avatar,
    status: String(bot.status ?? 'offline'),
    supported: isSupportedBot(bot),
  }
}

export interface GreetingVariables {
  name: string
  nickname: string
  newName: string
  newNickname: string
  oldName: string
  oldNickname: string
  bio: string
  groupNick: string
  platform: string
  selfId: string
}

export function renderGreeting(template: string, variables: GreetingVariables | string): string {
  const values: GreetingVariables = typeof variables === 'string'
    ? {
        name: variables,
        nickname: variables,
        newName: variables,
        newNickname: variables,
        oldName: '',
        oldNickname: '',
        bio: '',
        groupNick: '',
        platform: '',
        selfId: '',
      }
    : variables
  return template
    .replaceAll('%s', values.name)
    .replace(/\{\{(name|nickname|newName|newNickname|oldName|oldNickname|bio|groupNick|platform|selfId)\}\}|\{(name|nickname|newName|newNickname|oldName|oldNickname|bio|groupNick|platform|selfId)\}/g, (_match, doubleKey, singleKey) => {
      const key = (doubleKey || singleKey) as keyof GreetingVariables
      return values[key] ?? ''
    })
}

function formatResult(result: ApplyResult): string {
  if (result.ok) return `已切换为「${result.preset}」（${result.platform}:${result.selfId}）`
  const parts = result.errors.map(error => `${error.field}: ${error.message}`)
  const extra: string[] = []
  if (result.applied.nickname) extra.push('昵称已更新')
  if (result.applied.avatar) extra.push('头像已更新')
  if (result.applied.groupNick) extra.push('群名片已更新')
  if (extra.length) parts.push(extra.join('、'))
  return `部分更新失败：${parts.join('；')}`
}

function listText(presets: PresetView[]): string {
  if (!presets.length) return '暂无身份预设，请在控制台 RelifeLuna 页面创建。'
  const shown = presets.slice(0, MAX_LISTED_PRESETS)
  const lines = ['可用身份预设：', ...shown.map(preset => `· ${preset.name}`)]
  if (presets.length > shown.length) lines.push(`……等共 ${presets.length} 个`)
  return lines.join('\n')
}

export function apply(ctx: Context, config: Config) {
  ctx.plugin(RelifeLunaService)
  const avatarRoot = getAvatarRoot(ctx)

  ctx.command('relife <name>', '切换机器人身份预设', { authority: 4 })
    .usage('切换当前会话机器人的身份。')
    .example('relife 奏   切换为昵称「奏」的预设')
    .action(async ({ session }, name) => {
      const service = ctx.relifeluna
      const preset = await service.findPreset(name)
      if (!preset) return `未找到身份「${name}」，请使用 relife.list 查看所有身份。`
      if (!preset.enabled) return `预设「${name}」已停用。`
      if (!session.bot || !isSupportedBot(session.bot)) {
        return `当前会话机器人（${session.bot?.platform ?? '未知'}）暂不支持身份切换。`
      }
      const groupId = getSessionGroupId(session)
      const oldName = session.bot.user?.name ?? ''
      const result = await service.applyPresetToBot(preset, session.bot, groupId ? { groupId } : undefined)
      if (result.ok) {
        if (config.sendGreeting && preset.greeting) {
          return renderGreeting(preset.greeting, {
            name: preset.name,
            nickname: preset.name,
            newName: preset.name,
            newNickname: preset.name,
            oldName,
            oldNickname: oldName,
            bio: preset.bio,
            groupNick: preset.groupNick,
            platform: session.bot.platform,
            selfId: session.bot.selfId,
          })
        }
        return formatResult(result)
      }
      return formatResult(result)
    })

  ctx.command('relife.list', '获取所有身份预设', { authority: 4 })
    .action(async () => listText(await ctx.relifeluna.listPresets()))

  ctx.command('relife.card <groupNick:text>', '单独设置当前群的机器人群名片', { authority: 4 })
    .usage('仅修改当前群中的机器人群名片，不修改 QQ 昵称、头像或个签。')
    .example('relife.card 群里的小奏')
    .action(async ({ session }, groupNick) => {
      if (!session.bot || !isSupportedBot(session.bot)) {
        return `当前会话机器人（${session.bot?.platform ?? '未知'}）暂不支持设置群名片。`
      }
      const groupId = getSessionGroupId(session)
      if (!groupId) return '请在群聊中使用 relife.card 命令。'
      try {
        const result = await ctx.relifeluna.setGroupCard(session.bot, groupId, groupNick)
        return `已将当前群的机器人群名片设置为「${result.groupNick}」。`
      } catch (error) {
        return `设置群名片失败：${error instanceof Error ? error.message : error}`
      }
    })

  ctx.inject(['console', 'server', 'relifeluna'], (ctx) => {
    ctx.server.get(`${AVATAR_ROUTE}:filename`, async (koa) => {
      const filename = basename(koa.params.filename)
      if (!filename || filename !== koa.params.filename) return koa.status = 404
      try {
        const buffer = await readFile(resolve(avatarRoot, filename))
        koa.type = sniffAvatarType(buffer) ?? 'application/octet-stream'
        koa.body = buffer
      } catch {
        koa.status = 404
      }
    })

    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    })

    const { relifeluna } = ctx

    ctx.console.addListener('relifeluna/presets/list', async (enabledOnly) => {
      const presets = await relifeluna.listPresets(Boolean(enabledOnly))
      return presets.map(preset => ({
        ...preset,
        avatarPreview: getAvatarPreviewUrl(ctx, preset.avatar),
      }))
    }, { authority: 4 })

    ctx.console.addListener('relifeluna/presets/create', async (input) => {
      return relifeluna.createPreset(input)
    }, { authority: 4 })

    ctx.console.addListener('relifeluna/presets/update', async (id, input) => {
      return relifeluna.updatePreset(id, input)
    }, { authority: 4 })

    ctx.console.addListener('relifeluna/presets/remove', async (id) => {
      await relifeluna.removePreset(id)
    }, { authority: 4 })

    ctx.console.addListener('relifeluna/bots/list', () => {
      return ctx.bots
        .map(toBotView)
        .sort((left, right) => `${left.platform}:${left.selfId}`.localeCompare(`${right.platform}:${right.selfId}`))
    }, { authority: 4 })

    ctx.console.addListener('relifeluna/profiles/get', async (platform, selfId) => {
      if (typeof platform !== 'string' || !platform || typeof selfId !== 'string' || !selfId) {
        throw new Error('平台或机器人 ID 无效')
      }
      return relifeluna.getBotProfile(platform, selfId)
    }, { authority: 4 })

    ctx.console.addListener('relifeluna/apply', async (presetName, platform, selfId) => {
      if (typeof platform !== 'string' || !platform || typeof selfId !== 'string' || !selfId) {
        throw new Error('平台或机器人 ID 无效')
      }
      const preset = await relifeluna.findPreset(String(presetName ?? ''))
      if (!preset) throw new Error(`未找到预设「${presetName}」`)
      if (!preset.enabled) throw new Error(`预设「${presetName}」已停用`)
      return relifeluna.applyPreset(preset, platform, selfId)
    }, { authority: 4 })

    ctx.console.addListener('relifeluna/config/current', () => ({ ...config }), { authority: 4 })

    ctx.console.addListener('relifeluna/avatar/upload', async (dataUrl) => {
      await decodeAvatarDataUrl(dataUrl)
      const url = await persistAvatar(ctx, dataUrl)
      const filename = basename(new URL(url).pathname)
      return {
        url,
        previewUrl: `${AVATAR_ROUTE}${encodeURIComponent(filename)}`,
        permanent: true,
      }
    }, { authority: 4 })
  })

  ctx.inject(['chatluna'], (ctx) => {
    ctx.on('ready', async () => {
      try {
        const { registerChatLunaTools } = await import('./chatluna')
        registerChatLunaTools(ctx, config.chatlunaTools)
        ctx.logger('relifeluna').info('registered %d ChatLuna tools', config.chatlunaTools.length)
      } catch (error) {
        ctx.logger('relifeluna').error('failed to register ChatLuna tools: %s', error instanceof Error ? error.message : error)
      }
    })
  })
}
