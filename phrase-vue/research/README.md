# 知识卡研究记录

本目录保存知识卡的抽样、证据与人工整理稿，不进入前端构建。

## 目录

| 路径 | 内容 |
| --- | --- |
| `sampling/sample-100.json` | 试点批的种子、算法、词表、`entry_refs`、`words_sha256` |
| `sampling/sample-100.md` | 试点批人工可读清单 |
| `sampling/all-words.json` | 全量 859 词的词序、批次、`entry_refs`、`words_sha256` |
| `sampling/all-words.md` | 批次划分与起始词 |
| `cache/zdic/<词>.html` | 汉典页面原文缓存，可删除后重抓 |
| `cache/state.json` | 抓取状态、HTTP 状态、页面 sha256 |
| `evidence/<词>.json` | 解析后的读音、义项、书证、近反义与文本块 |
| `search/queries.json` | 检索记录：查询、URL、摘要、判断 |
| `manual/lexical.json` | 异形判断与缺字段补录（含来源原文） |
| `manual/confusables.json` | 试点批每个词的易混词与差异说明 |
| `manual/confusables-b1.json` … `-b8.json` | 补充批的差异说明，构建时合并 |
| `reports/` | 覆盖率与体积报告 |

## 来源政策

- 事实字段只引用可以给出 URL 与原文的来源；引用片段必须在 `evidence/` 或 `manual/` 中找到原文。
- 汉典 xxjs 页只有「书证」，没有「出处」字段。**不得用书证反推出处**；缺失就记 `missing` 并写原因。
- 汉典 404 不等于词不存在：先检索判词形，再决定 `variant`、`modern_phrase` 或 `uncertain`。
- 培训类页面只能作辨析线索，不能作为 `quote` 来源；采用其观点时必须写入 `derived` 的说明。
- 差异说明一律标「整理（derived）」，写清依据（词库释义、关联词、汉典义项），不冒称词典原文。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `verified` | 原文已在归档页面中找到 |
| `single-source` | 只有一个来源，或仅有检索摘要，未做交叉核对 |
| `reviewed` | 整理内容已按依据核对 |
| `pending` | 待补，交付前必须清零 |
| `missing` | 来源确实没有该字段，附原因 |
| `conflict` | 多源矛盾，需在 `conflicts[]` 记录并给出处理结论 |

## 复跑顺序

```bash
npm run plan:knowledge -- --check
npm run sample:knowledge -- --check
npm run draft:knowledge -- --batch b1
npm run fetch:knowledge -- --reparse
npm run build:knowledge -- --check
npm run verify:knowledge -- --strict
```

`cache/` 已加入 `.gitignore`；`evidence/`、`manual/`、`search/` 需要随仓库保留，否则无法复现卡片。
