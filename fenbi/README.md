# fenbi
粉笔历年真题下载爬虫
## 使用方法
1. `pip install requests`。
2. 在main.py文件中locations列表中填入好需要下载真题的分类名称，参考[粉笔官网](https://www.fenbi.com/spa/tiku/guide/realTest/xingce/xingce "粉笔官网")顶部分类名称。
3. 在终端中执行`python main.py`。
4. 如果无法使用请提交Issues告知。

## 转成题库

已下载的 PDF 可解析成结构化题库（题干、选项、模块、资料分析材料与图片）。试卷 PDF 内不含答案与解析，题库因此不含答案字段。

1. `python3 build_tiku.py`：解析 `国考/`、`山西/` 下的 PDF，输出 `题库/`，每套试卷一个 JSON，另有 `题库/index.json` 索引与 `题库/images/` 图片。
2. `python3 build_viewer.py`：把 `题库/` 打包成单文件 `题库.html`，双击即可按试卷/模块浏览、搜索题干、标记自测选项。
3. `题库.html` 与 `题库/` 需放在同一目录，题目图片按 `题库/images/...` 相对路径加载。

## 补答案

粉笔导出的试卷 PDF 不含答案解析，`fetch_answers.py` 负责补齐：

1. `python3 fetch_answers.py public`：从公开真题库 `ERRRC/xingcezhenti` 按试卷名下载含答案与官方解析的 Markdown，缓存到 `.cache/answers/`（无需登录）。
2. `python3 fetch_answers.py merge-public`：按题干把答案、解析、qid 写回 `题库/`，再加 `--dry-run` 只统计不落盘。
3. `python3 build_viewer.py`：重新打包页面，选择题即判分并展开解析。

当前覆盖 46/46 套、6019/6020 题：

- 2016 年及之后的 37 套来自 `ERRRC/xingcezhenti`，带官方解析（4794 题）。
- 2015 年及更早的 9 套国考卷公开库未收录解析，改用 `gwy.gkzhenti.cn` 的整卷页 + 答案页补齐：`python3 fetch_answers.py gkzhenti`（按题干对齐，只有答案没有解析）。
- 两条来源都用「题干文本」对齐，不依赖题号——各站题号与模块顺序并不一致。

走粉笔官方接口的另一条路需要登录 Cookie：`probe` → `dump` → `merge`，Cookie 放 `FENBI_COOKIE` 环境变量或 `cookie.txt`。

依赖：`pymupdf`、`requests`。

