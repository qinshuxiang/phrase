#!/usr/bin/env python3
"""从粉笔接口抓取行测真题的答案与解析，合并进已有题库。

题库 JSON 由 build_tiku.py 从 PDF 生成，PDF 不含答案；本脚本按试卷名对上粉笔练习，
拉取题目详情里的答案与解析，再按题干对齐写回 题库/<分类>/<id>.json。

用法：
    python3 fetch_answers.py probe [labelId] [份数]   # 探测接口结构，导出原始 JSON
    python3 fetch_answers.py dump  [labelId]          # 抓取该分类全部试卷原始 JSON
    python3 fetch_answers.py merge                    # 把答案合并进题库并重建页面

凭据：环境变量 FENBI_COOKIE，或 FENBI_COOKIE_FILE 指向的文本文件，或本目录 cookie.txt。
接口返回 401 表示 Cookie 失效；建练习接口有频控，遇 403「频率过高」按 15/30/45/60/90 秒退避。
"""

import json
import os
import re
import sys
import time
import urllib.parse
from difflib import SequenceMatcher
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
# 公开真题库（无需登录）：按模块分目录，文件名为粉笔试卷名，含答案与解析
PUBLIC_REPO = "ERRRC/xingcezhenti"
PUBLIC_BRANCH = "main"
PUBLIC_RAW = "https://raw.githubusercontent.com/%s/%s/" % (PUBLIC_REPO, PUBLIC_BRANCH)
BANK = ROOT / "题库"
RAW = ROOT / ".cache" / "answers"
MAP_FILE = RAW / "map.json"
COOKIE_FILE = ROOT / "cookie.txt"

BASE_PARAMS = {"app": "web", "kav": "100", "av": "100", "hav": "100", "version": "3.0.0.0"}
HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
    "Origin": "https://www.fenbi.com",
    "Referer": "https://www.fenbi.com/",
}
# 分类标签：与 fetch_guokao.py 一致，国考 1、山西 23
LABELS = {"1": "国考", "23": "山西"}
# 答案字段在不同接口版本里名字不一，按顺序取第一个非空的
ANSWER_KEYS = ("correctAnswer", "answer", "rightAnswer", "correct", "answerStr", "rightOption")
EXPLAIN_KEYS = ("analysis", "explain", "explanation", "analytic", "analysisText", "parse")


def load_cookie():
    # --cookie 优先，便于临时粘贴；不写入日志
    for i, arg in enumerate(sys.argv):
        if arg == "--cookie" and i + 1 < len(sys.argv):
            return sys.argv[i + 1].strip()
    cookie = os.environ.get("FENBI_COOKIE", "").strip()
    if not cookie:
        path = os.environ.get("FENBI_COOKIE_FILE", "").strip()
        if path and Path(path).exists():
            cookie = Path(path).read_text(encoding="utf-8").strip()
        elif COOKIE_FILE.exists():
            cookie = COOKIE_FILE.read_text(encoding="utf-8").strip()
    if not cookie:
        sys.exit("缺少 Cookie：设置 FENBI_COOKIE / FENBI_COOKIE_FILE，或写入 %s" % COOKIE_FILE)
    return cookie


def build_session():
    s = requests.Session()
    s.headers.update(HEADERS)
    s.headers["Cookie"] = load_cookie()
    return s


def api_get(session, path, params=None):
    url = "https://tiku.fenbi.com" + path
    r = session.get(url, params=dict(BASE_PARAMS, **(params or {})), timeout=30)
    if r.status_code == 401:
        sys.exit("鉴权失败(401)：Cookie 无效或已过期")
    if r.status_code != 200:
        raise RuntimeError("GET %s -> %s %s" % (path, r.status_code, r.text[:120]))
    return r.json()


def list_papers(session, label_id, page_size=60):
    data = api_get(session, "/api/xingce/papers/",
                   {"toPage": "0", "pageSize": str(page_size), "labelId": str(label_id), "hav": "1"})
    return data.get("list") or []


def ensure_exercise(session, paper, max_tries=6):
    exercise = (paper.get("exercise") or {}).get("id")
    if exercise:
        return exercise
    form = {"type": "1", "paperId": paper.get("id"), "exerciseTimeMode": "2"}
    for attempt in range(1, max_tries + 1):
        r = session.post("https://tiku.fenbi.com/api/xingce/exercises",
                         params=dict(BASE_PARAMS, hav="1"), data=form, timeout=30)
        if r.status_code == 200:
            return r.json().get("id")
        if r.status_code == 403 and "频率过高" in r.text:
            if attempt == max_tries:
                break
            wait = 15 * attempt
            print("    限流，等待 %ds 后重试（第 %d 次）" % (wait, attempt))
            time.sleep(wait)
            continue
        raise RuntimeError("创建练习失败：%s %s" % (r.status_code, r.text[:120]))
    raise RuntimeError("创建练习失败：重试次数用尽")


def dump_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


def load_map():
    if MAP_FILE.exists():
        return json.loads(MAP_FILE.read_text(encoding="utf-8"))
    return {}


def save_map(mapping):
    dump_json(MAP_FILE, mapping)


def probe_endpoints(session, paper, ex_id):
    """依次探测可能带答案的接口，返回 {名称: 响应}。"""
    endpoints = {
        "exercise": "/api/xingce/exercises/%s" % ex_id,
        "paper": "/api/xingce/papers/%s" % paper.get("id"),
    }
    found = {}
    for name, path in endpoints.items():
        try:
            data = api_get(session, path, {"hav": "1"})
        except Exception as exc:
            print("  [%s] 失败：%s" % (name, exc))
            continue
        qs = questions_of(data)
        keys = list(data.keys()) if isinstance(data, dict) else []
        print("  [%s] 顶层 %s | 题目 %d" % (name, keys, len(qs)))
        if qs:
            print("       题目字段：%s" % list(qs[0].keys()))
            print("       答案字段：%s" % {k: qs[0].get(k) for k in ANSWER_KEYS if qs[0].get(k) is not None})
        found[name] = data

    # 题目 id 拿到后再试「通用解析」接口：/universal/auth/solutions?type=&questionIds=
    qs = questions_of(found.get("exercise") or {})
    ids = [str(q.get("id")) for q in qs if q.get("id")]
    if ids:
        for qtype in ("1", "2"):
            try:
                data = api_get(session, "/api/xingce/universal/auth/solutions",
                               {"type": qtype, "questionIds": ",".join(ids[:50])})
            except Exception as exc:
                print("  [solutions type=%s] 失败：%s" % (qtype, exc))
                continue
            print("  [solutions type=%s] 顶层 %s" % (qtype, list(data.keys()) if isinstance(data, dict) else type(data)))
            inner = data.get("questions") or data.get("list") or data.get("solutions") or []
            if inner:
                print("       条目字段：%s" % list(inner[0].keys()))
                print("       答案字段：%s" % {k: inner[0].get(k) for k in ANSWER_KEYS if inner[0].get(k) is not None})
            found["solutions-%s" % qtype] = data
    return found


def cmd_probe(session, label_id, count):
    papers = list_papers(session, label_id)
    print("试卷数：%d" % len(papers))
    for paper in papers[:count]:
        name = paper.get("name")
        ex_id = ensure_exercise(session, paper)
        print("试卷 %s | exercise %s" % (name, ex_id))
        found = probe_endpoints(session, paper, ex_id)
        target = RAW / ("probe-%s.json" % paper.get("id"))
        dump_json(target, found)
        print("  原始 JSON：%s" % target)


def cmd_dump(session, label_id, page_size):
    papers = list_papers(session, label_id, page_size)
    mapping = load_map()
    print("试卷数：%d" % len(papers))
    for i, paper in enumerate(papers, 1):
        paper_id = paper.get("id")
        name = paper.get("name") or ""
        target = RAW / ("%s.json" % paper_id)
        if target.exists() and target.stat().st_size > 1024:
            print("[%02d/%d] 跳过(已有) %s" % (i, len(papers), name))
            continue
        try:
            ex_id = ensure_exercise(session, paper)
            detail = api_get(session, "/api/xingce/exercises/%s" % ex_id, {"hav": "1"})
            dump_json(target, detail)
            mapping[str(paper_id)] = {"name": name, "exercise": ex_id}
            save_map(mapping)
            print("[%02d/%d] OK %s" % (i, len(papers), name))
        except SystemExit:
            raise
        except Exception as exc:
            print("[%02d/%d] FAIL %s -> %s" % (i, len(papers), name, exc))
        time.sleep(1.5)


def normalize(text):
    return re.sub(r"\s+", "", re.sub(r"!\[\]\([^)]*\)", "", text or ""))


def answer_letters(value):
    """把接口里的答案转成字母串，兼容 0/1 索引与 'A'/['A'] 等写法。"""
    if value is None:
        return ""
    if isinstance(value, int):
        return "ABCDEFG"[value] if 0 <= value < 7 else ""
    if isinstance(value, (list, tuple)):
        return "".join(answer_letters(v) for v in value)
    text = str(value).strip()
    if not text:
        return ""
    if text.isdigit():
        return "ABCDEFG"[int(text)] if int(text) < 7 else text
    letters = re.findall(r"[A-G]", text.upper())
    return "".join(dict.fromkeys(letters))


def extract_answer(question):
    for key in ANSWER_KEYS:
        letters = answer_letters(question.get(key))
        if letters:
            return letters
    return ""


def extract_explain(question):
    for key in EXPLAIN_KEYS:
        value = question.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def questions_of(detail):
    return detail.get("questions") or detail.get("questionList") or []


def cmd_merge(dry_run=False):
    index = json.loads((BANK / "index.json").read_text(encoding="utf-8"))
    mapping = load_map()
    by_name = {meta["name"]: pid for pid, meta in mapping.items()}
    total = filled = 0
    for item in index["exams"]:
        exam_path = BANK / item["file"]
        exam = json.loads(exam_path.read_text(encoding="utf-8"))
        pid = by_name.get(item["title"])
        if not pid:
            print("跳过（没有对应抓取记录）：%s" % item["title"])
            continue
        raw = RAW / ("%s.json" % pid)
        if not raw.exists():
            print("跳过（原始 JSON 缺失）：%s" % item["title"])
            continue
        api_qs = questions_of(json.loads(raw.read_text(encoding="utf-8")))
        local_qs = exam["questions"]
        if len(api_qs) != len(local_qs):
            print("题数不一致 %s：接口 %d / 题库 %d，按前 %d 题对齐"
                  % (item["id"], len(api_qs), len(local_qs), min(len(api_qs), len(local_qs))))
        for local, remote in zip(local_qs, api_qs):
            total += 1
            answer = extract_answer(remote)
            explain = extract_explain(remote)
            if not answer:
                continue
            stem_api = normalize(remote.get("content") or remote.get("stem") or "")
            stem_local = normalize(local["stem"])
            if stem_api and stem_local and stem_api[:20] != stem_local[:20]:
                print("  题干对齐存疑 %s 第 %s 题" % (item["id"], local["no"]))
            local["answer"] = answer
            local["explain"] = explain
            filled += 1
        if not dry_run:
            exam_path.write_text(json.dumps(exam, ensure_ascii=False, indent=1), encoding="utf-8")
    print("题目 %d，写入答案 %d（%.1f%%）%s"
          % (total, filled, filled * 100 / max(total, 1), "（dry-run 未落盘）" if dry_run else ""))


def http_get_text(url, retries=3):
    for attempt in range(1, retries + 1):
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
        if r.status_code == 200:
            return r.text
        if r.status_code == 404:
            return None
        time.sleep(1.5 * attempt)
    return None


def public_tree():
    cache = RAW / "errrc-tree.json"
    if cache.exists() and cache.stat().st_size > 1024:
        return json.loads(cache.read_text(encoding="utf-8"))
    url = "https://api.github.com/repos/%s/git/trees/%s?recursive=1" % (PUBLIC_REPO, PUBLIC_BRANCH)
    data = requests.get(url, timeout=40).json()
    dump_json(cache, data)
    return data


def public_files_by_paper():
    """{试卷名: {模块目录: 路径}}"""
    tree = public_tree()
    mapping = {}
    for node in tree.get("tree", []):
        path = node["path"]
        if not path.endswith(".md") or "/" not in path:
            continue
        folder, filename = path.split("/", 1)
        if not folder[0].isdigit():
            continue
        mapping.setdefault(filename[:-3], {})[folder] = path
    return mapping


def cmd_public():
    """下载公开真题库里与题库同名的试卷（按模块），缓存到 题库/_raw/errrc/<examId>/。"""
    index = json.loads((BANK / "index.json").read_text(encoding="utf-8"))
    files = public_files_by_paper()
    ok = miss = 0
    for item in index["exams"]:
        modules = files.get(item["title"])
        if not modules:
            print("缺：%s" % item["title"])
            miss += 1
            continue
        target_dir = RAW / "errrc" / item["id"]
        target_dir.mkdir(parents=True, exist_ok=True)
        for folder, path in sorted(modules.items()):
            target = target_dir / (folder + ".md")
            if target.exists() and target.stat().st_size > 512:
                continue
            text = http_get_text(PUBLIC_RAW + urllib.parse.quote(path))
            if text:
                target.write_text(text, encoding="utf-8")
                time.sleep(0.2)
        got = len(list(target_dir.glob("*.md")))
        print("%s 模块 %d 个文件" % (item["id"], got))
        ok += 1
    print("命中试卷 %d，缺失 %d" % (ok, miss))


QUESTION_RE = re.compile(r"^#{2,3} 第 (\d+) 题")
MATERIAL_RE = re.compile(r"^#{2,3} 材料")
OPTION_RE = re.compile(r"^- \*\*([A-G])\*\*\.\s?(.*)$")
ANSWER_RE = re.compile(r"^\*\*答案\*\*：\s*([A-G]+)")
EXPLAIN_RE = re.compile(r"^\*\*官方解析\*\*\s*$")
TAG_RE = re.compile(r"<[^>]+>")


def plain(text):
    """去掉 HTML 标签与多余空白。"""
    return re.sub(r"\s+", " ", TAG_RE.sub(" ", text)).strip()


def strip_punct(text):
    """去掉图片占位、空白与标点，只留文字，用于题干比对。"""
    text = re.sub(r"!\[\]\([^)]*\)", "", text or "")
    return re.sub(r"[\s\u3000，。、：；？！“”‘’（）()《》〈〉【】·—…\-_,.;:?\"']", "", text)


def parse_module_md(text, module=""):
    """解析一份模块 md，返回 [{no, module, stem, answer, explain, qid}]（材料标题会截断上一题）。"""
    items = []
    cur = None
    state = None

    def close():
        if cur and cur["stem"]:
            cur["stem"] = plain("\n".join(cur["stem"]))
            cur["explain"] = "\n".join(x for x in (plain(l) for l in cur["explain"]) if x)
            if cur["stem"]:
                items.append(cur)

    for line in text.split("\n"):
        m = QUESTION_RE.match(line)
        if m:
            close()
            qid = re.search(r"qid (\d+)", line)
            cur = {"no": int(m.group(1)), "module": module, "stem": [], "explain": [],
                   "answer": "", "qid": qid.group(1) if qid else ""}
            state = "stem"
            continue
        if MATERIAL_RE.match(line):
            close()
            cur, state = None, None
            continue
        if cur is None:
            continue
        if OPTION_RE.match(line):
            continue
        m = ANSWER_RE.match(line)
        if m:
            cur["answer"] = m.group(1)
            continue
        if EXPLAIN_RE.match(line):
            state = "explain"
            continue
        if line.strip() in ("", "---") or line.startswith("# "):
            continue
        if line.startswith("> "):
            continue
        (cur["stem"] if state == "stem" else cur["explain"]).append(line)
    close()
    return items


def parse_exam_pool(cache_dir):
    """按模块目录顺序（01、02…）拼接整套试卷的答案池，保证与全卷题序接近。"""
    pool = []
    for md in sorted(cache_dir.glob("*.md")):
        module = md.stem.split("-", 1)[-1] if "-" in md.stem else md.stem
        pool.extend(parse_module_md(md.read_text(encoding="utf-8"), module))
    return pool


def sim(a, b):
    return SequenceMatcher(None, a, b).ratio()


def align_questions(local_stems, repo_stems):
    """把题库题目对到公开题库条目，返回 {local_index: repo_index}。

    先按题干文本建索引，同一题干出现多次时按出现顺序配对（图形推理题干大量重复）；
    文本为空（只有图）或文本差异过大的，按前后已配对题目之间的空档按顺序补齐。
    """
    from collections import defaultdict, deque

    repo_map = defaultdict(deque)
    for j, stem in enumerate(repo_stems):
        key = strip_punct(stem)[:30]
        if key:
            repo_map[key].append(j)

    assigned = {}
    used = set()
    for i, stem in enumerate(local_stems):
        key = strip_punct(stem)[:30]
        if not key:
            continue
        queue = repo_map.get(key)
        while queue and queue[0] in used:
            queue.popleft()
        if queue:
            j = queue.popleft()
            assigned[i] = j
            used.add(j)

    # 空档补齐：相邻两题之间，未配对的两段按顺序一一对应
    i = 0
    total = len(local_stems)
    while i < total:
        if i in assigned:
            i += 1
            continue
        start = i
        while i < total and i not in assigned:
            i += 1
        end = i - 1
        left = assigned.get(start - 1, -1)
        right = assigned.get(end + 1, len(repo_stems))
        candidates = [j for j in range(left + 1, right) if j not in used]
        run = end - start + 1
        if len(candidates) == run:
            for offset, j in enumerate(candidates):
                assigned[start + offset] = j
                used.add(j)
    return assigned


def fill_unmatched(local, pool, assigned, used):
    """题干为空（纯图片题）时，按同模块、按顺序补配对。"""
    for i, q in enumerate(local):
        if i in assigned:
            continue
        cands = [j for j, p in enumerate(pool)
                 if j not in used and p["module"] == q["module"]]
        if not cands:
            continue
        j = min(cands, key=lambda k: abs(k - i))
        assigned[i] = j
        used.add(j)
    return assigned


def cmd_merge_public(dry_run=False):
    index = json.loads((BANK / "index.json").read_text(encoding="utf-8"))
    grand_total = grand_filled = 0
    for item in index["exams"]:
        exam_path = BANK / item["file"]
        exam = json.loads(exam_path.read_text(encoding="utf-8"))
        cache_dir = RAW / "errrc" / item["id"]
        pool = parse_exam_pool(cache_dir) if cache_dir.exists() else []
        if not pool:
            print("跳过（无公开数据）：%s" % item["title"])
            continue

        local = exam["questions"]
        mapping = align_questions([q["stem"] for q in local], [p["stem"] for p in pool])

        mapping = fill_unmatched(local, pool, mapping, set(mapping.values()))
        filled = 0
        unmatched = []
        for i, q in enumerate(local):
            j = mapping.get(i)
            cand = pool[j] if j is not None else None
            if cand and cand["answer"]:
                q["answer"] = cand["answer"]
                q["explain"] = cand["explain"]
                q["qid"] = cand["qid"]
                filled += 1
            else:
                unmatched.append(q["no"])
        grand_total += len(local)
        grand_filled += filled
        print("%-12s %3d/%3d 有答案%s" % (item["id"], filled, len(local),
              ("" if not unmatched else "  缺 %s" % unmatched[:8])))
        if not dry_run:
            exam_path.write_text(json.dumps(exam, ensure_ascii=False, indent=1), encoding="utf-8")
    print("合计 %d/%d（%.1f%%）%s" % (grand_filled, grand_total,
          grand_filled * 100 / max(grand_total, 1), "（dry-run 未落盘）" if dry_run else ""))


# 公开真题库整卷页（结构：题号独占一行 + 题干 + A、选项），含 2015 及更早的国考卷
GKZ_BASE = "https://gwy.gkzhenti.cn"
GKZ_PAPERS = {
    "gk-2008": "20160729155934",
    "gk-2009": "20160729152234",
    "gk-2010": "20160729140302",
    "gk-2011": "20160729135643",
    "gk-2012": "20160729134854",
    "gk-2013": "20130729133122",
    "gk-2014": "20160729132234",
    "gk-2015": "20160729114033",
    "gk-2015-di": "20160729131045",
}


def html_lines(html):
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S)
    text = re.sub(r"<[^>]+>", "\n", text)
    return [line.strip() for line in text.split("\n") if line.strip()]


def parse_gkz_paper(html):
    """解析整卷页，返回 [{no, stem}]，题号为卷面题号。"""
    lines = html_lines(html)
    items = []
    cur = None
    for line in lines:
        if re.fullmatch(r"\d{1,3}", line):
            no = int(line)
            if cur:
                items.append(cur)
            cur = {"no": no, "stem": []}
            continue
        if cur is None:
            continue
        if re.match(r"^[A-D][、.．]", line):
            continue
        if line.startswith(("分类：", "查看", "返回", "打印", "保存")):
            continue
        cur["stem"].append(line)
    if cur:
        items.append(cur)
    for item in items:
        item["stem"] = "".join(item["stem"])
    return items


def parse_gkz_answer(html):
    text = re.sub(r"<[^>]+>", " ", html)
    return {int(n): a for n, a in re.findall(r"(\d{1,3})\s*[、.．]\s*([A-D])", text)}


def cmd_gkzhenti(dry_run=False):
    index = json.loads((BANK / "index.json").read_text(encoding="utf-8"))
    by_id = {e["id"]: e for e in index["exams"]}
    grand_fill = grand_total = 0
    for exam_id, paper_id in GKZ_PAPERS.items():
        item = by_id.get(exam_id)
        if not item:
            print("题库里没有 %s" % exam_id)
            continue
        cache = RAW / "gkzhenti" / exam_id
        cache.mkdir(parents=True, exist_ok=True)
        paper_html = cache / "paper.html"
        answer_html = cache / "answer.html"
        if not paper_html.exists() or paper_html.stat().st_size < 4096:
            paper_html.write_text(http_get_text(GKZ_BASE + "/paper/" + paper_id) or "", encoding="utf-8")
            time.sleep(0.6)
        if not answer_html.exists() or answer_html.stat().st_size < 4096:
            answer_html.write_text(http_get_text(GKZ_BASE + "/answer/" + paper_id) or "", encoding="utf-8")
            time.sleep(0.6)

        site = parse_gkz_paper(paper_html.read_text(encoding="utf-8"))
        answers = parse_gkz_answer(answer_html.read_text(encoding="utf-8"))
        exam_path = BANK / item["file"]
        exam = json.loads(exam_path.read_text(encoding="utf-8"))
        local = exam["questions"]
        mapping = align_questions([q["stem"] for q in local], [s["stem"] for s in site])
        # 题干高度重复（图形推理）时按剩余位置顺序补齐
        unused = [j for j in range(len(site)) if j not in set(mapping.values())]
        pending = [i for i in range(len(local)) if i not in mapping]
        if len(unused) == len(pending):
            for i, j in zip(pending, unused):
                mapping[i] = j
        filled = blank = 0
        for i, q in enumerate(local):
            j = mapping.get(i)
            if j is None:
                blank += 1
                continue
            letter = answers.get(site[j]["no"])
            if letter:
                q["answer"] = letter
                filled += 1
            else:
                blank += 1
        grand_fill += filled
        grand_total += len(local)
        print("%-11s 卷面 %3d 题 / 题库 %3d 题，对齐 %3d，补答案 %3d，留空 %d"
              % (exam_id, len(site), len(local), len(mapping), filled, blank))
        if not dry_run:
            exam_path.write_text(json.dumps(exam, ensure_ascii=False, indent=1), encoding="utf-8")
    print("合计补 %d/%d%s" % (grand_fill, grand_total, "（dry-run 未落盘）" if dry_run else ""))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    if cmd == "gkzhenti":
        cmd_gkzhenti(dry_run="--dry-run" in sys.argv)
        return
    if cmd == "public":
        cmd_public()
        return
    if cmd == "merge-public":
        cmd_merge_public(dry_run="--dry-run" in sys.argv)
        return
    if cmd == "merge":
        cmd_merge(dry_run="--dry-run" in sys.argv)
        return
    session = build_session()
    if cmd == "probe":
        label = sys.argv[2] if len(sys.argv) > 2 else "1"
        count = int(sys.argv[3]) if len(sys.argv) > 3 else 1
        cmd_probe(session, label, count)
    elif cmd == "dump":
        label = sys.argv[2] if len(sys.argv) > 2 else "1"
        page_size = int(sys.argv[3]) if len(sys.argv) > 3 else 60
        print("分类：%s" % LABELS.get(label, label))
        cmd_dump(session, label, page_size)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
