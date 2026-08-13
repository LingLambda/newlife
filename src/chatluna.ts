import { Context, Session } from 'koishi'
import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { getBotProfile, getSessionGroupId, isSupportedBot } from './protocols'
import type { ChatLunaToolName } from './index'

const TOOL_GROUP = 'relifeluna'

interface ToolRunnableLike {
  configurable?: {
    session?: Session
  }
}

interface ChatLunaToolLike {
  description?: string
  name?: string
  createTool: () => StructuredTool
  selector?: (history: unknown[]) => boolean
  authorization?: (session: Session) => boolean
  meta?: {
    source?: string
    group?: string
    tags?: string[]
    defaultAvailability?: {
      enabled?: boolean
      main?: boolean
      chatluna?: boolean
      characterScope?: 'all' | 'group' | 'private' | 'none'
    }
  }
}

function getAuthority(session?: Session): number {
  const user = (session as any)?.user
  return typeof user?.authority === 'number' ? user.authority : 0
}

function writeAuthorization(session?: Session): boolean {
  return getAuthority(session) >= 4
}

function assertAuthority(session?: Session): void {
  if (!writeAuthorization(session)) {
    throw new Error('权限不足：管理身份预设需要 authority 4')
  }
}

function getSession(config?: ToolRunnableLike): Session | undefined {
  return config?.configurable?.session
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function errorOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

abstract class BasePresetTool extends StructuredTool {
  name: string
  description: string
  schema: any

  constructor(protected ctx: Context, name: string, description: string, schema: z.ZodTypeAny) {
    super()
    this.name = name
    this.description = description
    this.schema = schema
  }
}

class ListPresetsTool extends BasePresetTool {
  constructor(ctx: Context) {
    super(ctx, 'relifeluna_list_presets', 'List available RelifeLuna identity presets (nickname, bio, group card, greeting, enabled status).', z.object({
      enabledOnly: z.boolean().optional().describe('Whether to only list enabled presets'),
    }))
  }

  async _call(input: { enabledOnly?: boolean }): Promise<string> {
    try {
      const presets = await this.ctx.relifeluna.listPresets(Boolean(input.enabledOnly))
      const list = presets.slice(0, 50).map(({ id, name, avatar, bio, greeting, groupNick, enabled }) => ({
        id,
        name,
        bio,
        greeting,
        groupNick,
        enabled,
        hasAvatar: Boolean(avatar),
      }))
      return stringify({ total: presets.length, presets: list })
    } catch (error) {
      return `Error listing presets: ${errorOf(error)}`
    }
  }
}

class GetProfileTool extends BasePresetTool {
  constructor(ctx: Context) {
    super(ctx, 'relifeluna_get_profile', 'Get the current profile (nickname, avatar, bio) of the bot in the current chat.', z.object({}))
  }

  async _call(_input: Record<string, never>, _runManager?: unknown, config?: ToolRunnableLike): Promise<string> {
    try {
      const session = getSession(config)
      if (!session?.bot) return 'Error: current chat has no bot'
      if (!isSupportedBot(session.bot)) return `Error: platform "${session.bot.platform}" is not supported`
      return stringify(await getBotProfile(session.bot))
    } catch (error) {
      return `Error getting profile: ${errorOf(error)}`
    }
  }
}

class CreatePresetTool extends BasePresetTool {
  constructor(ctx: Context) {
    super(ctx, 'relifeluna_create_preset', 'Create a new RelifeLuna identity preset. The nickname is the unique preset name.', z.object({
      name: z.string().describe('Nickname, used as the unique preset name'),
      avatar: z.string().optional().describe('Avatar URL, file path or data URL'),
      bio: z.string().optional().describe('QQ personal note / bio'),
      greeting: z.string().optional().describe('Greeting template; supports {{newNickname}}, {{oldNickname}}, {{bio}}, {{groupNick}}, {{platform}} and {{selfId}} variables'),
      groupNick: z.string().optional().describe('Group card shown in group chats; applied to the current group when switching in a group session'),
      enabled: z.boolean().optional().describe('Whether the preset is enabled'),
    }))
  }

  async _call(input: { name: string; avatar?: string; bio?: string; greeting?: string; groupNick?: string; enabled?: boolean }, _runManager?: unknown, config?: ToolRunnableLike): Promise<string> {
    try {
      assertAuthority(getSession(config))
      const preset = await this.ctx.relifeluna.createPreset(input)
      return stringify(preset)
    } catch (error) {
      return `Error creating preset: ${errorOf(error)}`
    }
  }
}

class UpdatePresetTool extends BasePresetTool {
  constructor(ctx: Context) {
    super(ctx, 'relifeluna_update_preset', 'Update an existing RelifeLuna identity preset located by its nickname.', z.object({
      name: z.string().describe('Current nickname of the preset to update'),
      newName: z.string().optional().describe('New nickname; omit to keep unchanged'),
      avatar: z.string().optional().describe('New avatar URL, file path or data URL'),
      bio: z.string().optional().describe('New QQ personal note / bio'),
      greeting: z.string().optional().describe('New greeting template; supports {{newNickname}}, {{oldNickname}}, {{bio}}, {{groupNick}}, {{platform}} and {{selfId}} variables'),
      groupNick: z.string().optional().describe('New group card shown in group chats'),
      enabled: z.boolean().optional().describe('Whether the preset is enabled'),
    }))
  }

  async _call(input: { name: string; newName?: string; avatar?: string; bio?: string; greeting?: string; groupNick?: string; enabled?: boolean }, _runManager?: unknown, config?: ToolRunnableLike): Promise<string> {
    try {
      assertAuthority(getSession(config))
      const preset = await this.ctx.relifeluna.findPreset(input.name)
      if (!preset) return `Error: preset "${input.name}" not found`
      const updated = await this.ctx.relifeluna.updatePreset(preset.id, {
        name: input.newName || preset.name,
        avatar: input.avatar !== undefined ? input.avatar : preset.avatar,
        bio: input.bio !== undefined ? input.bio : preset.bio,
        greeting: input.greeting !== undefined ? input.greeting : preset.greeting,
        groupNick: input.groupNick !== undefined ? input.groupNick : preset.groupNick,
        enabled: input.enabled !== undefined ? input.enabled : preset.enabled,
      })
      return stringify(updated)
    } catch (error) {
      return `Error updating preset: ${errorOf(error)}`
    }
  }
}

class DeletePresetTool extends BasePresetTool {
  constructor(ctx: Context) {
    super(ctx, 'relifeluna_delete_preset', 'Delete a RelifeLuna identity preset located by its nickname.', z.object({
      name: z.string().describe('Nickname of the preset to delete'),
    }))
  }

  async _call(input: { name: string }, _runManager?: unknown, config?: ToolRunnableLike): Promise<string> {
    try {
      assertAuthority(getSession(config))
      const preset = await this.ctx.relifeluna.findPreset(input.name)
      if (!preset) return `Error: preset "${input.name}" not found`
      await this.ctx.relifeluna.removePreset(preset.id)
      return stringify({ deleted: preset.name })
    } catch (error) {
      return `Error deleting preset: ${errorOf(error)}`
    }
  }
}

class ApplyPresetTool extends BasePresetTool {
  constructor(ctx: Context) {
    super(ctx, 'relifeluna_apply_preset', 'Switch the bot in the current chat to a RelifeLuna identity preset by nickname. In group chats, the preset group card is also applied to the current group.', z.object({
      name: z.string().describe('Nickname of the preset to apply'),
    }))
  }

  async _call(input: { name: string }, _runManager?: unknown, config?: ToolRunnableLike): Promise<string> {
    try {
      const session = getSession(config)
      assertAuthority(session)
      if (!session?.bot) return 'Error: current chat has no bot'
      if (!isSupportedBot(session.bot)) return `Error: platform "${session.bot.platform}" is not supported`
      const preset = await this.ctx.relifeluna.findPreset(input.name)
      if (!preset) return `Error: preset "${input.name}" not found`
      if (!preset.enabled) return `Error: preset "${input.name}" is disabled`
      const groupId = getSessionGroupId(session)
      const result = await this.ctx.relifeluna.applyPresetToBot(preset, session.bot, groupId ? { groupId } : undefined)
      return stringify(result)
    } catch (error) {
      return `Error applying preset: ${errorOf(error)}`
    }
  }
}

class SetGroupCardTool extends BasePresetTool {
  constructor(ctx: Context) {
    super(ctx, 'relifeluna_set_group_card', 'Set only the current group card of the bot without changing its account nickname, avatar or bio.', z.object({
      groupNick: z.string().describe('Group card to set for the bot in the current group'),
    }))
  }

  async _call(input: { groupNick: string }, _runManager?: unknown, config?: ToolRunnableLike): Promise<string> {
    try {
      const session = getSession(config)
      assertAuthority(session)
      if (!session?.bot) return 'Error: current chat has no bot'
      if (!isSupportedBot(session.bot)) return `Error: platform "${session.bot.platform}" is not supported`
      const groupId = getSessionGroupId(session)
      if (!groupId) return 'Error: this tool can only be used in a group chat'
      return stringify(await this.ctx.relifeluna.setGroupCard(session.bot, groupId, input.groupNick))
    } catch (error) {
      return `Error setting group card: ${errorOf(error)}`
    }
  }
}

function registerTool(ctx: Context, name: string, description: string, createTool: () => StructuredTool, authorization?: (session: Session) => boolean, tags: string[] = []): void {
  const tool: ChatLunaToolLike = {
    description,
    createTool,
    selector: () => true,
    authorization,
    meta: {
      source: 'extension',
      group: 'plugin-common',
      tags: [TOOL_GROUP, ...tags],
      defaultAvailability: {
        enabled: true,
        main: true,
        chatluna: true,
        characterScope: 'all',
      },
    },
  }
  ctx.effect(() => {
    const chatluna = (ctx as any).chatluna
    if (!chatluna?.platform?.registerTool) return
    return chatluna.platform.registerTool(name, tool) as () => void
  })
}

export function registerChatLunaTools(ctx: Context, enabledTools: ChatLunaToolName[]): void {
  const enabled = new Set(enabledTools)
  if (enabled.has('relifeluna_list_presets')) {
    registerTool(ctx, 'relifeluna_list_presets', 'List RelifeLuna identity presets', () => new ListPresetsTool(ctx), undefined, ['preset'])
  }
  if (enabled.has('relifeluna_get_profile')) {
    registerTool(ctx, 'relifeluna_get_profile', 'Get the current bot profile', () => new GetProfileTool(ctx), undefined, ['profile'])
  }
  if (enabled.has('relifeluna_create_preset')) {
    registerTool(ctx, 'relifeluna_create_preset', 'Create a RelifeLuna identity preset', () => new CreatePresetTool(ctx), writeAuthorization, ['preset', 'write'])
  }
  if (enabled.has('relifeluna_update_preset')) {
    registerTool(ctx, 'relifeluna_update_preset', 'Update a RelifeLuna identity preset', () => new UpdatePresetTool(ctx), writeAuthorization, ['preset', 'write'])
  }
  if (enabled.has('relifeluna_delete_preset')) {
    registerTool(ctx, 'relifeluna_delete_preset', 'Delete a RelifeLuna identity preset', () => new DeletePresetTool(ctx), writeAuthorization, ['preset', 'write'])
  }
  if (enabled.has('relifeluna_apply_preset')) {
    registerTool(ctx, 'relifeluna_apply_preset', 'Switch the current bot to a RelifeLuna identity preset', () => new ApplyPresetTool(ctx), writeAuthorization, ['preset', 'write'])
  }
  if (enabled.has('relifeluna_set_group_card')) {
    registerTool(ctx, 'relifeluna_set_group_card', 'Set only the current group card of the bot', () => new SetGroupCardTool(ctx), writeAuthorization, ['profile', 'write'])
  }
}
