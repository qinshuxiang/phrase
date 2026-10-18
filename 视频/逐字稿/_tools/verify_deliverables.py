"""检查每个视频的分块覆盖、交付文件、审校源哈希及时间轴残留。"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
items = json.loads((ROOT / "_tools/manifest.json").read_text())["items"]
results = []
for item in items:
    stem = item["stem"]
    errors = []
    raw_paths = sorted(p for p in (ROOT / "_work/raw" / stem).glob("part-*.json")
                       if re.fullmatch(r"part-\d{3}\.json", p.name))
    records = [json.loads(p.read_text()) for p in raw_paths]
    expected_parts = int((item["duration"] + 299.999) // 300)
    if len(records) != expected_parts:
        errors.append("分块数量不全")
    for i, record in enumerate(records):
        if not record.get("ok") or record["index"] != i or abs(record["start"] - i * 300) > 0.01:
            errors.append(f"分块 {i} 状态或起点异常")
        if abs(record["duration"] - min(300, item["duration"] - i * 300)) > 0.01:
            errors.append(f"分块 {i} 时长异常")
    original = ROOT / "初转逐字稿" / f"{stem}.txt"
    polished = ROOT / "润色逐字稿" / f"{stem}.txt"
    count = {}
    for label, path in [("初转", original), ("润色", polished)]:
        if not path.exists() or not path.stat().st_size:
            errors.append(f"缺少{label}稿")
            continue
        text = path.read_text()
        count[label] = len(text)
        if re.search(r"\[?\b\d{1,2}:\d{2}(?::\d{2})?\b", text):
            errors.append(f"{label}稿有时间格式，需核查")
        if label == "润色" and re.search(r"[\ufffd\u0400-\u04ff]", text):
            errors.append("润色稿仍有乱码")
    config_path = ROOT / "_work/review" / f"{stem}.json"
    config = json.loads(config_path.read_text()) if config_path.exists() else {}
    if not config.get("review_complete"):
        errors.append("未完成逐篇审校")
    if original.exists() and config.get("reviewed_source_sha256") != hashlib.sha256(original.read_bytes()).hexdigest():
        errors.append("审校源哈希不一致")
    check_path = ROOT / "_work/punctuation-check" / f"{stem}.json"
    check = json.loads(check_path.read_text()) if check_path.exists() else {}
    if not check.get("content_unchanged"):
        errors.append("未通过标点文字序列检查")
    results.append({"video": item["file"], "duration_seconds": item["duration"],
                    "parts": len(records), "expected_parts": expected_parts,
                    "chars": count, "errors": errors})
report = {"videos": len(items), "duration_seconds": round(sum(i["duration"] for i in items), 3),
          "complete": all(not r["errors"] for r in results), "items": results}
(ROOT / "_work/verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps(report, ensure_ascii=False, indent=2))
if not report["complete"]:
    raise SystemExit(1)
