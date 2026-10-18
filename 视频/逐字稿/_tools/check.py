#!/usr/bin/env python3
"""校验逐字稿精编稿：结构、时间轴残留、繁体字、例句可追溯性。

用法：
    python _tools/check.py                 # 校验 out 目录全部 md
    python _tools/check.py --file 某文件.md

检查项对应计划中的 L2 校验：只能证明"有据可查"，不能证明语义正确。
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASR_DIR = ROOT / "_work" / "asr"

TRADITIONAL = "這個說時個們為與後裡還沒經對開關點樣麼幾當發現實應該讓給從無間問題學習記詞義"
TIME_RE = re.compile(r"\d{1,2}:\d{2}(:\d{2})?")
QUOTE_SECTION = re.compile(r"^[-*]\s*\*\*课上例句\*\*[：:]\s*(.+)$")


def section_titles(md: str) -> list[str]:
    """取出所有三级标题（词条名）。"""
    return [m.group(1).strip() for m in re.finditer(r"^###\s+(.+)$", md, re.M)]


def example_lines(md: str) -> list[str]:
    """取出所有课上例句行。"""
    out = []
    for line in md.splitlines():
        m = QUOTE_SECTION.match(line.strip())
        if m:
            out.append(m.group(1).strip())
    return out


def norm(text: str) -> str:
    """归一化：只留汉字、字母、数字，便于宽松匹配。"""
    return re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", text)


def trace_rate(examples: list[str], asr: str) -> tuple[int, int, list[str]]:
    """统计例句能在原文中找到的比例；按 8 字滑窗判定，避免整句标点差异误伤。"""
    hay = norm(asr)
    hit, misses = 0, []
    for ex in examples:
        key = norm(ex)
        if len(key) < 6:
            hit += 1
            continue
        probes = [key[i:i + 8] for i in range(0, max(len(key) - 8, 1), 8)][:6]
        ok = sum(1 for p in probes if p in hay)
        if probes and ok / len(probes) >= 0.6:
            hit += 1
        else:
            misses.append(ex)
    return hit, len(examples), misses


def check(md_path: Path, asr_path: Path) -> dict:
    """对单个 md 执行全部自动检查，返回结果字典。"""
    md = md_path.read_text(encoding="utf-8")
    asr = asr_path.read_text(encoding="utf-8") if asr_path.exists() else ""
    titles = section_titles(md)
    examples = example_lines(md)
    hit, total, misses = trace_rate(examples, asr)
    trad = sorted({ch for ch in md if ch in TRADITIONAL})
    return {
        "file": md_path.name,
        "chars": len(re.sub(r"\s", "", md)),
        "sections": len(titles),
        "titles": titles,
        "timeline_hits": TIME_RE.findall(md),
        "traditional": trad,
        "examples": total,
        "example_hit": hit,
        "example_rate": round(hit / total, 3) if total else None,
        "example_misses": misses,
        "has_h1": md.startswith("# "),
        "has_table": bool(re.search(r"^\|.*\|$", md, re.M)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", help="只校验指定 md 文件名")
    args = parser.parse_args()

    files = sorted(ROOT.glob("*.md"))
    if args.file:
        files = [f for f in files if f.name == args.file]
    if not files:
        print("没有找到待校验的 md")
        return

    problems = 0
    for md_path in files:
        result = check(md_path, ASR_DIR / f"{md_path.stem}.txt")
        flags = []
        if result["timeline_hits"]:
            flags.append(f"含时间点×{len(result['timeline_hits'])}")
        if result["traditional"]:
            flags.append("繁体字:" + "".join(result["traditional"]))
        if result["has_table"]:
            flags.append("含表格")
        if not result["has_h1"]:
            flags.append("缺一级标题")
        rate = result["example_rate"]
        if rate is not None and rate < 0.9:
            flags.append(f"例句可追溯率 {rate}")
        problems += len(flags)
        print(
            f"{result['file']}\t{result['chars']}字\t{result['sections']}节\t"
            f"例句 {result['example_hit']}/{result['examples']}\t"
            + ("; ".join(flags) if flags else "通过")
        )
        for miss in result["example_misses"][:3]:
            print(f"    未命中例句: {miss[:40]}")

    print(f"\n合计 {len(files)} 份，问题项 {problems}")


if __name__ == "__main__":
    main()
