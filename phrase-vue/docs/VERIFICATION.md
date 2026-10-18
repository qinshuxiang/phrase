# v2重构验证记录

验收日期：2026-10-18（Asia/Shanghai）。当前源码、静态构建、离线HTML与本次报告对应；旧成语版历史报告不作为本次通过依据。机器可读总表：`evidence/refactor-release.json`。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 单元回归 | 70/70，含原52项及18项新会话/备份边界 | study-unit-results.json |
| HTTP桌面/移动 | 38/38，19项场景×2视口，无跳过或重试掩盖 | e2e-results.json、e2e-final.log |
| 独立HTML首次断网 | 38/38，独立中文临时目录仅有HTML | offline-e2e-results.json、offline-final.log、offline-isolation.json |
| 干净安装与构建 | 独立目录npm ci --ignore-scripts后构建；1,056个dist文件逐字节一致 | clean-build.json |
| 主库重建比对 | --check全部分片、索引、引用图片一致 | xingce-check.log |
| 主库与原资料 | 46套6,020题，986张图片，原资料哈希与逐卷内容核对通过 | xingce-verification.json、xingce-verify.log |
| 词汇/扩展/知识卡 | 结构与严格来源校验通过 | data-verify.log、extension-verify.log、knowledge-verify.log |

以上证据均位于`evidence/`。浏览器场景覆盖六模块、材料图片与原图放大、专项反馈、套卷隐藏答案和修改选项、答题卡、草稿刷新、后台计时、关闭后超时恢复、重复提交、错题掌握后再错、收藏与纯文本笔记、备份恢复、非法引用拒绝、数据库不可用、事务取消、旧数据迁移、扩展题源、知识卡、主题、响应式导航、原词汇阅读及跳到主要内容。

## 数据边界

主库3,497题通过本地来源完整文本/选项/材料比对，2,522题待核验、1题缺答案；1,226题缺解析。未通过答案核验的题不自动判分，原题与参考答案保留。未进行逐题事实正确性或人工图片答案核验。11份旧山西PDF仍待整理。

任务启动基线覆盖1,748个文件。唯一接受的基线变更是并行课程导入更新的词库：899→1,037条、108→123组。原899条快照还原后SHA-256为`0feae6ac96ade1702284b4698d180c7a002b871b4bcd9467ecd0108072aab855`，与启动基线一致；逐条证明内容、来源及相对顺序保留。知识卡原数据不变，共859张，138个新增词名尚无卡片。见`refactor-vocab-concurrent.json`及`refactor-vocab-before.json`。

## 成品

离线文件：`offline/行测学习-离线版.html`，51,274,682字节（约48.90MiB，小于64MiB）。

SHA-256：`af7c540b38872945e0f94c0868f8240689d9cea252e721fe308523e42b746d4f`。主库和扩展分片、知识卡、图片、字体全部内嵌，实测断网首次打开。普通静态构建的业务JS约4.76MB，构建器报告大分块提示；功能验证通过，未建立低配设备启动耗时或内存性能门槛。

完整ZIP由`npm run package:release`生成，项目内`SHA256SUMS`覆盖包内文件；同级`.manifest.json`记录ZIP字节数、SHA-256和全文件字节比对结果。导入/原来源核验需要同级原始资料；包内已生成数据足以独立构建和使用。

## 修复与未执行项目

故障注入发现：显式取消IndexedDB事务时error事件中的tx.error可能为空，原记录虽然保留，但失败提示未显示。已补充请求错误和明确回退错误，桌面/移动复测事务取消时原数据库及界面不变。首次失败记录保留于`regression-before-storage-abort.json`，通过复测见最终E2E报告。HTTP与离线测试曾共享轨迹目录导致测试产物冲突，现已隔离输出目录并全部重跑。

默认平台为本机macOS现代Chrome，桌面1440×1000与移动390×844视口。iOS/Android实机、Safari、旧Chromium、UOS及远程部署均未执行，不计为通过。没有PWA或跨设备自动同步。
