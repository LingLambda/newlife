import { Bot, Context, Service } from 'koishi'
import { applyBotProfile, getBotProfile, isSupportedBot, persistAvatar, setBotGroupCard, type ApplyGroupScope, type ApplyResult, type GroupCardResult, type ProtocolProfile } from './protocols'

declare module 'koishi' {
  interface Context {
    relifeluna: RelifeLunaService
  }

  interface Tables {
    'relifeluna.preset': PresetRecord
  }

  interface Events {
    'relifeluna/preset-created'(preset: PresetView): void
    'relifeluna/preset-updated'(preset: PresetView): void
    'relifeluna/preset-deleted'(preset: PresetView): void
    'relifeluna/preset-applied'(result: ApplyResult): void
  }
}

const PRESET_TABLE = 'relifeluna.preset'
const MAX_NAME_LENGTH = 64
const MAX_TEXT_LENGTH = 512

export interface PresetRecord {
  id: number
  name: string
  avatar: string
  bio: string
  greeting: string
  groupNick: string
  enabled: boolean
  revision: number
  createdAt: Date
  updatedAt: Date
}

export interface PresetView {
  id: number
  name: string
  avatar: string
  bio: string
  greeting: string
  groupNick: string
  enabled: boolean
  revision: number
  createdAt: string
  updatedAt: string
}

export interface PresetInput {
  name: string
  avatar?: string
  bio?: string
  greeting?: string
  groupNick?: string
  enabled?: boolean
}

export interface PresetUpdateInput {
  name?: string
  avatar?: string
  bio?: string
  greeting?: string
  groupNick?: string
  enabled?: boolean
}

function requirePresetId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('预设 ID 无效')
}

function normalizePresetInput(input: PresetInput): Required<Omit<PresetInput, 'name'>> & { name: string } {
  const name = input.name?.trim()
  if (!name) throw new Error('昵称不能为空')
  if (name.length > MAX_NAME_LENGTH) throw new Error(`昵称过长（上限 ${MAX_NAME_LENGTH} 字符）`)
  return {
    name,
    avatar: input.avatar?.trim() ?? '',
    bio: (input.bio?.trim() ?? '').slice(0, MAX_TEXT_LENGTH),
    greeting: (input.greeting?.trim() ?? '').slice(0, MAX_TEXT_LENGTH),
    groupNick: (input.groupNick?.trim() ?? '').slice(0, MAX_TEXT_LENGTH),
    enabled: input.enabled ?? true,
  }
}

function toView(record: PresetRecord): PresetView {
  return {
    id: record.id,
    name: record.name,
    avatar: record.avatar,
    bio: record.bio,
    greeting: record.greeting,
    groupNick: record.groupNick ?? '',
    enabled: record.enabled,
    revision: record.revision,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function uniqueError(error: unknown, name: string): Error {
  if (error instanceof Error && /unique|constraint|duplicate/i.test(error.message)) {
    return new Error(`已存在昵称为「${name}」的预设`)
  }
  return error instanceof Error ? error : new Error(String(error))
}

export class RelifeLunaService extends Service {
  static inject = ['database']

  constructor(ctx: Context) {
    super(ctx, 'relifeluna')
    this.defineTables()
  }

  private defineTables() {
    this.ctx.database.extend(PRESET_TABLE, {
      id: 'unsigned',
      name: 'string',
      avatar: 'string',
      bio: 'string',
      greeting: 'string',
      groupNick: 'string',
      enabled: {
        type: 'boolean',
        initial: true,
      },
      revision: {
        type: 'unsigned',
        initial: 1,
      },
      createdAt: {
        type: 'timestamp',
        nullable: false,
        initial: new Date(),
      },
      updatedAt: {
        type: 'timestamp',
        nullable: false,
        initial: new Date(),
      },
    }, {
      autoInc: true,
      primary: 'id',
      unique: ['name'],
    })
  }

  async listPresets(enabledOnly = false): Promise<PresetView[]> {
    const records = await this.ctx.database.get(PRESET_TABLE, enabledOnly ? { enabled: true } : {})
    return records
      .sort((left, right) => left.id - right.id)
      .map(toView)
  }

  async getPreset(id: number): Promise<PresetView> {
    requirePresetId(id)
    const [record] = await this.ctx.database.get(PRESET_TABLE, id)
    if (!record) throw new Error('预设不存在')
    return toView(record)
  }

  async findPreset(name: string): Promise<PresetView | undefined> {
    const normalized = name?.trim()
    if (!normalized) return undefined
    const [record] = await this.ctx.database.get(PRESET_TABLE, { name: normalized })
    return record ? toView(record) : undefined
  }

  async createPreset(input: PresetInput): Promise<PresetView> {
    const normalized = normalizePresetInput(input)
    const [existing] = await this.ctx.database.get(PRESET_TABLE, { name: normalized.name })
    if (existing) throw new Error(`已存在昵称为「${normalized.name}」的预设`)
    normalized.avatar = await persistAvatar(this.ctx, normalized.avatar)
    try {
      const record = await this.ctx.database.create(PRESET_TABLE, {
        ...normalized,
        revision: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const view = toView(record)
      this.ctx.emit('relifeluna/preset-created', view)
      return view
    } catch (error) {
      throw uniqueError(error, normalized.name)
    }
  }

  async updatePreset(id: number, input: PresetUpdateInput, revision?: number): Promise<PresetView> {
    requirePresetId(id)
    const [current] = await this.ctx.database.get(PRESET_TABLE, id)
    if (!current) throw new Error('预设不存在')
    const normalized = normalizePresetInput({
      name: input.name ?? current.name,
      avatar: input.avatar ?? current.avatar,
      bio: input.bio ?? current.bio,
      greeting: input.greeting ?? current.greeting,
      groupNick: input.groupNick ?? current.groupNick ?? '',
      enabled: input.enabled ?? current.enabled,
    })
    const duplicates = await this.ctx.database.get(PRESET_TABLE, { name: normalized.name })
    if (duplicates.some(record => record.id !== id)) {
      throw new Error(`已存在昵称为「${normalized.name}」的预设`)
    }
    normalized.avatar = await persistAvatar(this.ctx, normalized.avatar)

    const targetRevision = revision ?? current.revision
    if (!Number.isSafeInteger(targetRevision) || targetRevision < 1) throw new Error('修订版本无效')

    const updatedAt = new Date()
    const result = await this.ctx.database.set(PRESET_TABLE, { id, revision: targetRevision }, {
      ...normalized,
      revision: targetRevision + 1,
      updatedAt,
    })
    if (result.matched === 0) throw new Error('预设已被其他管理员修改，请重新载入后再保存')

    const view = toView({ ...current, ...normalized, revision: targetRevision + 1, updatedAt })
    this.ctx.emit('relifeluna/preset-updated', view)
    return view
  }

  async removePreset(id: number): Promise<void> {
    requirePresetId(id)
    const [record] = await this.ctx.database.get(PRESET_TABLE, id)
    if (!record) throw new Error('预设不存在')
    const result = await this.ctx.database.remove(PRESET_TABLE, id)
    if (result.removed === 0) throw new Error('预设不存在')
    this.ctx.emit('relifeluna/preset-deleted', toView(record))
  }

  async getBotProfile(platform: string, selfId: string): Promise<ProtocolProfile> {
    return getBotProfile(this.resolveBot(platform, selfId))
  }

  async applyPreset(preset: Pick<PresetView, 'name' | 'avatar' | 'bio'>, platform: string, selfId: string): Promise<ApplyResult> {
    const bot = this.resolveBot(platform, selfId)
    const result = await applyBotProfile(this.ctx, bot, preset)
    this.ctx.emit('relifeluna/preset-applied', result)
    return result
  }

  async applyPresetToBot(preset: Pick<PresetView, 'name' | 'avatar' | 'bio' | 'groupNick'>, bot: Bot, group?: ApplyGroupScope): Promise<ApplyResult> {
    if (!isSupportedBot(bot)) throw new Error(`平台「${bot.platform}」暂不支持身份切换`)
    const result = await applyBotProfile(this.ctx, bot, preset, group)
    this.ctx.emit('relifeluna/preset-applied', result)
    return result
  }

  async setGroupCard(bot: Bot, groupId: string, groupNick: string): Promise<GroupCardResult> {
    if (!isSupportedBot(bot)) throw new Error(`平台「${bot.platform}」暂不支持设置群名片`)
    return setBotGroupCard(bot, groupId, groupNick)
  }

  private resolveBot(platform: string, selfId: string): Bot {
    const bot = this.ctx.bots.find(bot => bot.platform === platform && bot.selfId === selfId)
    if (!bot) throw new Error('机器人不存在或不在线')
    if (!isSupportedBot(bot)) throw new Error(`平台「${platform}」暂不支持身份切换`)
    return bot
  }
}
