# koishi-plugin-relifeluna

RelifeLuna：为 OneBot 与 Milky 机器人快速切换身份预设（昵称、头像、个签、寒暄），并管理这些预设。

## 功能

- 身份预设管理：昵称、头像、个签、群昵称、寒暄模板，支持启停，全部保存在数据库中
- 协议支持：
  - OneBot：`set_qq_avatar` + `set_qq_profile` + `set_group_card`
  - Milky：`set_avatar` + `set_nickname` + `set_bio` + `set_group_member_card`
- 预设群昵称：可选；在群聊中使用 `relife <身份名>` 或 ChatLuna 身份切换工具时，随预设应用到当前群
- 独立群名片：使用 `relife.card <群名片>` 或 `relifeluna_set_group_card` 只修改当前群的机器人群名片，不改 QQ 昵称、头像或个签
- WebUI：预设增删改查、头像上传、在线机器人列表、当前资料查看、一键应用
- ChatLuna 工具：`relifeluna_list_presets`、`relifeluna_get_profile`、`relifeluna_create_preset`、`relifeluna_update_preset`、`relifeluna_delete_preset`、`relifeluna_apply_preset`、`relifeluna_set_group_card`
- 服务：`ctx.relifeluna`，其他插件可读取、创建、更新预设并应用身份

## 指令

- `relife <身份名>`：切换当前会话机器人的身份
- `relife.list`：列出所有身份，包括已停用的身份
- `relife.card <群名片>`：只设置当前群的机器人群名片，不修改账号资料

权限要求：authority 4。

## 配置

切换后的寒暄行为可在 Koishi 插件配置页调整，也可在 RelifeLuna WebUI 的“设置”页保存并重载。身份预设、头像和寒暄模板请在 Koishi 控制台侧边栏的 RelifeLuna WebUI 中管理。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `sendGreeting` | `true` | 通过聊天命令切换预设后，发送预设中的寒暄模板。 |
| `chatlunaTools` | 全部工具 | 选择要向 ChatLuna 注册的工具；包括独立群名片工具 `relifeluna_set_group_card`，可清空以停用全部工具。 |

身份预设存储于 `relifeluna.preset` 数据表。

## 寒暄模板

推荐使用具名变量编写寒暄模板，例如：`我是 {{newNickname}}，请多关照`。

| 变量 | 内容 |
| --- | --- |
| `{{newNickname}}` / `{{newName}}` | 切换后的新昵称 |
| `{{oldNickname}}` / `{{oldName}}` | 切换前的昵称 |
| `{{nickname}}` / `{{name}}` | 切换后的新昵称 |
| `{{bio}}` | 新个签 |
| `{{groupNick}}` | 预设中的群昵称 |
| `{{platform}}` | 当前机器人平台 |
| `{{selfId}}` | 当前机器人 ID |

单花括号写法（如 `{newNickname}`）同样可用。为兼容已有数据，`%s` 和 `{name}` 仍会替换为新昵称。

## 头像

预设头像支持 `http(s)://`、`file://`、`base64://` 与 `data:` 图片地址。应用时会校验为 JPEG/PNG/GIF/WebP 且不超过 4MB，并转换为 `base64://` 交给协议端，避免协议端无法访问 Koishi 本机文件。

通过 WebUI 上传的头像会直接持久化保存到 Koishi 工作目录下的 `data/relifeluna/avatars`，预设记录保存对应的本地 `file://` 地址，不依赖原始上传来源或外部链接。WebUI 通过插件提供的受控 HTTP 路由预览这些本地文件。
