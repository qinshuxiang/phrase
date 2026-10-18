# 官方 UI 复用记录

开发前实际读取了 [shadcn-vue Blocks](https://shadcn-vue.com/blocks)、[Sidebar 文档](https://shadcn-vue.com/docs/components/sidebar)、[CLI 文档](https://shadcn-vue.com/docs/cli) 和 [JavaScript 支持说明](https://shadcn-vue.com/docs/javascript)，并通过 GitHub API 检查官方仓库中的 `reka-lyra` 注册表和 `sidebar-01` Block。

仓库：[unovue/shadcn-vue](https://github.com/unovue/shadcn-vue)。本次检查到的 dev 分支提交为 `de1f76cbb4b319ea26b0dea175dc00c18fce3bd0`；在线 registry 由官方 CLI 获取，不能把这个仓库检查提交号等同为网站部署的构建身份。

Lyra 的官方定义是方正规整、棱角分明、适合等宽字体。最终配置：

```json
{
    "style": "reka-lyra",
    "font": "jetbrains-mono",
    "typescript": true,
    "iconLibrary": "lucide"
}
```

以上字段来自本项目 `components.json`；主题使用官方 neutral 变量，圆角统一为零。字体通过 `@fontsource-variable/jetbrains-mono` 本地打包，替换 CLI 默认加入的 Google Fonts 网络导入。

## 实际来源

当前保留的组件来自官方 CLI `shadcn-vue@2.8.2`，对应获取命令为：

```bash
npx --yes shadcn-vue@2.8.2 add sidebar card accordion badge input progress table --yes
```

当前保留连同依赖共 76 个 UI 文件，全部位于 `src/components/ui/`。原始 registry URL 格式为 `https://shadcn-vue.com/r/styles/reka-lyra/{component}.json`。完整本地文件哈希清单位于 `evidence/ui-provenance.json`。

| 官方组件或组合 | 项目使用位置 |
| --- | --- |
| sidebar-01 Block 的 Provider / Sidebar / Inset / Trigger 组合 | 应用外壳与导航 |
| Sidebar Header / Menu / Footer，内置 Sheet | 桌面侧栏、手机导航 |
| Card / CardContent、Table、Progress | 统计、来源列表 |
| Accordion / Item / Trigger / Content | 主题分组和词条展开 |
| Input、Button、Badge、Separator | 查询、控制按钮、标记、分隔 |
| Tooltip、Sheet、Skeleton | 官方 Sidebar 的内部依赖 |

`AppSidebar.vue` 使用官方 Block 的布局组合，并将示例导航、用户、版本数据替换为本地学习库。没有创建一套平行的按钮、输入框、抽屉或折叠组件。

安全高亮、词条字段展示、来源翻阅是本项目的业务逻辑与组合结构，官方通用 UI 不提供这些数据语义；实施前已向用户说明。

## 兼容处理

官方 CLI 的 JavaScript 转换在 Sidebar 的 `defineProps<SidebarProps>()` 上无法解析相对类型导入。因此保留全部官方 UI 的 TypeScript 形式，业务部分仍使用 JavaScript 和 `<script setup>`。未手写替代 Sidebar。

TypeScript 最新版 7.0.2 在本次安装环境只暴露版本信息，缺少 Vue 3.5.44 类型解析所需的 `ts.sys`，因此将构建依赖固定为 `typescript@5.9.3`，官方 UI 得以正常编译。没有修改依赖源码。

`src/styles/shadcn.css` 是官方 CLI 2.8.2 包中的 `dist/tailwind.css` 原文副本，替代安装整套 CLI 作为应用依赖。其哈希也保存在来源清单中。`src/style.css` 只定义统一主题、排版、文本高亮和响应式辅助规则。

UI 源码使用 MIT 许可，原文见 `licenses/shadcn-vue-MIT.txt`；JetBrains Mono 字体使用 OFL，原文见 `licenses/JetBrainsMono-OFL.txt`。
