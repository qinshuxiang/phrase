#!/usr/bin/env python3
"""把题库 JSON 打包成单文件浏览页 题库.html。

数据内嵌进页面，双击即可用 file:// 打开；题目图片按 题库/images/ 的相对路径加载。
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BANK = ROOT / "题库"
TEMPLATE = ROOT / "viewer.html"
TARGET = ROOT / "题库.html"

LABELS = {
    "副省级": "副省级",
    "地市级": "地市级",
    "行政执法卷": "行政执法卷",
    "县级纪委监委": "纪委监委",
    "山西卷": "联考（山西卷）",
    "山西县级+乡镇": "联考（县级+乡镇）",
}


def short_title(exam):
    label = LABELS.get(exam["examType"])
    if label is None:
        label = "省考" if exam["category"] == "山西" else "国考"
    if exam["category"] == "山西":
        return f"{exam['year']} 山西 {label}".replace(" 省考", "")
    return f"{exam['year']} {label}"


def main():
    index = json.loads((BANK / "index.json").read_text(encoding="utf-8"))
    exams = []
    data = {}
    for item in index["exams"]:
        exam = json.loads((BANK / item["file"]).read_text(encoding="utf-8"))
        exams.append({
            "id": item["id"],
            "category": item["category"],
            "year": item["year"],
            "examType": item["examType"],
            "title": item["title"],
            "titleShort": short_title(item),
            "questionCount": item["questionCount"],
            "answered": sum(1 for q in exam["questions"] if q.get("answer")),
            "modules": item["modules"],
        })
        data[item["id"]] = {
            "materials": exam["materials"],
            "questions": [
                {
                    "no": q["no"],
                    "module": q["module"],
                    "material": q["material"],
                    "stem": q["stem"],
                    "options": [{"label": o["label"], "text": o["text"]} for o in q["options"]],
                    "answer": q.get("answer", ""),
                    "explain": q.get("explain", ""),
                }
                for q in exam["questions"]
            ],
        }

    payload = json.dumps({"exams": exams, "data": data}, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("<", "\\u003c")  # 避免提前闭合 script

    html = TEMPLATE.read_text(encoding="utf-8").replace("__DATA__", payload)
    TARGET.write_text(html, encoding="utf-8")
    print(f"{TARGET.name}: {TARGET.stat().st_size / 1024 / 1024:.2f} MB，{len(exams)} 套试卷")


if __name__ == "__main__":
    main()
