"""用本地标点模型逐讲恢复标点，核对文字序列未被改写。"""
import argparse
import hashlib
import json
import re
import time
from pathlib import Path

from funasr_onnx import CT_Transformer
from opencc import OpenCC

ROOT = Path(__file__).resolve().parent.parent

def content(text):
    return "".join(c for c in text if c.isalnum())

def prepare(text):
    chars = []
    for i, c in enumerate(text):
        between_numbers = i > 0 and i + 1 < len(text) and text[i-1].isdigit() and text[i+1].isdigit()
        if c in "，。！？；：、!?;" or (c in ".,:" and not between_numbers):
            continue
        chars.append(c)
    return "".join(chars)

def paragraphs(text):
    result, current = [], ""
    for sentence in re.findall(r"[^。！？\n]+[。！？]?", text):
        current += sentence.strip()
        if len(current) >= 200:
            result.append(current)
            current = ""
    if current:
        result.append(current)
    return "\n\n".join(result) + "\n"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--preview", help="对已有分块做内部预览，不标记整讲完成")
    args = parser.parse_args()
    model = CT_Transformer(str(ROOT / "_tools/models/ct-punc"), quantize=True, intra_op_num_threads=2)
    cc = OpenCC("t2s")
    items = json.loads((ROOT / "_tools/manifest.json").read_text())["items"]
    if args.preview:
        records = sorted((ROOT / "_work/raw" / args.preview).glob("part-*.json"))
        text = "".join(json.loads(p.read_text())["text"] for p in records)
        before = cc.convert(text)
        after = model(prepare(before))[0] if before.strip() else ""
        assert content(before) == content(after), "标点恢复改变了文字"
        path = ROOT / "_work/preview" / f"{args.preview}.txt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(paragraphs(after))
        print(path, flush=True)
        return
    while True:
        complete = 0
        for item in items:
            stem = item["stem"]
            state_path = ROOT / "_work/stats" / f"{stem}.json"
            if not state_path.exists() or not json.loads(state_path.read_text()).get("complete"):
                continue
            source = ROOT / "_work/asr" / f"{stem}.txt"
            before = cc.convert(source.read_text())
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            check = ROOT / "_work/punctuation-check" / f"{stem}.json"
            if check.exists() and json.loads(check.read_text()).get("source_sha256") == digest:
                complete += 1
                continue
            started = time.time()
            after = model(prepare(before))[0] if before.strip() else ""
            assert content(before) == content(after), f"{stem}: 标点恢复改变了文字"
            target = ROOT / "初转逐字稿" / f"{stem}.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(paragraphs(after), encoding="utf-8")
            check.parent.mkdir(parents=True, exist_ok=True)
            check.write_text(json.dumps({"source_sha256": digest, "content_unchanged": True,
                                        "chars": len(after), "elapsed": round(time.time()-started, 2)}, ensure_ascii=False, indent=2))
            complete += 1
            print(f"标点完成 {stem}: {len(after)}字", flush=True)
        if not args.watch or complete == len(items):
            return
        time.sleep(10)

if __name__ == "__main__":
    main()
