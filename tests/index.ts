import { Context } from 'koishi'
import Database from '@koishijs/plugin-database-memory'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHATLUNA_TOOLS, Config, renderGreeting } from '../src'
import { RelifeLunaService } from '../src/service'
import { applyBotProfile, decodeAvatarDataUrl, getBotProfile, setBotGroupCard, validateAvatarBuffer } from '../src/protocols'
import assert from 'assert'

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function createOnebotBot() {
  const calls: Record<string, any[]> = {}
  const bot: any = {
    platform: 'onebot',
    selfId: '10001',
    user: { name: '旧昵称', avatar: 'http://old-avatar' },
    internal: {
      async setQqAvatar(file: string) {
        calls.setQqAvatar = [file]
      },
      async setQqProfile(...args: any[]) {
        calls.setQqProfile = args
      },
      async setGroupCard(groupId: string, userId: string, card: string) {
        calls.setGroupCard = [groupId, userId, card]
      },
      async getLoginInfo() {
        return { nickname: '旧昵称' }
      },
    },
    async getLogin() {
      calls.getLogin = []
    },
  }
  return { bot, calls }
}

function createMilkyBot() {
  const calls: Record<string, any[]> = {}
  const bot: any = {
    platform: 'milky',
    selfId: '20002',
    user: { name: '旧昵称', avatar: 'http://old-avatar' },
    internal: {
      async setAvatar(uri: string) {
        calls.setAvatar = [uri]
      },
      async setNickname(nickname: string) {
        calls.setNickname = [nickname]
      },
      async setBio(bio: string) {
        calls.setBio = [bio]
      },
      async setGroupMemberCard(groupId: number, userId: number, card: string) {
        calls.setGroupMemberCard = [groupId, userId, card]
      },
      async getLoginInfo() {
        return { uin: 20002, nickname: '旧昵称' }
      },
      async getUserProfile(userId: number) {
        return { bio: `bio-of-${userId}` }
      },
    },
    async getLogin() {
      calls.getLogin = []
    },
  }
  return { bot, calls }
}

let index = 0
function check(name: string, fn: () => Promise<void> | void): void {
  const current = ++index
  void Promise.resolve(fn()).then(() => {
    console.log(`ok ${current} - ${name}`)
  }, (error) => {
    console.error(`not ok ${current} - ${name}`)
    console.error(error)
    process.exitCode = 1
  })
}

check('avatar: validate magic bytes', () => {
  const buffer = Buffer.from(PNG_1PX, 'base64')
  validateAvatarBuffer(buffer)
  assert.throws(() => validateAvatarBuffer(Buffer.from('not an image')), /JPEG、PNG、GIF 或 WebP/)
  assert.throws(() => validateAvatarBuffer(Buffer.alloc(5 * 1024 * 1024, 0x89, 'binary').subarray(0, 5 * 1024 * 1024)), /过大/)
})

check('avatar: data URL decode', async () => {
  const dataUrl = `data:image/png;base64,${PNG_1PX}`
  const buffer = await decodeAvatarDataUrl(dataUrl)
  assert.equal(buffer.length > 0, true)
  await assert.rejects(() => decodeAvatarDataUrl('data:text/plain;base64,AAAA'), /JPEG、PNG、GIF 或 WebP/)
  await assert.rejects(() => decodeAvatarDataUrl(`data:image/png;base64,${'A'.repeat(9 * 1024 * 1024)}`), /过大/)
})

check('config: greeting defaults and template rendering', () => {
  assert.deepEqual(Config({}), { sendGreeting: true, chatlunaTools: CHATLUNA_TOOLS })
  assert.deepEqual(Config({ chatlunaTools: [] }), { sendGreeting: true, chatlunaTools: [] })
  assert.equal(renderGreeting('我是%s，{name}向你问好', '奏'), '我是奏，奏向你问好')
  assert.equal(renderGreeting(
    '{{oldNickname}} -> {{newNickname}}；{bio}；{groupNick}；{platform}:{selfId}',
    {
      name: '奏',
      nickname: '奏',
      newName: '奏',
      newNickname: '奏',
      oldName: '露娜',
      oldNickname: '露娜',
      bio: '新个签',
      groupNick: '群里的奏',
      platform: 'onebot',
      selfId: '10001',
    },
  ), '露娜 -> 奏；新个签；群里的奏；onebot:10001')
})

check('service: preset CRUD', async () => {
  const ctx = new Context()
  const baseDir = await mkdtemp(join(tmpdir(), 'relifeluna-test-'))
  ctx.baseDir = baseDir
  ctx.plugin(Database)
  ctx.plugin(RelifeLunaService)
  await ctx.start()
  const service = ctx.relifeluna

  const created = await service.createPreset({
    name: '奏',
    avatar: `base64://${PNG_1PX}`,
    bio: '要创作出令人幸福的歌曲',
    greeting: '我是%s，你好',
    groupNick: '群里的小奏',
  })
  assert.equal(created.revision, 1)
  assert.equal(created.enabled, true)
  assert.equal(created.groupNick, '群里的小奏')
  assert.match(created.avatar, /^file:/)
  assert.equal((await readFile(new URL(created.avatar))).length > 0, true)

  const listed = await service.listPresets()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].name, '奏')

  await assert.rejects(() => service.createPreset({ name: '奏' }), /已存在/)

  const updated = await service.updatePreset(created.id, { name: '奏', bio: '新个签' })
  assert.equal(updated.revision, 2)
  assert.equal(updated.bio, '新个签')

  const partial = await service.updatePreset(created.id, { name: '奏', enabled: false })
  assert.equal(partial.bio, '新个签')
  assert.equal(partial.greeting, '我是%s，你好')
  assert.equal(partial.groupNick, '群里的小奏')
  assert.equal(partial.enabled, false)

  await assert.rejects(() => service.updatePreset(created.id, { name: '奏', bio: '冲突' }, 1), /其他管理员修改/)

  const found = await service.findPreset('奏')
  assert.ok(found)
  assert.equal(found.bio, '新个签')

  await service.removePreset(created.id)
  assert.equal((await service.listPresets()).length, 0)
  await ctx.stop()
  await rm(baseDir, { recursive: true, force: true })
})

check('protocol: onebot apply', async () => {
  const ctx = new Context()
  const { bot, calls } = createOnebotBot()
  const result = await applyBotProfile(ctx, bot, {
    name: '奏',
    avatar: `base64://${PNG_1PX}`,
    bio: '新个签',
    groupNick: '群名片',
  }, { groupId: '123456' })
  assert.equal(result.ok, true)
  assert.equal(result.applied.avatar, true)
  assert.equal(result.applied.nickname, true)
  assert.equal(result.applied.bio, true)
  assert.equal(result.applied.groupNick, true)
  assert.ok(String(calls.setQqAvatar[0]).startsWith('base64://'))
  assert.deepEqual(calls.setQqProfile, ['奏', '', '', '', '新个签'])
  assert.deepEqual(calls.setGroupCard, ['123456', '10001', '群名片'])
  assert.equal(bot.user.name, '奏')
  assert.ok(calls.getLogin)
})

check('protocol: milky apply', async () => {
  const ctx = new Context()
  const { bot, calls } = createMilkyBot()
  const result = await applyBotProfile(ctx, bot, {
    name: '露娜',
    avatar: `base64://${PNG_1PX}`,
    bio: '月光如洗',
    groupNick: '群里的露娜',
  }, { groupId: '654321' })
  assert.equal(result.ok, true)
  assert.equal(calls.setNickname[0], '露娜')
  assert.equal(calls.setBio[0], '月光如洗')
  assert.ok(String(calls.setAvatar[0]).startsWith('base64://'))
  assert.deepEqual(calls.setGroupMemberCard, [654321, 20002, '群里的露娜'])
  assert.equal(bot.user.name, '露娜')
})

check('protocol: group nick skipped without group scope', async () => {
  const ctx = new Context()
  const { bot, calls } = createOnebotBot()
  const result = await applyBotProfile(ctx, bot, {
    name: '奏',
    groupNick: '群名片',
  })
  assert.equal(result.ok, true)
  assert.equal(result.applied.groupNick, undefined)
  assert.equal(calls.setGroupCard, undefined)
})

check('protocol: standalone onebot group card only changes group card', async () => {
  const { bot, calls } = createOnebotBot()
  const result = await setBotGroupCard(bot, '123456', '群里的小奏')
  assert.equal(result.groupNick, '群里的小奏')
  assert.deepEqual(calls.setGroupCard, ['123456', '10001', '群里的小奏'])
  assert.equal(calls.setQqProfile, undefined)
  assert.equal(calls.setQqAvatar, undefined)
})

check('protocol: standalone milky group card only changes group card', async () => {
  const { bot, calls } = createMilkyBot()
  await setBotGroupCard(bot, '654321', '群里的露娜')
  assert.deepEqual(calls.setGroupMemberCard, [654321, 20002, '群里的露娜'])
  assert.equal(calls.setNickname, undefined)
  assert.equal(calls.setAvatar, undefined)
  assert.equal(calls.setBio, undefined)
})

check('protocol: partial failure on group nick error', async () => {
  const ctx = new Context()
  const { bot } = createOnebotBot()
  bot.internal.setGroupCard = async () => {
    throw new Error('card rejected')
  }
  const result = await applyBotProfile(ctx, bot, {
    name: '奏',
    groupNick: '群名片',
  }, { groupId: '123456' })
  assert.equal(result.ok, false)
  assert.equal(result.applied.groupNick, false)
  assert.equal(result.errors.find(e => e.field === 'groupNick')?.message, 'card rejected')
})

check('protocol: milky profile read', async () => {
  const { bot } = createMilkyBot()
  const profile = await getBotProfile(bot)
  assert.equal(profile.nickname, '旧昵称')
  assert.equal(profile.bio, 'bio-of-20002')
  assert.equal(profile.bioReadable, true)
  assert.equal(profile.capabilities.bio, true)
})

check('protocol: partial failure on nickname error', async () => {
  const ctx = new Context()
  const { bot, calls } = createOnebotBot()
  bot.internal.setQqProfile = async () => {
    calls.setQqProfile = []
    throw new Error('nickname rejected')
  }
  const result = await applyBotProfile(ctx, bot, {
    name: '奏',
    avatar: `base64://${PNG_1PX}`,
    bio: '新个签',
  })
  assert.equal(result.ok, false)
  assert.equal(result.applied.avatar, true)
  assert.equal(result.applied.nickname, false)
  assert.equal(result.errors[0].field, 'nickname')
})

check('protocol: missing internal API reported clearly', async () => {
  const ctx = new Context()
  const bot: any = { platform: 'onebot', selfId: '10001', user: { name: '旧昵称' } }
  const result = await applyBotProfile(ctx, bot, { name: '奏', avatar: `base64://${PNG_1PX}` })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(e => e.field === 'avatar' && /internal API/.test(e.message)))
  assert.ok(result.errors.some(e => e.field === 'nickname' && /internal API/.test(e.message)))
})

check('protocol: invalid avatar source rejected', async () => {
  const ctx = new Context()
  const { bot } = createOnebotBot()
  const result = await applyBotProfile(ctx, bot, { name: '奏', avatar: 'ftp://example.com/a.png' })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(e => e.field === 'avatar' && /http\(s\):\/\/、file:\/\//.test(e.message)))
})

check('protocol: invalid group id rejected', async () => {
  const ctx = new Context()
  const { bot, calls } = createOnebotBot()
  const result = await applyBotProfile(ctx, bot, { name: '奏', groupNick: '群名片' }, { groupId: 'abc' })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(e => e.field === 'groupNick' && /无效/.test(e.message)))
  assert.equal(calls.setGroupCard, undefined)
})

check('protocol: standalone group card validates input', async () => {
  const { bot } = createOnebotBot()
  await assert.rejects(() => setBotGroupCard(bot, 'abc', '群名片'), /群号.*无效/)
  await assert.rejects(() => setBotGroupCard(bot, '123456', '  '), /不能为空/)
})

process.on('exit', () => {
  console.log('relifeluna tests done')
})
