"""生成术语校对候选和内部审校稿；完成逐篇阅读后才发布润色稿。"""
import argparse
import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path

from pypinyin import lazy_pinyin
from punctuate import paragraphs

ROOT = Path(__file__).resolve().parent.parent

@lru_cache(None)
def pronunciation(char):
    return lazy_pinyin(char)[0]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("stem")
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    config_path = ROOT / "_work/review" / f"{args.stem}.json"
    config = json.loads(config_path.read_text())
    source = ROOT / "初转逐字稿" / f"{args.stem}.txt"
    original = source.read_text()
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    text = original
    if config.get("end_before"):
        end = text.find(config["end_before"])
        if end < 0:
            raise RuntimeError("未找到经确认的片尾非授课内容起点")
        text = text[:end].rstrip("，。！？\n ") + "。"
    edits = []
    pronunciations = {}
    for term in config.get("terms", []):
        key = tuple(pronunciation(c) for c in term)
        pronunciations.setdefault(key, set()).add(term)
    replacements = {}
    for length in {len(t) for t in config.get("terms", []) if len(t) >= 4}:
        for run in re.findall(r"[\u4e00-\u9fff]+", text):
            for i in range(len(run)-length+1):
                old = run[i:i+length]
                candidates = pronunciations.get(tuple(pronunciation(c) for c in old), set())
                if len(candidates) == 1:
                    new = next(iter(candidates))
                    if new != old:
                        replacements[old] = new
    for old, new in replacements.items():
        count = text.count(old)
        text = text.replace(old, new)
        edits.append({"from": old, "to": new, "count": count, "reason": "同音词候选，需逐篇审校"})
    for old, new in config.get("replacements", []):
        count = text.count(old)
        if count:
            text = text.replace(old, new)
            edits.append({"from": old, "to": new, "count": count, "reason": "AI结合课件和上下文校对"})
    for pattern, replacement in config.get("regex_replacements", []):
        text, count = re.subn(pattern, replacement, text)
        if count:
            edits.append({"pattern": pattern, "to": replacement, "count": count,
                          "reason": "AI识别的局部乱码或机械复读，无法还原处明确标记"})
    # 只清理独立语气词和紧邻重复，保留教学内容及正常复述。
    text = re.sub(r"(?<=[，。！？])(?:啊|呃|嗯|哎|唉|诶)[，。！？]", "", text)
    text = re.sub(r"[啊呀呗嘛](?=[，。！？])", "", text)
    text = re.sub(r"[，。]?(?:对吧|没问题吧|明白了吧)[，。！？]?", "。", text)
    text = re.sub(r"[，。！？]{2,}", lambda m: m.group(0)[-1], text)
    text = re.sub(r"(?<=[，。！？])(?:好，){2,}", "好，", text)
    for term in config.get("terms", []):
        if len(term) >= 4:
            text = text.replace(term + term, term)
            text = text.replace(term + "，" + term, term)
    prelude = ""
    if config.get("start_at"):
        split = text.find(config["start_at"])
        if split < 0:
            raise RuntimeError("未找到经确认的正式授课起点")
        prelude = config.get("prelude", "［课前音乐及交流保留在对应初转稿中，以下为正式授课内容。］")
        text = text[split:]
    text = paragraphs(text)
    if prelude:
        text = prelude + "\n\n" + text
    for old, new in config.get("final_replacements", []):
        text = text.replace(old, new)
    draft = ROOT / "_work/review-drafts" / f"{args.stem}.txt"
    draft.parent.mkdir(parents=True, exist_ok=True)
    draft.write_text(text)
    report = {"source_sha256": digest, "draft_sha256": hashlib.sha256(text.encode()).hexdigest(),
              "source_chars": len(original), "draft_chars": len(text), "changes": edits}
    report_path = ROOT / "_work/review" / f"{args.stem}.changes.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    if args.publish:
        if config.get("reviewed_source_sha256") != digest or not config.get("review_complete"):
            raise RuntimeError("尚未完成该稿的全文 AI 审校，或初转源文件已变化")
        target = ROOT / "润色逐字稿" / f"{args.stem}.txt"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        print(target)
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        print(draft)

if __name__ == "__main__":
    main()
