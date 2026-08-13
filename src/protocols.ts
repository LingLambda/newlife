import { Bot, Context, Session } from 'koishi'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type SupportedPlatform = 'onebot' | 'milky'

export interface ProfileCapabilities {
  avatar: boolean
  nickname: boolean
  bio: boolean
  groupCard: boolean
}

export interface ProtocolProfile {
  platform: string
  selfId: string
  nickname?: string
  avatar?: string
  bio?: string
  bioReadable: boolean
  capabilities: ProfileCapabilities
}

export interface ApplyError {
  field: 'avatar' | 'nickname' | 'bio' | 'groupNick'
  message: string
}

export interface ApplyResult {
  platform: string
  selfId: string
  preset: string
  ok: boolean
  applied: {
    avatar?: boolean
    nickname?: boolean
    bio?: boolean
    groupNick?: boolean
  }
  errors: ApplyError[]
}

export interface ApplyGroupScope {
  groupId: string
}

export interface GroupCardResult {
  platform: string
  selfId: string
  groupId: string
  groupNick: string
}

export interface PresetFields {
  name: string
  avatar?: string
  bio?: string
  groupNick?: string
}

interface OneBotInternal {
  setQqAvatar(file: string): Promise<unknown>
  setQqProfile(nickname: string, company: string, email: string, college: string, personalNote: string): Promise<unknown>
  setGroupCard(groupId: string | number, userId: string | number, card: string): Promise<unknown>
  getLoginInfo(): Promise<{ nickname: string }>
}

interface MilkyInternal {
  setAvatar(uri: string): Promise<unknown>
  setNickname(nickname: string): Promise<unknown>
  setBio(bio: string): Promise<unknown>
  setGroupMemberCard(groupId: number, userId: number, card: string): Promise<unknown>
  getLoginInfo(): Promise<{ uin: number | string; nickname: string }>
  getUserProfile(userId: number): Promise<{ bio?: string }>
}

const SUPPORTED_PLATFORMS: ReadonlySet<string> = new Set(['onebot', 'milky'])

const MAX_AVATAR_BYTES = 4 * 1024 * 1024
export const AVATAR_ROUTE = '/relifeluna/avatar/'

export function getAvatarRoot(ctx: Context): string {
  return resolve(ctx.baseDir, 'data/relifeluna/avatars')
}

export function isSupportedBot(bot: Pick<Bot, 'platform'>): boolean {
  return SUPPORTED_PLATFORMS.has(bot.platform)
}

export function getCapabilities(platform: string): ProfileCapabilities {
  if (platform === 'onebot' || platform === 'milky') {
    return { avatar: true, nickname: true, bio: true, groupCard: true }
  }
  return { avatar: false, nickname: false, bio: false, groupCard: false }
}

export function getSessionGroupId(session: Pick<Session, 'isDirect' | 'guildId' | 'channelId'>): string | undefined {
  if (session.isDirect) return undefined
  if (session.guildId && /^\d+$/.test(session.guildId)) return session.guildId
  const capture = /^group:(\d+)$/.exec(session.channelId ?? '')
  return capture?.[1]
}

export function isAvatarData(source: string): boolean {
  return source.startsWith('data:image/')
}

export function sniffAvatarType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (buffer.length >= 6) {
    const head = buffer.toString('ascii', 0, 6)
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

export function validateAvatarBuffer(buffer: Buffer): void {
  if (!buffer.length) throw new Error('头像数据为空')
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw new Error(`头像文件过大（${(buffer.length / 1048576).toFixed(1)}MB，上限 4MB）`)
  }
  if (!sniffAvatarType(buffer)) throw new Error('头像必须为 JPEG、PNG、GIF 或 WebP 图片')
}

const MAX_AVATAR_DATA_URL_LENGTH = 8 * 1024 * 1024

export async function decodeAvatarDataUrl(source: string): Promise<Buffer> {
  if (typeof source !== 'string' || source.length > MAX_AVATAR_DATA_URL_LENGTH) {
    throw new Error('头像上传数据过大')
  }
  const capture = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.*)$/.exec(source)
  if (!capture) throw new Error('头像必须为 JPEG、PNG、GIF 或 WebP 图片')
  const buffer = Buffer.from(capture[2], 'base64')
  validateAvatarBuffer(buffer)
  return buffer
}

function managedAvatarPath(ctx: Context, source: string): string | undefined {
  if (!source.startsWith('file://')) return undefined
  try {
    const filePath = resolve(fileURLToPath(source))
    return dirname(filePath) === getAvatarRoot(ctx) ? filePath : undefined
  } catch {
    return undefined
  }
}

export function getAvatarPreviewUrl(ctx: Context, source: string): string | undefined {
  const filePath = managedAvatarPath(ctx, source)
  return filePath ? `${AVATAR_ROUTE}${encodeURIComponent(basename(filePath))}` : undefined
}

async function readAvatarBuffer(ctx: Context, source: string): Promise<Buffer> {
  const target = source.trim()
  if (!target) throw new Error('头像地址为空')
  if (target.startsWith('base64://')) {
    return Buffer.from(target.slice('base64://'.length), 'base64')
  }
  if (target.startsWith('data:')) return decodeAvatarDataUrl(target)
  if (target.startsWith('file://')) {
    try {
      return await readFile(fileURLToPath(target))
    } catch (error) {
      throw new Error(`无法读取本地头像文件：${formatError(error)}`)
    }
  }
  if (/^https?:\/\//i.test(target)) {
    try {
      const file = await ctx.http.file(target)
      return Buffer.from(file.data)
    } catch (error) {
      throw new Error(`无法获取头像资源：${formatError(error)}`)
    }
  }
  throw new Error('头像地址必须为 http(s)://、file://、base64:// 或 data: 格式')
}

export async function persistAvatar(ctx: Context, source: string): Promise<string> {
  const target = source.trim()
  if (!target) return ''
  const managedPath = managedAvatarPath(ctx, target)
  if (managedPath) {
    validateAvatarBuffer(await readFile(managedPath))
    return target
  }

  const buffer = await readAvatarBuffer(ctx, target)
  validateAvatarBuffer(buffer)
  const extension = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
  }[sniffAvatarType(buffer) ?? 'image/png']
  const avatarRoot = getAvatarRoot(ctx)
  await mkdir(avatarRoot, { recursive: true })
  const filePath = resolve(avatarRoot, `avatar-${Date.now()}-${randomUUID()}${extension}`)
  await writeFile(filePath, buffer, { flag: 'wx' })
  return pathToFileURL(filePath).href
}

export async function normalizeAvatar(ctx: Context, source: string): Promise<string> {
  const buffer = await readAvatarBuffer(ctx, source)
  validateAvatarBuffer(buffer)
  return 'base64://' + buffer.toString('base64')
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getInternal(bot: Bot): OneBotInternal | MilkyInternal | undefined {
  const internal = (bot as any).internal
  return internal && typeof internal === 'object' ? internal : undefined
}

function requireInternalMethod(bot: Bot, method: string): Error | undefined {
  if (!isSupportedBot(bot)) return new Error(`平台「${bot.platform}」暂不支持身份切换`)
  if (!getInternal(bot)) return new Error(`平台「${bot.platform}」适配器未暴露 internal API`)
  if (typeof (getInternal(bot) as any)[method] !== 'function') {
    return new Error(`平台「${bot.platform}」适配器缺少 ${method} 接口，请更新适配器`)
  }
}

function requireGroupCardInternal(bot: Bot): Error | undefined {
  const method = bot.platform === 'milky' ? 'setGroupMemberCard' : 'setGroupCard'
  return requireInternalMethod(bot, method)
}

function toNumericId(source: string): number | undefined {
  const value = Number(source)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export async function setBotGroupCard(bot: Bot, groupId: string, groupNick: string): Promise<GroupCardResult> {
  const normalizedGroupId = groupId.trim()
  const normalizedGroupNick = groupNick.trim()
  if (!normalizedGroupId || toNumericId(normalizedGroupId) === undefined) {
    throw new Error(`群号「${groupId}」无效`)
  }
  if (!normalizedGroupNick) throw new Error('群名片不能为空')
  if (normalizedGroupNick.length > 512) throw new Error('群名片过长（上限 512 字符）')

  const missing = requireGroupCardInternal(bot)
  if (missing) throw missing
  const internal = getInternal(bot)!
  if (bot.platform === 'milky') {
    const selfId = toNumericId(bot.selfId)
    if (!selfId) throw new Error(`机器人 ID「${bot.selfId}」无效`)
    await (internal as MilkyInternal).setGroupMemberCard(+normalizedGroupId, selfId, normalizedGroupNick)
  } else {
    await (internal as OneBotInternal).setGroupCard(normalizedGroupId, bot.selfId, normalizedGroupNick)
  }
  return {
    platform: bot.platform,
    selfId: bot.selfId,
    groupId: normalizedGroupId,
    groupNick: normalizedGroupNick,
  }
}

export async function getBotProfile(bot: Bot): Promise<ProtocolProfile> {
  const base: ProtocolProfile = {
    platform: bot.platform,
    selfId: bot.selfId,
    bioReadable: bot.platform === 'milky',
    capabilities: getCapabilities(bot.platform),
  }
  if (bot.platform === 'milky') {
    const internal = getInternal(bot) as MilkyInternal | undefined
    if (!internal) return base
    const login = await internal.getLoginInfo()
    const uid = toNumericId(bot.selfId)
    const profile = uid ? await internal.getUserProfile(uid).catch(() => null) : null
    return {
      ...base,
      nickname: login.nickname,
      avatar: bot.user?.avatar || `https://q.qlogo.cn/headimg_dl?dst_uin=${bot.selfId}&spec=640`,
      bio: profile?.bio ?? '',
    }
  }
  if (bot.platform === 'onebot') {
    const internal = getInternal(bot) as OneBotInternal | undefined
    if (!internal) return base
    const login = await internal.getLoginInfo()
    return {
      ...base,
      nickname: login.nickname,
      avatar: bot.user?.avatar,
    }
  }
  return base
}

export async function applyBotProfile(ctx: Context, bot: Bot, preset: PresetFields, group?: ApplyGroupScope): Promise<ApplyResult> {
  const result: ApplyResult = {
    platform: bot.platform,
    selfId: bot.selfId,
    preset: preset.name,
    ok: true,
    applied: {},
    errors: [],
  }
  const fail = (field: ApplyError['field'], error: unknown) => {
    result.ok = false
    result.applied[field] = false
    result.errors.push({ field, message: formatError(error) })
  }
  const internal = getInternal(bot)

  const avatar = preset.avatar?.trim()
  if (avatar) {
    const missing = requireInternalMethod(bot, bot.platform === 'milky' ? 'setAvatar' : 'setQqAvatar')
    if (missing) {
      fail('avatar', missing)
    } else {
      try {
        const file = await normalizeAvatar(ctx, avatar)
        if (bot.platform === 'milky') {
          await (internal as MilkyInternal).setAvatar(file)
        } else {
          await (internal as OneBotInternal).setQqAvatar(file)
        }
        result.applied.avatar = true
      } catch (error) {
        fail('avatar', error)
      }
    }
  }

  const nickname = preset.name?.trim()
  if (nickname) {
    const missing = requireInternalMethod(bot, bot.platform === 'milky' ? 'setNickname' : 'setQqProfile')
    if (missing) {
      fail('nickname', missing)
    } else {
      try {
        if (bot.platform === 'milky') {
          await (internal as MilkyInternal).setNickname(nickname)
        } else {
          const note = preset.bio?.trim() ?? ''
          await (internal as OneBotInternal).setQqProfile(nickname, '', '', '', note)
        }
        result.applied.nickname = true
        bot.user.name = nickname
      } catch (error) {
        fail('nickname', error)
      }
    }
  }

  const bio = preset.bio?.trim()
  if (bio) {
    if (bot.platform === 'milky') {
      const missing = requireInternalMethod(bot, 'setBio')
      if (missing) {
        fail('bio', missing)
      } else {
        try {
          await (internal as MilkyInternal).setBio(bio)
          result.applied.bio = true
        } catch (error) {
          fail('bio', error)
        }
      }
    } else if (bot.platform === 'onebot' && result.applied.nickname) {
      result.applied.bio = true
    }
  }

  const groupNick = preset.groupNick?.trim()
  if (groupNick && group) {
    try {
      await setBotGroupCard(bot, group.groupId, groupNick)
      result.applied.groupNick = true
    } catch (error) {
      fail('groupNick', error)
    }
  }

  if (result.ok) {
    await (bot as any).getLogin?.().catch(() => {})
  }
  return result
}
