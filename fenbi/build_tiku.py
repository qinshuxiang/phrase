#!/usr/bin/env python3
"""把粉笔导出的行测真题 PDF 提取成题库 JSON。

输入：山西/、国考/ 下的 PDF。
输出：题库/index.json（索引）、题库/<分类>/<id>.json（单套试卷）、题库/images/<id>/*.png（题干与选项图）。

PDF 只有题干与选项，不含答案与解析，因此题库不产出 answer 字段。
"""

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "题库"
IMG_ROOT = OUT / "images"
CATEGORIES = ["国考", "山西"]

SECTION_RE = re.compile(r"^([一二三四五六七八九十]+)[.．、]\s*([^：:]{2,16})[：:]\s*(.*)$")
QNUM_RE = re.compile(r"^(\d{1,3})[.．]$")
OPT_RE = re.compile(r"^([A-D])[.．]\s*(.*)$")
OPT_LABEL_RE = re.compile(r"(?<![0-9A-Za-z])([A-D])[.．]")
GROUP_RE = re.compile(r"^[（(][一二三四五六七八九十]+[)）]$")
PAGE_NO_RE = re.compile(r"^第\s*\d+\s*页[，,]\s*共\s*\d+\s*页$")

# 章标题后紧跟的说明文字（丢弃），按关键词判定
# 只保留真正只出现在说明行的词；「要求」「选项」在题干中很常见，会导致误删题干首行
INSTRUCTION_HINTS = ("答案", "陈述", "作答", "判断处理", "分析、比较", "最相符合")
CATEGORY_PREFIX = {"国考": "gk", "山西": "sx"}
# 段内行距约 16.1pt，换段约 19.1pt，用中间值判断选项是否续行
LINE_BREAK = 17.6
# ①②③④、（1）、Ⅰ 等条目在原文各自独立成行，还原为换行
ITEM_START_RE = re.compile(r"^(?:[①②③④⑤⑥⑦⑧⑨⑩]|[（(]\d{1,2}[)）]|[ⅠⅡⅢⅣⅤⅥ]|[IVX]{1,3}[.．])")
# ①②③④、（1）、Ⅰ 等条目在原文各自独立成行，还原为换行
ITEM_START_RE = re.compile(r"^(?:[①②③④⑤⑥⑦⑧⑨⑩]|[（(]\d{1,2}[)）]|[ⅠⅡⅢⅣⅤⅥ]|[IVX]{1,3}[.．])")
# 残留文本达到该长度才视为资料分析材料，避免把换行残片当成材料
MATERIAL_MIN_CHARS = 100


def norm_text(text: str) -> str:
    """规范空白；连续不换行空格视为填空横线。"""
    text = re.sub(r"(?:\u00a0[ \t]*){2,}", "＿＿", text)
    text = re.sub(r"\u00a0[ \t]*", " ", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def parse_year(name: str) -> int:
    m = re.match(r"(\d{4})年", name)
    return int(m.group(1)) if m else 0


def parse_exam_type(name: str) -> str:
    for key in ("副省级", "地市级", "行政执法卷", "县级纪委监委", "山西县级+乡镇", "山西卷"):
        if key in name:
            return key
    return "省考" if "山西" in name else "国考"


def make_exam_id(category: str, name: str) -> str:
    prefix = CATEGORY_PREFIX.get(category, "x")
    year = parse_year(name)
    suffix = ""
    if "副省级" in name:
        suffix = "-fu"
    elif "地市级" in name:
        suffix = "-di"
    elif "行政执法卷" in name:
        suffix = "-zhi"
    elif "县级纪委监委" in name:
        suffix = "-jw"
    elif "山西县级+乡镇" in name:
        suffix = "-lx"
    elif "山西卷" in name:
        suffix = "-lh"
    return f"{prefix}-{year}{suffix}"


def is_noise(text: str, title: str, y0: float) -> bool:
    if "本试卷由粉笔用户" in text:
        return True
    if PAGE_NO_RE.match(text):
        return True
    if text == title and y0 < 80:
        return True
    return False


class ImageStore:
    """按试卷目录保存图片，同图复用。"""

    def __init__(self, exam_id: str):
        self.dir = IMG_ROOT / exam_id
        self.seen = {}
        self.counter = 0

    def add(self, data: bytes, ext: str = "png") -> str:
        digest = hashlib.md5(data).hexdigest()
        if digest in self.seen:
            return self.seen[digest]
        self.counter += 1
        name = f"{self.counter:03d}.{ext}"
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / name).write_bytes(data)
        rel = f"images/{self.dir.name}/{name}"
        self.seen[digest] = rel
        return rel


def iter_items(doc, title: str):
    """按阅读顺序产出 (类型, 内容, y0, y1, 页码)；类型 t=文本行，i=图片。"""
    for pno, page in enumerate(doc):
        for block in page.get_text("dict")["blocks"]:
            if block["type"] == 0:
                for line in block["lines"]:
                    text = norm_text("".join(s["text"] for s in line["spans"]))
                    if not text:
                        continue
                    y0, y1 = line["bbox"][1], line["bbox"][3]
                    if is_noise(text, title, y0):
                        continue
                    yield ("t", text, y0, y1, pno)
            else:
                x0, y0, x1, y1 = block["bbox"]
                width, height = x1 - x0, y1 - y0
                if width >= 580 and height >= 600:  # 整页底图 595×692
                    continue
                if y0 < 80 or x0 <= 1 or width < 3 or height < 3:  # 页眉 logo、页脚横线
                    continue
                if block.get("image") is None:
                    continue
                yield ("i", block["image"], y0, y1, pno)


def split_option_line(text: str):
    """把「A.甲 B.乙 C.丙 D.丁」这类同行多选项拆开；返回 [(label, text)] 或 None。"""
    marks = [(m.start(), m.group(1)) for m in OPT_LABEL_RE.finditer(text)]
    if not marks or marks[0][0] != 0 or marks[0][1] != "A":
        return None
    picked = [marks[0]]
    expected = "B"
    for pos, label in marks[1:]:
        if label == expected:
            picked.append((pos, label))
            expected = chr(ord(expected) + 1)
            if expected > "D":
                break
    out = []
    for idx, (pos, label) in enumerate(picked):
        end = picked[idx + 1][0] if idx + 1 < len(picked) else len(text)
        out.append((label, text[pos + 2 : end].strip()))
    return out


def append_text(parts: list, text: str, brk: bool = False):
    """把一行文本并入 parts；默认中文直接拼接，brk 表示原文此处换段。"""
    if not parts:
        parts.append(text)
        return
    if not brk and ITEM_START_RE.match(text):
        brk = True
    if not brk and ITEM_START_RE.match(text):
        brk = True
    last = parts[-1]
    if isinstance(last, str):
        if brk:
            joiner = "\n"
        else:
            # 只有两侧都是西文字母或数字时才补空格，中文直接拼接
            joiner = " " if (re.match(r"[0-9A-Za-z]", last[-1]) and re.match(r"[0-9A-Za-z]", text[:1])) else ""
        parts[-1] = last + joiner + text
    else:
        parts.append(text)


def render(parts: list) -> str:
    out = []
    for part in parts:
        out.append(part if isinstance(part, str) else f"![]({part['img']})")
    return "".join(out).strip()


def parse_pdf(path: Path, category: str):
    title = path.stem
    exam_id = make_exam_id(category, title)
    doc = pymupdf.open(path)
    store = ImageStore(exam_id)

    questions = []
    materials = []
    stats = {"dropped_chars": 0, "no_options": [], "empty_stem": []}
    cur = None
    cur_opt = None
    buf = []          # [{'y','kind','v'}] 尚未归属的内容
    module = ""
    material_idx = None
    group_marked = False
    last_text_y = -999.0
    last_pno = -1
    last_punct = False
    skip_instruction = 0

    def flush_buf(parts: list):
        for item in buf:
            if item["kind"] == "i":
                parts.append({"img": item["v"]})
            else:
                append_text(parts, item["v"], item.get("brk", False))
        buf.clear()

    def flush_items(items, parts):
        for item in items:
            if item["kind"] == "i":
                parts.append({"img": item["v"]})
            else:
                append_text(parts, item["v"], item.get("brk", False))

    def flush_items(items, parts):
        for item in items:
            if item["kind"] == "i":
                parts.append({"img": item["v"]})
            else:
                append_text(parts, item["v"], item.get("brk", False))

    def render_items(items):
        out = ""
        for item in items:
            piece = item["v"] if item["kind"] == "t" else f"![]({item['v']})"
            out += ("\n" if item.get("brk") and out else "") + piece
        return out

    def close_question(flush: bool = False):
        nonlocal cur, cur_opt
        if cur is None:
            return
        if flush and buf:
            flush_buf(cur["stem"])
        cur["stem_text"] = render(cur["stem"])
        cur["options"] = [{"label": o["label"], "text": render(o["parts"])} for o in cur["options"]]
        if not cur["stem_text"]:
            stats["empty_stem"].append(cur["no"])
        if len(cur["options"]) != 4:
            stats["no_options"].append(cur["no"])
        questions.append(cur)
        cur, cur_opt = None, None

    for kind, payload, y0, y1, pno in iter_items(doc, title):
        if kind == "t":
            text = payload
            if SECTION_RE.match(text):
                close_question()
                buf.clear()
                module = SECTION_RE.match(text).group(2).strip()
                material_idx = None
                group_marked = False
                skip_instruction = 3
                last_text_y, last_pno, last_punct = y0, pno, True
                continue
            if (skip_instruction and len(text) <= 48 and not text.endswith("：")
                    and any(h in text for h in INSTRUCTION_HINTS)):
                skip_instruction -= 1
                last_text_y, last_pno, last_punct = y0, pno, True
                continue
            skip_instruction = 0

            qnum = QNUM_RE.match(text)
            if qnum:
                close_question()
                first = []
                # 题号与题干首行同一基线：y 不小于题号的残留行属于题干
                while buf and buf[-1]["pno"] == pno and buf[-1]["y"] >= y0 - 2:
                    first.insert(0, buf.pop())
                if buf:
                    text_len = sum(len(i["v"]) for i in buf if i["kind"] == "t")
                    has_img = any(i["kind"] == "i" for i in buf)
                    if group_marked or has_img or text_len >= MATERIAL_MIN_CHARS:
                        material_idx = len(materials)
                        materials.append(render_items(buf))
                    else:
                        stats["dropped_chars"] += text_len
                    buf.clear()
                group_marked = False
                cur = {
                    "no": int(qnum.group(1)),
                    "module": module,
                    "stem": [],
                    "options": [],
                    "material": material_idx,
                }
                flush_items(first, cur["stem"])
                cur_opt = None
                last_text_y, last_pno, last_punct = y0, pno, False
                continue

            if GROUP_RE.match(text):
                close_question()
                buf.clear()
                cur_opt = None
                group_marked = True
                buf.append({"pno": pno, "y": y0, "kind": "t", "v": text})
                last_text_y, last_pno, last_punct = y0, pno, False
                continue

            opt = OPT_RE.match(text)
            if cur is not None and opt:
                if cur_opt is None and buf:
                    flush_buf(cur["stem"])
                for label, seg in split_option_line(text) or [(opt.group(1), opt.group(2))]:
                    cur_opt = {"label": label, "parts": [seg] if seg else []}
                    cur["options"].append(cur_opt)
                last_text_y, last_pno, last_punct = y0, pno, text[-1] in "。！？；"
                continue

            brk = pno != last_pno or y0 - last_text_y > LINE_BREAK
            brk = pno != last_pno or y0 - last_text_y > LINE_BREAK
            if cur_opt is not None:
                same_page = pno == last_pno
                if same_page and y0 - last_text_y <= LINE_BREAK:
                    append_text(cur_opt["parts"], text)
                else:
                    cur_opt = None
                    buf.append({"pno": pno, "y": y0, "kind": "t", "v": text, "brk": brk})
            else:
                buf.append({"pno": pno, "y": y0, "kind": "t", "v": text, "brk": brk})
            last_text_y, last_pno, last_punct = y0, pno, text[-1] in "。！？；"
        else:
            img_path = store.add(payload)
            adjacent = pno == last_pno and abs(y0 - last_text_y) <= 14
            if cur_opt is not None and adjacent:
                cur_opt["parts"].append(img_path)
            else:
                buf.append({"pno": pno, "y": y0, "kind": "i", "v": img_path})
            last_text_y = y0

    close_question(flush=True)
    doc.close()

    for q in questions:
        q.pop("stem", None)
    return {
        "id": exam_id,
        "category": category,
        "year": parse_year(title),
        "examType": parse_exam_type(title),
        "title": title,
        "source": f"{category}/{path.name}",
        "materials": materials,
        "questions": [
            {
                "no": q["no"],
                "module": q["module"],
                "material": q["material"],
                "stem": q["stem_text"],
                "options": q["options"],
            }
            for q in questions
        ],
        "_stats": stats,
    }


def main():
    OUT.mkdir(exist_ok=True)
    index = []
    for category in CATEGORIES:
        for pdf in sorted((ROOT / category).glob("*.pdf")):
            exam = parse_pdf(pdf, category)
            stats = exam.pop("_stats")
            target = OUT / category / f"{exam['id']}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(exam, ensure_ascii=False, indent=1), encoding="utf-8")

            modules = {}
            for q in exam["questions"]:
                modules[q["module"]] = modules.get(q["module"], 0) + 1
            index.append({
                "id": exam["id"],
                "category": category,
                "year": exam["year"],
                "examType": exam["examType"],
                "title": exam["title"],
                "source": exam["source"],
                "file": f"{category}/{exam['id']}.json",
                "questionCount": len(exam["questions"]),
                "modules": [{"name": k, "count": v} for k, v in modules.items()],
            })
            flag = ""
            if stats["empty_stem"] or stats["no_options"]:
                flag = f"  空题干{stats['empty_stem']} 选项异常{stats['no_options']}"
            print(f"{category} {exam['id']:11s} {len(exam['questions']):4d} 题 "
                  f"材料{len(exam['materials'])} 丢弃{stats['dropped_chars']}字{flag}")

    index.sort(key=lambda e: (e["category"], -e["year"], e["id"]))
    (OUT / "index.json").write_text(
        json.dumps({"generatedAt": datetime.now().isoformat(timespec="seconds"), "exams": index},
                   ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(f"合计 {len(index)} 套，{sum(e['questionCount'] for e in index)} 题")


if __name__ == "__main__":
    main()
