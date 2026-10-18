# 行测学习 · Vue 3 / Lyra

面向山西备考、兼顾国考的本地行测学习应用。包含六模块专项练习、真题套卷、错题复习、收藏笔记、言语知识库、学习统计及备份恢复。单机单用户，无账号、业务后端或在线API。

## 直接使用

双击 `offline/行测学习-离线版.html`，现代Chrome可首次断网打开。一个文件包含题库、材料图片、字体和知识卡。浏览器允许存储时，草稿和学习记录自动保存在本地。更换文件位置或浏览器前，在「学习记录」导出备份。

首次打开默认山西。练习逐题提交后反馈；套卷交卷后统一显示答案，训练计时默认120分钟。待核验题有参考答案但不自动判分。

## 开发与静态构建

Node.js 24.18.0，依赖由 `package-lock.json`固定。

```bash
npm ci
npm run dev            # http://127.0.0.1:5178
npm run build
npm run preview        # http://127.0.0.1:4178
```

端口仅绑定本机；Ctrl+C停止服务。`dist/`可由HTTP静态文件服务提供，Hash导航无需路由回退；双击使用请选离线单HTML。

```bash
npm run build:offline
npm run verify:data
npm run verify:exam -- --strict
npm run verify:knowledge -- --strict
npm run import:xingce -- --check
npm run verify:xingce
npm test
npm run test:e2e       # 先build，测试生产构建
npm run test:offline   # 先build:offline，独立目录file://首次断网
```

默认测试浏览器为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，可用 `PLAYWRIGHT_CHROME_PATH`指定其他现代Chrome。

## 当前内容

| 内容 | 数量 |
| --- | ---: |
| 国考与山西主题库 | 46套 / 6,020题 |
| 已核验 / 待核验 / 缺答案 | 3,497 / 2,522 / 1 |
| 缺解析（与状态重叠） | 1,226 |
| 题目、材料引用图片 | 986张 |
| 独立言语扩展题源 | 6,577题 |
| 词汇笔记 | 1,037条 / 123组 / 24份来源 |
| 既有知识卡 | 859张，新增138个词名尚无卡片 |
| 待整理旧山西PDF | 11份 |

词库在本次重构期间有并行课程资料增补，完整保留。原899条笔记的内容、来源和相对顺序经比对不变；859张知识卡原数据未改。原PDF、fenbi工程和扩展言语数据也未改动。

详细口径、导入、存储、迁移与兼容边界见 [学习功能说明](docs/STUDY.md)。本次验收见 [验证记录](docs/VERIFICATION.md)，双击交付见 [离线说明](docs/OFFLINE.md)。历史文档 [言语题源](docs/EXAM.md)、[知识卡](docs/KNOWLEDGE-CARDS.md)、[视频导入](docs/VIDEO-IMPORT.md)记录对应内容的建设过程；当前应用行为以STUDY.md为准。[UI来源](docs/UI-SOURCES.md)与 `licenses/`保留组件和字体许可。

业务代码使用JavaScript与Composition API。`src/components/ui/`保留shadcn-vue官方Lyra组件的TypeScript源码。本次仅新增parse5直接开发依赖声明用于本地来源核验，版本为已安装的8.0.1，未升级框架。

重新生成本地交付包：`npm run package:release`。会更新项目内 `SHA256SUMS`，在同级输出带上海时区日期的ZIP、`.sha256`和`.manifest.json`，并逐文件比较压缩包与工作区。发布包不包含node_modules、研究抓取缓存或临时测试轨迹；构建与运行使用包内数据，不依赖同级原始资料。重新导入主库和原始来源核验需要保留同级fenbi工程。
