"""抽取实际课件画面用于术语核对，OCR 内容不写入逐字稿正文。"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
items = json.loads((ROOT / "_tools/manifest.json").read_text())["items"]
if len(sys.argv) > 1:
    items = [x for x in items if x["stem"] == sys.argv[1]]
for item in items:
    target = ROOT / "_work/ocr" / item["stem"]
    target.mkdir(parents=True, exist_ok=True)
    output = target / "slides.jsonl"
    if output.exists():
        continue
    images = []
    for second in range(300, int(item["duration"]), 180):
        image = target / f"{second:05d}.jpg"
        if not image.exists():
            subprocess.run([
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                "-threads", "1", "-ss", str(second), "-i", str(ROOT.parent / item["file"]),
                "-frames:v", "1", "-vf", "scale=1280:-1", "-q:v", "4", "-y", str(image)
            ], check=True)
        images.append(str(image))
    with output.open("w") as out:
        subprocess.run([str(ROOT / "_tools/ocr"), *images], stdout=out, check=True)
    print(item["stem"], len(images), "frames", flush=True)
