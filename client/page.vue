<template>
  <k-layout>
    <template #header>RelifeLuna 身份管理</template>

    <k-content class="relifeluna-page">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="预设管理" name="presets">
          <section class="toolbar">
            <el-button type="primary" @click="openCreate">新建预设</el-button>
            <el-button :loading="loadingPresets" @click="loadPresets">刷新</el-button>
            <span v-if="presets.length" class="hint">共 {{ presets.length }} 个预设，昵称即预设名</span>
          </section>

          <k-card v-loading="loadingPresets">
            <el-table
              class="desktop-table"
              :data="presets"
              empty-text="暂无身份预设"
            >
              <el-table-column label="头像" width="72">
                <template #default="{ row }">
                  <el-avatar :size="40" :src="avatarPreview(row)">
                    {{ row.name?.slice(0, 1) }}
                  </el-avatar>
                </template>
              </el-table-column>
              <el-table-column label="昵称" min-width="130">
                <template #default="{ row }"><strong>{{ row.name }}</strong></template>
              </el-table-column>
              <el-table-column label="个签" min-width="160" show-overflow-tooltip>
                <template #default="{ row }">{{ row.bio || '—' }}</template>
              </el-table-column>
              <el-table-column label="群昵称" min-width="120" show-overflow-tooltip>
                <template #default="{ row }">{{ row.groupNick || '—' }}</template>
              </el-table-column>
              <el-table-column label="寒暄" min-width="160" show-overflow-tooltip>
                <template #default="{ row }">{{ row.greeting || '—' }}</template>
              </el-table-column>
              <el-table-column label="启用" width="80">
                <template #default="{ row }">
                  <el-switch
                    :model-value="row.enabled"
                    :loading="togglingIds.has(row.id)"
                    @change="togglePreset(row, $event)"
                  />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
                  <el-button link type="danger" @click="removePreset(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>

            <div class="mobile-cards">
              <article v-for="preset in presets" :key="preset.id" class="preset-card">
                <header>
                  <el-avatar :size="44" :src="avatarPreview(preset)">{{ preset.name?.slice(0, 1) }}</el-avatar>
                  <div class="card-title">
                    <strong>{{ preset.name }}</strong>
                    <span class="sub">{{ preset.bio || '无个签' }}</span>
                  </div>
                  <el-switch
                    :model-value="preset.enabled"
                    :loading="togglingIds.has(preset.id)"
                    @change="togglePreset(preset, $event)"
                  />
                </header>
                <footer>
                  <el-button link type="primary" @click="openEdit(preset)">编辑</el-button>
                  <el-button link type="danger" @click="removePreset(preset)">删除</el-button>
                </footer>
              </article>
              <el-empty v-if="!presets.length" description="暂无身份预设" />
            </div>
          </k-card>
        </el-tab-pane>

        <el-tab-pane label="应用" name="apply">
          <div class="apply-grid">
            <k-card class="apply-card">
              <template #header>切换身份</template>
              <el-form label-position="top" @submit.prevent>
                <el-form-item label="机器人">
                  <el-select v-model="applyTarget" filterable placeholder="选择在线机器人">
                    <el-option
                      v-for="bot in supportedBots"
                      :key="`${bot.platform}:${bot.selfId}`"
                      :label="`${bot.platform}:${bot.selfId}（${bot.name || '未知'}）`"
                      :value="`${bot.platform}:${bot.selfId}`"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="预设">
                  <el-select v-model="applyPresetName" filterable placeholder="选择身份预设">
                    <el-option
                      v-for="preset in enabledPresets"
                      :key="preset.id"
                      :label="preset.name"
                      :value="preset.name"
                    />
                  </el-select>
                </el-form-item>
                <el-button
                  type="primary"
                  :loading="applying"
                  :disabled="!applyTarget || !applyPresetName"
                  @click="applyPreset"
                >
                  立即应用
                </el-button>
              </el-form>
              <el-alert
                v-if="!supportedBots.length"
                class="apply-hint"
                type="info"
                :closable="false"
                title="当前没有在线的 OneBot / Milky 机器人"
              />
              <el-alert
                v-else-if="!enabledPresets.length"
                class="apply-hint"
                type="info"
                :closable="false"
                title="当前没有启用的身份预设，请先在「预设管理」中创建"
              />
            </k-card>

            <k-card class="apply-card">
              <template #header>
                <div class="profile-heading">
                  <span>当前资料</span>
                  <el-button link type="primary" :loading="loadingProfile" :disabled="!profileTarget" @click="loadProfile">刷新</el-button>
                </div>
              </template>
              <div v-if="!profileTarget" class="placeholder">选择机器人后查看当前资料</div>
              <div v-else-if="profileError" class="placeholder error">{{ profileError }}</div>
              <div v-else v-loading="loadingProfile" class="profile">
                <el-avatar :size="64" :src="profile.avatar || undefined">{{ profile.nickname?.slice(0, 1) }}</el-avatar>
                <dl>
                  <dt>昵称</dt><dd>{{ profile.nickname || '—' }}</dd>
                  <dt>个签</dt><dd>{{ profile.bioReadable ? (profile.bio || '—') : '该平台不支持读取' }}</dd>
                  <dt>能力</dt>
                  <dd>
                    头像 {{ profile.capabilities?.avatar ? '支持' : '不支持' }}
                    · 昵称 {{ profile.capabilities?.nickname ? '支持' : '不支持' }}
                    · 个签 {{ profile.capabilities?.bio ? '支持' : '不支持' }}
                    · 群名片 {{ profile.capabilities?.groupCard ? '支持' : '不支持' }}
                  </dd>
                </dl>
              </div>
            </k-card>
          </div>

          <el-alert
            v-if="applyResult"
            class="apply-result"
            :type="applyResult.ok ? 'success' : 'warning'"
            :closable="false"
          >
            <template #title>
              {{ applyResult.ok ? `已应用预设「${applyResult.preset}」${appliedSummary}` : '部分更新失败' }}
            </template>
            <div v-if="!applyResult.ok" class="error-list">
              <div v-for="(error, index) in applyResult.errors" :key="index">
                {{ error.field }}：{{ error.message }}
              </div>
            </div>
          </el-alert>
        </el-tab-pane>

        <el-tab-pane label="设置" name="settings">
          <k-card>
            <template #header>切换行为</template>
            <div class="settings-section switch-row">
              <div>
                <strong>切换后发送寒暄</strong>
                <span>通过 relife 命令切换身份后，发送预设中的寒暄模板。</span>
              </div>
              <el-switch v-model="settings.sendGreeting" />
            </div>
            <div class="settings-section tools-section">
              <div class="section-heading">
                <strong>ChatLuna 工具注册</strong>
                <span>只向 ChatLuna 注册选中的工具。管理类工具仍要求 authority 4。</span>
              </div>
              <el-checkbox-group v-model="settings.chatlunaTools" class="tool-list">
                <el-checkbox v-for="tool in chatlunaToolOptions" :key="tool.name" :label="tool.name">
                  <span class="tool-option">
                    <code>{{ tool.name }}</code>
                    <small>{{ tool.description }}</small>
                  </span>
                </el-checkbox>
              </el-checkbox-group>
            </div>
            <div class="settings-actions">
              <span>保存后 RelifeLuna 将使用 Koishi 原生重载应用新配置。</span>
              <el-button type="primary" :loading="savingSettings" :disabled="!configEntry" @click="saveSettings">
                保存并重载
              </el-button>
            </div>
          </k-card>
        </el-tab-pane>
      </el-tabs>
    </k-content>
  </k-layout>

  <el-dialog
    v-model="showEditor"
    :title="editingId ? '编辑身份预设' : '新建身份预设'"
    width="min(620px, calc(100vw - 32px))"
    destroy-on-close
  >
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="昵称（即预设名，必填）" required>
        <el-input v-model="editor.name" maxlength="64" show-word-limit placeholder="例如：奏" />
      </el-form-item>
      <el-form-item label="头像">
        <div class="avatar-row">
          <el-avatar :size="56" :src="editorAvatarPreview || avatarUrl(editor.avatar)">{{ editor.name?.slice(0, 1) || '?' }}</el-avatar>
          <el-input v-model="editor.avatar" placeholder="http(s)://、file://、base64:// 或 data: 图片地址" />
        </div>
        <div class="upload-row">
          <input
            ref="fileInput"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            class="hidden-input"
            @change="uploadAvatar"
          />
          <el-button :loading="uploading" @click="pickFile">上传本地头像</el-button>
          <span class="hint">JPEG/PNG/GIF/WebP，不超过 4MB；上传后持久化保存到 Koishi data 目录</span>
        </div>
      </el-form-item>
      <el-form-item label="个签">
        <el-input v-model="editor.bio" type="textarea" :rows="2" maxlength="512" show-word-limit placeholder="QQ 个性签名（OneBot 平台随昵称一起提交）" />
      </el-form-item>
      <el-form-item label="群昵称（群名片）">
        <el-input v-model="editor.groupNick" maxlength="512" show-word-limit placeholder="可选，在群聊中切换预设时应用到当前群" />
        <div class="form-hint">想单独设置群名片时，请在目标群使用 <code>relife.card &lt;群名片&gt;</code>。</div>
      </el-form-item>
      <el-form-item label="寒暄模板">
        <el-input v-model="editor.greeting" type="textarea" :rows="2" maxlength="512" show-word-limit placeholder="例如：我是 {{newNickname}}，请多关照" />
        <div class="variable-list">
          <span v-for="variable in greetingVariables" :key="variable.name">
            <code>{{ variable.name }}</code>{{ variable.description }}
          </span>
        </div>
        <div class="form-hint">同时兼容旧模板中的 <code>%s</code>、<code>{name}</code> 和双花括号变量写法。</div>
      </el-form-item>
      <el-form-item label="启用">
        <el-switch v-model="editor.enabled" active-text="启用" inactive-text="停用" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showEditor = false">取消</el-button>
      <el-button type="primary" :loading="savingPreset" @click="savePreset">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type {} from '@koishijs/plugin-config'
import { message, messageBox, send, store } from '@koishijs/client'
import { computed, onMounted, ref, watch } from 'vue'

interface PresetView {
  id: number
  name: string
  avatar: string
  avatarPreview?: string
  bio: string
  greeting: string
  groupNick: string
  enabled: boolean
  revision: number
  createdAt: string
  updatedAt: string
}

interface BotView {
  platform: string
  selfId: string
  name: string
  avatar?: string
  status: string
  supported: boolean
}

interface ProfileView {
  platform: string
  selfId: string
  nickname?: string
  avatar?: string
  bio?: string
  bioReadable: boolean
  capabilities: { avatar: boolean; nickname: boolean; bio: boolean; groupCard: boolean }
}

interface ApplyResult {
  platform: string
  selfId: string
  preset: string
  ok: boolean
  applied: { avatar?: boolean; nickname?: boolean; bio?: boolean; groupNick?: boolean }
  errors: Array<{ field: string; message: string }>
}

interface SettingsView {
  sendGreeting: boolean
  chatlunaTools: ChatLunaToolName[]
}

type ChatLunaToolName =
  | 'relifeluna_list_presets'
  | 'relifeluna_get_profile'
  | 'relifeluna_create_preset'
  | 'relifeluna_update_preset'
  | 'relifeluna_delete_preset'
  | 'relifeluna_apply_preset'
  | 'relifeluna_set_group_card'

interface ConfigEntry {
  key: string
  parentPath: string
  config: Record<string, unknown>
}

const MAX_AVATAR_BYTES = 4 * 1024 * 1024
const chatlunaToolOptions: Array<{ name: ChatLunaToolName; description: string }> = [
  { name: 'relifeluna_list_presets', description: '获取身份预设列表' },
  { name: 'relifeluna_get_profile', description: '获取当前机器人资料' },
  { name: 'relifeluna_create_preset', description: '创建身份预设' },
  { name: 'relifeluna_update_preset', description: '修改身份预设' },
  { name: 'relifeluna_delete_preset', description: '删除身份预设' },
  { name: 'relifeluna_apply_preset', description: '切换当前机器人身份' },
  { name: 'relifeluna_set_group_card', description: '单独设置当前群的机器人群名片' },
]
const allChatLunaTools = chatlunaToolOptions.map(tool => tool.name)
const greetingVariables = [
  { name: '{{newNickname}}', description: '新昵称' },
  { name: '{{oldNickname}}', description: '切换前昵称' },
  { name: '{{bio}}', description: '新个签' },
  { name: '{{groupNick}}', description: '群昵称' },
  { name: '{{platform}}', description: '平台' },
  { name: '{{selfId}}', description: '机器人 ID' },
]

const activeTab = ref('presets')
const presets = ref<PresetView[]>([])
const bots = ref<BotView[]>([])
const loadingPresets = ref(false)
const loadingBots = ref(false)
const savingPreset = ref(false)
const togglingIds = ref(new Set<number>())
const showEditor = ref(false)
const editingId = ref<number>()
const editor = ref({ name: '', avatar: '', bio: '', greeting: '', groupNick: '', enabled: true })
const editorAvatarPreview = ref('')
const editorAvatarSource = ref('')
const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)

const applyTarget = ref('')
const applyPresetName = ref('')
const applying = ref(false)
const applyResult = ref<ApplyResult>()

const profileTarget = ref('')
const profile = ref<ProfileView>()
const profileError = ref('')
const loadingProfile = ref(false)

const settings = ref<SettingsView>({ sendGreeting: true, chatlunaTools: [...allChatLunaTools] })
const savingSettings = ref(false)

function findConfigEntry(plugins: Record<string, any>, parentPath = ''): ConfigEntry | undefined {
  for (const [key, config] of Object.entries(plugins || {})) {
    if (key.startsWith('$')) continue
    const activeKey = key.startsWith('~') ? key.slice(1) : key
    const pluginName = activeKey.split(':', 1)[0]
    const path = activeKey.slice(pluginName.length + 1)
    if (pluginName === 'relifeluna') return { key: activeKey, parentPath, config: config as Record<string, unknown> }
    if (pluginName === 'group') {
      const nested = findConfigEntry(config as Record<string, any>, path)
      if (nested) return nested
    }
  }
}

const configEntry = computed(() => findConfigEntry(store.config?.plugins))

const supportedBots = computed(() => bots.value.filter(bot => bot.supported && bot.status === 'online'))
const enabledPresets = computed(() => presets.value.filter(preset => preset.enabled))

const appliedSummary = computed(() => {
  const labels: string[] = []
  if (applyResult.value?.applied.nickname) labels.push('昵称')
  if (applyResult.value?.applied.avatar) labels.push('头像')
  if (applyResult.value?.applied.bio) labels.push('个签')
  if (applyResult.value?.applied.groupNick) labels.push('群名片')
  return labels.length ? `（${labels.join('、')}）` : ''
})

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function splitTarget(target: string): [string, string] {
  const index = target.indexOf(':')
  return index < 0 ? [target, ''] : [target.slice(0, index), target.slice(index + 1)]
}

function avatarUrl(source?: string): string | undefined {
  if (!source) return undefined
  if (source.startsWith('base64://')) {
    const data = source.slice('base64://'.length)
    const mime = data.startsWith('/9j/')
      ? 'image/jpeg'
      : data.startsWith('R0lGOD')
        ? 'image/gif'
        : data.startsWith('UklGR')
          ? 'image/webp'
          : 'image/png'
    return `data:${mime};base64,${data}`
  }
  if (source.startsWith('file://')) return undefined
  return source
}

function avatarPreview(preset: Pick<PresetView, 'avatar' | 'avatarPreview'>): string | undefined {
  return preset.avatarPreview || avatarUrl(preset.avatar)
}

async function loadPresets() {
  loadingPresets.value = true
  try {
    presets.value = await send('relifeluna/presets/list', false)
  } catch (error) {
    message.error(`加载预设失败：${errorText(error)}`)
  } finally {
    loadingPresets.value = false
  }
}

async function loadBots() {
  loadingBots.value = true
  try {
    bots.value = await send('relifeluna/bots/list')
  } catch (error) {
    message.error(`加载机器人失败：${errorText(error)}`)
  } finally {
    loadingBots.value = false
  }
}

watch(applyTarget, (target) => {
  profileTarget.value = target
  profile.value = undefined
  profileError.value = ''
  applyResult.value = undefined
  if (target) void loadProfile()
})

watch(() => editor.value.avatar, (source) => {
  if (source !== editorAvatarSource.value) editorAvatarPreview.value = ''
})

watch(activeTab, () => {
  showEditor.value = false
  uploading.value = false
})

function openCreate() {
  editingId.value = undefined
  editor.value = { name: '', avatar: '', bio: '', greeting: '', groupNick: '', enabled: true }
  editorAvatarPreview.value = ''
  editorAvatarSource.value = ''
  showEditor.value = true
}

function openEdit(preset: PresetView) {
  editingId.value = preset.id
  editor.value = { name: preset.name, avatar: preset.avatar, bio: preset.bio, greeting: preset.greeting, groupNick: preset.groupNick || '', enabled: preset.enabled }
  editorAvatarPreview.value = preset.avatarPreview || ''
  editorAvatarSource.value = preset.avatar
  showEditor.value = true
}

async function savePreset() {
  if (!editor.value.name?.trim()) {
    message.error('昵称不能为空')
    return
  }
  savingPreset.value = true
  try {
    if (editingId.value) {
      await send('relifeluna/presets/update', editingId.value, editor.value)
      message.success('预设已更新')
    } else {
      await send('relifeluna/presets/create', editor.value)
      message.success('预设已创建')
    }
    showEditor.value = false
    await loadPresets()
  } catch (error) {
    message.error(`保存失败：${errorText(error)}`)
  } finally {
    savingPreset.value = false
  }
}

async function togglePreset(preset: PresetView, enabled: boolean) {
  togglingIds.value = new Set(togglingIds.value).add(preset.id)
  try {
    await send('relifeluna/presets/update', preset.id, { name: preset.name, enabled })
  } catch (error) {
    message.error(`更新失败：${errorText(error)}`)
  } finally {
    const next = new Set(togglingIds.value)
    next.delete(preset.id)
    togglingIds.value = next
    await loadPresets()
  }
}

async function removePreset(preset: PresetView) {
  try {
    const confirmed = await messageBox.confirm(`确定删除预设「${preset.name}」吗？`)
    if (!confirmed) return
    await send('relifeluna/presets/remove', preset.id)
    if (applyPresetName.value === preset.name) applyPresetName.value = ''
    message.success('预设已删除')
    await loadPresets()
  } catch (error) {
    message.error(`删除失败：${errorText(error)}`)
  }
}

function pickFile() {
  fileInput.value?.click()
}

async function uploadAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > MAX_AVATAR_BYTES) {
    message.error('头像文件超过 4MB')
    return
  }
  if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) {
    message.error('头像必须为 JPEG、PNG、GIF 或 WebP 图片')
    return
  }
  uploading.value = true
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    const result = await send('relifeluna/avatar/upload', dataUrl)
    editor.value.avatar = result.url
    editorAvatarSource.value = result.url
    editorAvatarPreview.value = result.previewUrl || dataUrl
    message.success(result.permanent ? '头像已保存到 Koishi data 目录' : '头像已导入')
  } catch (error) {
    message.error(`头像上传失败：${errorText(error)}`)
  } finally {
    uploading.value = false
  }
}

async function applyPreset() {
  if (!applyTarget.value || !applyPresetName.value) return
  applying.value = true
  try {
    const [platform, selfId] = splitTarget(applyTarget.value)
    applyResult.value = await send('relifeluna/apply', applyPresetName.value, platform, selfId)
    await Promise.all([loadProfile(), loadBots()])
  } catch (error) {
    applyResult.value = undefined
    message.error(`应用失败：${errorText(error)}`)
  } finally {
    applying.value = false
  }
}

async function loadProfile() {
  if (!profileTarget.value) return
  loadingProfile.value = true
  profileError.value = ''
  try {
    const [platform, selfId] = splitTarget(profileTarget.value)
    profile.value = await send('relifeluna/profiles/get', platform, selfId)
  } catch (error) {
    profile.value = undefined
    profileError.value = errorText(error)
  } finally {
    loadingProfile.value = false
  }
}

async function saveSettings() {
  if (!configEntry.value) return
  savingSettings.value = true
  try {
    const nextConfig = { ...configEntry.value.config, ...settings.value }
    await send('manager/reload', configEntry.value.parentPath, configEntry.value.key, nextConfig)
    settings.value = {
      sendGreeting: nextConfig.sendGreeting !== false,
      chatlunaTools: [...settings.value.chatlunaTools],
    }
    message.success('配置已保存并重载')
  } catch (error) {
    message.error(`保存失败：${errorText(error)}`)
  } finally {
    savingSettings.value = false
  }
}

async function loadSettings() {
  if (!configEntry.value) return
  try {
    const current = await send('relifeluna/config/current')
    settings.value = {
      sendGreeting: current.sendGreeting !== false,
      chatlunaTools: Array.isArray(current.chatlunaTools) ? current.chatlunaTools : [...allChatLunaTools],
    }
  } catch (error) {
    message.error(`读取插件配置失败：${errorText(error)}`)
  }
}

watch(configEntry, () => {
  void loadSettings()
}, { immediate: true })

onMounted(async () => {
  await Promise.all([loadPresets(), loadBots()])
})
</script>

<style scoped>
.relifeluna-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.hint {
  font-size: 0.85rem;
  color: var(--k-color-secondary, #888);
}

.form-hint {
  margin-top: 0.35rem;
  font-size: 0.8rem;
  color: var(--k-color-secondary, #888);
  line-height: 1.4;
}

.apply-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1rem;
}

.profile-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.placeholder {
  color: var(--k-color-secondary, #888);
  padding: 1rem 0;
}

.placeholder.error {
  color: var(--el-color-danger);
}

.profile {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.profile dl {
  margin: 0;
  display: grid;
  grid-template-columns: 3.5em 1fr;
  gap: 0.35rem 0.75rem;
}

.profile dt {
  color: var(--k-color-secondary, #888);
}

.profile dd {
  margin: 0;
  word-break: break-all;
}

.apply-result {
  margin-top: 1rem;
}

.apply-hint {
  margin-top: 0.75rem;
}

.error-list {
  margin-top: 0.25rem;
  font-size: 0.9rem;
}

.avatar-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  width: 100%;
}

.avatar-row .el-input {
  flex: 1;
}

.upload-row {
  margin-top: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.hidden-input {
  display: none;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.switch-row div {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.switch-row span {
  font-size: 0.85rem;
  color: var(--k-color-secondary, #888);
}

.settings-section + .settings-section {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--k-color-border, #ddd);
}

.section-heading {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}

.section-heading span,
.tool-option small {
  color: var(--k-color-secondary, #888);
  font-size: 0.85rem;
}

.tool-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 0.5rem 1rem;
}

.tool-list .el-checkbox {
  height: auto;
  margin-right: 0;
  align-items: flex-start;
}

.tool-option {
  display: inline-flex;
  flex-direction: column;
  gap: 0.15rem;
  line-height: 1.35;
}

.variable-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.75rem;
  margin-top: 0.45rem;
  color: var(--k-color-secondary, #888);
  font-size: 0.8rem;
  line-height: 1.4;
}

.variable-list span {
  white-space: nowrap;
}

.variable-list code,
.form-hint code {
  color: var(--k-color-primary, #409eff);
}

.settings-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--k-color-border, #ddd);
  color: var(--k-color-secondary, #888);
  font-size: 0.85rem;
}

.mobile-cards {
  display: none;
}

@media (max-width: 768px) {
  .settings-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .tool-list {
    grid-template-columns: 1fr;
  }

  .desktop-table {
    display: none;
  }

  .mobile-cards {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .preset-card {
    border: 1px solid var(--el-border-color-light);
    border-radius: 8px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .preset-card header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .card-title {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .card-title .sub {
    font-size: 0.8rem;
    color: var(--k-color-secondary, #888);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preset-card footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
}
</style>
