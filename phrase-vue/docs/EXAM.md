# 独立言语扩展题源

v2的主要练习及套卷使用全科主库，见 [学习功能说明](STUDY.md)。原言语题源保留为独立扩展题源，原6,577题与11个年份分片没有修改，不混入主库题量。

数据来自既有 `ERRRC/xingcezhenti` 的 `03-言语理解与表达` 本地导入，覆盖2016–2026年509份模块试卷，经qid去重保留6,577题。旧解析器跳过图片依赖题，因此该扩展题源以文字言语题为主，不能代替六模块主库。

`public/exam/index.json`为版本1索引，分片为 `public/exam/verbal/<year>.json`；保留原qid、题干、选项、答案、解析、材料和来源元数据。v2加载层映射为 `legacy:qid`，用于独立练习和旧错题恢复。默认最近三年，可按单年选择。

```bash
npm run import:exam -- --check   # 需要同级xingcezhenti原导入目录
npm run verify:exam -- --strict  # 只使用现有索引与分片
```

离线单HTML将11个分片gzip后内嵌；file://下用DecompressionStream读取。新文件为 `offline/行测学习-离线版.html`，上限64MiB，详见 [离线说明](OFFLINE.md)。

旧 `vocab-exam-history`、`vocab-exam-wrong`仅作迁移来源，原键保留；新的作答使用IndexedDB，不再使用旧版50条成绩、500条错题裁剪上限。旧版纯函数和存储模块保留兼容回归测试，不参与新会话存储。

原题源未提供明确数据LICENSE，现有来源说明及个人学习使用边界继续保留。应用不登录或直连粉笔，不发起在线抓题请求。
