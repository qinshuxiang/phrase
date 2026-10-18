#!/usr/bin/env python3
"""把课程录屏批量转成中文纯文本逐字稿（不含时间轴）。

流水线：ffmpeg 切块（带重叠）→ mlx-whisper 转写 → 重叠区对齐拼接 → 幻觉剔除 → 标点规范。

用法示例：
    python transcribe.py --list
    python transcribe.py --all
    python transcribe.py --file 20260805言语1000词14-杨杨 --parts 0
    python transcribe.py --file 20260805言语1000词14-杨杨 --force

设计要点：
- 同一个进程内串行处理全部分块，模型只加载一次。
- 每块转写完成后立即落盘，中断后可用 --resume（默认）续跑。
- wav 与转写结果都按视频名分目录存放，互不干扰。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------- 路径与常量

ROOT = Path(__file__).resolve().parent.parent          # 逐字稿/
VIDEO_DIR = ROOT.parent                                 # 视频/
WORK = ROOT / "_work"
ASR_DIR = WORK / "asr"
AUDIO_DIR = WORK / "audio"
RAW_DIR = WORK / "raw"
STATE_DIR = WORK / "state"
LOG_DIR = WORK / "logs"
MANIFEST = ROOT / "_tools" / "manifest.json"

FFMPEG = shutil.which("ffmpeg") or "/Users/siluhao/.local/bin/ffmpeg"
FFPROBE = shutil.which("ffprobe") or "/Users/siluhao/.local/bin/ffprobe"

MODEL_REPO = "mlx-community/whisper-large-v3-turbo"
MODEL_LOCAL = ROOT / "_tools" / "models" / "whisper-large-v3-turbo"

# 领域提示词：只用于引导简体、全角标点与术语写法，不作为内容来源。
BASE_PROMPT = (
    "四海公考，公务员考试，言语理解与表达，逻辑填空，高频实词，成语辨析，"
    "语义侧重，感情色彩，搭配对象，适用语境，易混词，例句。简体中文。"
)

# 已知的 Whisper 幻觉句（字幕组、片尾告别等），整句剔除。
HALLUCINATION_PATTERNS = [
    r"字幕由.{0,12}(提供|制作)",
    r"(请)?(点赞|订阅|投币|转发|收藏)",
    r"(谢谢|感谢)(大家)?(观看|收看|收听)",
    r"(下期|下集|我们下期)再见",
    r"明镜与点点",
    r"本字幕",
    r"打赏",
]

PUNCT_MAP = {
    ",": "，", "?": "？", "!": "！", ":": "：", ";": "；",
    "(": "（", ")": "）", "、": "、",
}


# ---------------------------------------------------------------- 基础工具


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    """执行外部命令；失败时抛出带 stderr 尾部的异常。"""
    proc = subprocess.run(cmd, capture_output=True, text=True, **kwargs)
    if proc.returncode != 0:
        raise RuntimeError(
            f"命令失败({proc.returncode}): {' '.join(map(str, cmd))}\n{proc.stderr[-800:]}"
        )
    return proc


def probe_duration(path: Path) -> float:
    """读取媒体文件时长（秒）。"""
    proc = run([
        FFPROBE, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(path),
    ])
    return float(proc.stdout.strip())


def probe_audio(path: Path) -> dict:
    """读取音频流参数，供切块后校验。"""
    proc = run([
        FFPROBE, "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=sample_rate,channels,codec_name",
        "-of", "json", str(path),
    ])
    streams = json.loads(proc.stdout or "{}").get("streams", [])
    return streams[0] if streams else {}


def load_json(path: Path, default):
    """读 JSON，缺失或损坏时返回默认值。"""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path: Path, data) -> None:
    """写 JSON，自动建父目录。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def log(msg: str) -> None:
    """带时间戳输出，flush 以便后台日志实时可读。"""
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- manifest

NAME_RE = re.compile(r"^(\d{8})(.+?)(\d+)-(.+)$")


def parse_name(stem: str) -> dict:
    """从文件名解析日期、课型、讲次、是否加课、教师。

    （加课）可能出现在课型后，也可能出现在教师后，统一识别并在教师名中去掉。
    """
    extra = "（加课）" in stem
    cleaned = stem.replace("（加课）", "")
    m = NAME_RE.match(cleaned)
    if not m:
        return {"date": "", "course": "", "seq": "", "extra": extra, "teacher": ""}
    date, course, seq, teacher = m.groups()
    return {
        "date": date,
        "course": course,
        "seq": int(seq),
        "extra": extra,
        "teacher": teacher,
    }


def build_manifest(force: bool = False) -> list[dict]:
    """扫描视频目录生成 manifest，记录时长等不可由模型编造的事实。"""
    existing = {item["stem"]: item for item in load_json(MANIFEST, {"items": []})["items"]}
    items = []
    extensions = {".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm", ".flv", ".wmv", ".ts", ".mpeg", ".mpg"}
    videos = sorted(p for p in VIDEO_DIR.rglob("*")
                    if p.is_file() and p.suffix.lower() in extensions and ROOT not in p.parents)
    for video in videos:
        stem = video.stem
        cached = existing.get(stem)
        if cached and not force and cached.get("duration", 0) > 0:
            items.append(cached)
            continue
        meta = parse_name(stem)
        items.append({
            "stem": stem,
            "file": str(video.relative_to(VIDEO_DIR)),
            "bytes": video.stat().st_size,
            "duration": round(probe_duration(video), 3),
            **meta,
        })
        log(f"探测 {stem} {items[-1]['duration']:.0f}s")
    save_json(MANIFEST, {"generated_at": time.strftime("%Y-%m-%d %H:%M"), "items": items})
    return items


# ---------------------------------------------------------------- 切块


def plan_parts(total: float, chunk: int, overlap: int) -> list[dict]:
    """按时长规划分块：固定步长、块间重叠，末块截到片尾。

    返回 [{index, start, duration}]，保证并集覆盖 [0, total] 且最后一块正好结束。
    """
    stride = chunk - overlap
    parts, index = [], 0
    start = 0.0
    while start < total - 0.5:
        duration = min(chunk, total - start)
        parts.append({"index": index, "start": round(start, 3), "duration": round(duration, 3)})
        index += 1
        if start + duration >= total - 0.5:
            break
        start += stride
    return parts


def fingerprint(args, model: str) -> str:
    """参数指纹：参数变化时拒绝续跑，避免混用不同设置的半成品。"""
    raw = json.dumps({"chunk": args.chunk, "overlap": args.overlap,
                      "model": model, "lang": args.lang,
                      "vocabulary": getattr(args, "course_vocabulary", {})}, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def extract_wav(video: Path, target: Path, part: dict, chunk: int) -> None:
    """切出目标分块的 16 kHz 单声道 wav；已存在且时长正确则跳过。"""
    if target.exists():
        try:
            if abs(probe_duration(target) - part["duration"]) < 0.5:
                return
        except RuntimeError:
            pass
    target.parent.mkdir(parents=True, exist_ok=True)
    run([
        FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "2",
        "-ss", f"{part['start']:.3f}", "-t", f"{part['duration']:.3f}",
        "-i", str(video), "-map", "0:a:0", "-vn", "-sn", "-dn",
        "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", str(target),
    ])


# ---------------------------------------------------------------- 文本处理


def clean_segments(segments: list[dict]) -> tuple[list[dict], list[dict]]:
    """A/C 级过滤：丢弃静音误判段与已知幻觉句，保留的记录被丢弃原因。"""
    kept, dropped = [], []
    for seg in segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        if seg.get("no_speech_prob", 0) > 0.6 and seg.get("avg_logprob", 0) < -1.0:
            dropped.append({"reason": "A_silence", "text": text})
            continue
        # 课堂可能确实说到“收藏”“谢谢观看”等，保留原句供后续核对。
        kept.append(seg)
    return kept, dropped


def normalize_punct(text: str) -> str:
    """半角标点转全角，合并连续标点，去掉汉字之间的多余空格。"""
    for src, dst in PUNCT_MAP.items():
        text = text.replace(src, dst)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"(?<=[\u4e00-\u9fff]) (?=[\u4e00-\u9fff])", "", text)
    text = re.sub(r"[，。！？；：、]{2,}", lambda m: m.group(0)[0], text)
    return text.strip()


def split_sentences(text: str) -> list[str]:
    """按中文句末标点切句，保留标点。"""
    parts = re.findall(r"[^。！？；\n]+[。！？；]?", text)
    return [p.strip() for p in parts if p.strip()]


def dedupe_repeats(text: str) -> tuple[str, list[dict]]:
    """B 级过滤：去掉机械复读（同句连续 3 次以上、短句高频重复），保留合理复述。"""
    sentences = split_sentences(text)
    kept, dropped = [], []
    run_len, last = 0, None
    recent: dict[str, int] = {}
    for sent in sentences:
        key = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", sent)
        if key and key == last:
            run_len += 1
            if run_len >= 2:                      # 第 3 次起丢弃
                dropped.append({"reason": "B_repeat", "text": sent})
                continue
        else:
            run_len, last = 0, key
        if len(key) >= 12:
            recent[key] = recent.get(key, 0) + 1
            if recent[key] >= 4:                  # 同一长句第 4 次出现视为复读
                dropped.append({"reason": "B_repeat_long", "text": sent})
                continue
        kept.append(sent)
    return "".join(kept), dropped


def norm_with_map(text: str) -> tuple[str, list[int]]:
    """生成仅含汉字/字母/数字的归一化串，以及每个字符在原文中的下标。"""
    chars, index = [], []
    for i, ch in enumerate(text):
        if "\u4e00" <= ch <= "\u9fff" or ch.isalnum():
            chars.append(ch)
            index.append(i)
    return "".join(chars), index


def longest_common_substring(a: str, b: str) -> tuple[int, int, int]:
    """最长公共子串，返回 (长度, a 中结束下标, b 中结束下标)，均为 1 基。"""
    if not a or not b:
        return 0, 0, 0
    prev = [0] * (len(b) + 1)
    best = (0, 0, 0)
    for i in range(1, len(a) + 1):
        cur = [0] * (len(b) + 1)
        ai = a[i - 1]
        for j in range(1, len(b) + 1):
            if ai == b[j - 1]:
                cur[j] = prev[j - 1] + 1
                if cur[j] > best[0]:
                    best = (cur[j], i, j)
        prev = cur
    return best


def overlap_cut(prev_text: str, next_text: str) -> int:
    """求后一块开头与前一末尾重复的字符数，用于裁掉重复。

    先试精确的“后缀==前缀”，失败再用最长公共子串兜底；都不够长则返回 0（不猜）。
    """
    a, idx_a = norm_with_map(prev_text[-200:])
    b, idx_b = norm_with_map(next_text[:200])
    if not a or not b:
        return 0
    for k in range(min(len(a), len(b), 120), 7, -1):
        if a[-k:] == b[:k]:
            return idx_b[k - 1] + 1
    length, _, end_b = longest_common_substring(a, b)
    if length >= 12 and end_b <= 100:
        return idx_b[end_b - 1] + 1
    return 0


# ---------------------------------------------------------------- 转写


def transcribe_part(model_path: str, wav: Path, prompt: str, lang: str) -> dict:
    """转写单个分块，返回 segments 与文本。参数按 8GB 内存与中文课堂取舍。"""
    import mlx_whisper

    kwargs = dict(
        path_or_hf_repo=model_path,
        language=lang,
        initial_prompt=prompt,
        condition_on_previous_text=False,   # 关掉错误级联与复读
        word_timestamps=False,              # 不要时间轴
        verbose=None,
        temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
        compression_ratio_threshold=2.4,
        logprob_threshold=-1.0,
        no_speech_threshold=0.6,
    )
    try:
        result = mlx_whisper.transcribe(str(wav), hallucination_silence_threshold=2.0, **kwargs)
    except TypeError:
        result = mlx_whisper.transcribe(str(wav), **kwargs)
    # 避免开启第二个模型进程：在已加载模型中串行重识别明确的乱码、机械复读。
    def anomaly_score(text):
        return (text.count("�") * 3
                + len(re.findall(r"[\u0370-\u052f\u0600-\u06ff]", text)) * 5
                + len(re.findall(r"(.)\1{8,}", text)) * 20
                + len(re.findall(r"(.{2,5})(?:[�，,、 ]*\1){5,}", text)) * 20)

    repairs = []
    audio = None
    for index, seg in enumerate(result.get("segments", [])):
        old_text = seg.get("text", "")
        if anomaly_score(old_text) < 9:
            continue
        if audio is None:
            from mlx_whisper.audio import load_audio
            audio = load_audio(str(wav))
        start, end = seg.get("start", 0), seg.get("end", 0)
        if end <= start:
            continue
        retry_options = {**kwargs, "temperature": 0.0, "condition_on_previous_text": True}
        context = "".join(s.get("text", "") for s in result["segments"][max(0, index-3):index])[-60:]
        retry_options["initial_prompt"] = prompt + context
        retried = mlx_whisper.transcribe(audio[int(start*16000):int(end*16000)], **retry_options)
        new_text = retried.get("text", "")
        accepted = bool(new_text.strip()) and anomaly_score(new_text) < anomaly_score(old_text)
        repairs.append({"start": start, "end": end, "old_text": old_text,
                        "new_text": new_text, "accepted": accepted})
        if accepted:
            seg["text"] = new_text
            new_segments = retried.get("segments", [])
            if new_segments:
                for key in ("avg_logprob", "no_speech_prob", "compression_ratio"):
                    seg[key] = sum(s.get(key, 0) for s in new_segments) / len(new_segments)
        log(f"    异常片段重识别 {start:.1f}-{end:.1f}s: {'采用新结果' if accepted else '保留原结果，待审校'}")
    segments = [
        {
            "text": s.get("text", ""),
            "start": s.get("start", 0),
            "end": s.get("end", 0),
            "no_speech_prob": round(s.get("no_speech_prob", 0), 4),
            "avg_logprob": round(s.get("avg_logprob", 0), 4),
            "compression_ratio": round(s.get("compression_ratio", 0), 4),
        }
        for s in result.get("segments", [])
    ]
    return {"text": "".join(s["text"] for s in segments), "segments": segments, "repairs": repairs}


def process_video(item: dict, args, model_path: str) -> dict:
    """处理单个视频：切块 → 逐块转写（可续）→ 合并清洗 → 写 asr 文本。"""
    stem = item["stem"]
    video = VIDEO_DIR / item["file"]
    parts = plan_parts(item["duration"], args.chunk, args.overlap)
    fp = fingerprint(args, model_path)

    state_path = STATE_DIR / f"{stem}.json"
    state = load_json(state_path, {})
    if state.get("fingerprint") not in (None, fp) and not args.force:
        raise SystemExit(f"{stem}: 参数指纹不一致，确认后加 --force 重跑")
    state = {"stem": stem, "fingerprint": fp, "parts": state.get("parts", {})}
    state["parts"] = {str(p["index"]): state["parts"].get(str(p["index"]), {"transcribe": "pending"})
                      for p in parts}

    wanted = set(args.parts) if args.parts else {p["index"] for p in parts}
    prev_text = ""
    merged, dropped_all, stats = "", [], []
    started = time.time()

    for part in parts:
        idx = part["index"]
        wav = AUDIO_DIR / stem / f"part-{idx:03d}.wav"
        raw_path = RAW_DIR / stem / f"part-{idx:03d}.json"

        record = load_json(raw_path, None) if raw_path.exists() else None
        if idx in wanted and (not record or args.force or not record.get("ok")):
            extract_wav(video, wav, part, args.chunk)
            info = probe_audio(wav)
            if info.get("sample_rate") != "16000" or info.get("channels") != 1:
                raise RuntimeError(f"{wav.name}: 音频参数异常 {info}")

        if idx not in wanted or (record and not args.force and record.get("ok")):
            pass
        else:
            prompt = BASE_PROMPT
            vocabulary = getattr(args, "course_vocabulary", {}).get(stem, [])
            if vocabulary:
                slides_path = WORK / "ocr" / stem / "slides.jsonl"
                nearby = []
                if slides_path.exists():
                    for line in slides_path.read_text().splitlines():
                        slide = json.loads(line)
                        second = int(Path(slide["image"]).stem)
                        if part["start"] - 180 <= second <= part["start"] + part["duration"] + 180:
                            nearby.extend(slide["lines"])
                slide_text = "".join(nearby)
                terms = [word for word in vocabulary if word in slide_text]
                if not terms:
                    terms = vocabulary[:24]
                prompt += "课件词条：" + "，".join(terms[:30]) + "。"
            t0 = time.time()
            record = transcribe_part(model_path, wav, prompt, args.lang)
            elapsed = time.time() - t0
            record.update({"index": idx, "start": part["start"], "duration": part["duration"],
                           "elapsed": round(elapsed, 1), "ok": True, "initial_prompt": prompt})
            save_json(raw_path, record)
            state["parts"][str(idx)] = {"transcribe": "done"}
            save_json(state_path, state)
            log(f"  {stem} 块{idx:02d} {elapsed:.0f}s ({part['duration']/max(elapsed,1):.1f}x)")

        if not record:
            continue
        kept, dropped = clean_segments(record.get("segments", []))
        part_text = normalize_punct("".join(s["text"] for s in kept))
        dropped_all.extend(dropped)
        if args.overlap and prev_text and merged:
            cut = overlap_cut(prev_text, part_text)
            part_text = part_text[cut:]
            if not cut:
                dropped_all.append({"reason": "OVERLAP_UNALIGNED", "text": part_text[:40]})
        merged += part_text
        prev_text = merged[-120:]
        stats.append({"index": idx, "chars": len(part_text)})

    # 逐字稿保留课堂重复，不将正常复述当成模型复读直接删除。
    ASR_DIR.mkdir(parents=True, exist_ok=True)
    out = ASR_DIR / f"{stem}.txt"
    out.write_text(merged, encoding="utf-8")

    if not args.keep_wav:
        shutil.rmtree(AUDIO_DIR / stem, ignore_errors=True)

    summary = {
        "stem": stem,
        "duration": item["duration"],
        "chars": len(merged),
        "chars_per_min": round(len(merged) / max(item["duration"] / 60, 1e-6), 1),
        "parts": len(parts),
        "completed_parts": len(stats),
        "complete": len(stats) == len(parts),
        "dropped": len(dropped_all),
        "elapsed": round(time.time() - started, 1),
        "asr": str(out),
    }
    save_json(WORK / "stats" / f"{stem}.json", summary)
    save_json(WORK / "qc" / f"{stem}.dropped.json", dropped_all)
    if summary["complete"]:
        from opencc import OpenCC
        text = OpenCC("t2s").convert(merged)
        paragraphs, paragraph = [], ""
        for sentence in split_sentences(text):
            paragraph += sentence
            if len(paragraph) >= 240:
                paragraphs.append(paragraph)
                paragraph = ""
        if paragraph:
            paragraphs.append(paragraph)
        delivery = ROOT / "初转逐字稿" / f"{stem}.txt"
        delivery.parent.mkdir(parents=True, exist_ok=True)
        delivery.write_text("\n\n".join(paragraphs) + "\n", encoding="utf-8")
    log(f"完成 {stem}: {len(merged)} 字 / {summary['chars_per_min']} 字每分钟 / 丢弃 {len(dropped_all)} 段")
    return summary


# ---------------------------------------------------------------- 入口


def parse_parts(spec: str | None) -> list[int] | None:
    """解析 --parts，支持 "0" / "0-3" / "0,2,5"。"""
    if not spec:
        return None
    out: list[int] = []
    for chunk in spec.split(","):
        if "-" in chunk:
            a, b = chunk.split("-", 1)
            out.extend(range(int(a), int(b) + 1))
        else:
            out.append(int(chunk))
    return sorted(set(out))


def main() -> None:
    parser = argparse.ArgumentParser(description="课程录屏转中文逐字稿")
    parser.add_argument("--all", action="store_true", help="处理全部视频")
    parser.add_argument("--file", help="只处理指定视频（不含扩展名）")
    parser.add_argument("--parts", help="只处理指定分块，如 0 或 0-3")
    parser.add_argument("--chunk", type=int, default=900, help="分块秒数，默认 900")
    parser.add_argument("--overlap", type=int, default=15, help="块间重叠秒数，默认 15")
    parser.add_argument("--lang", default="zh")
    parser.add_argument("--model", default=str(MODEL_LOCAL) if MODEL_LOCAL.exists() else MODEL_REPO)
    parser.add_argument("--force", action="store_true", help="忽略已有结果重跑")
    parser.add_argument("--keep-wav", action="store_true", help="保留切块音频")
    parser.add_argument("--list", action="store_true", help="只打印 manifest")
    parser.add_argument("--remanifest", action="store_true", help="重新探测时长")
    parser.add_argument("--vocab", help="实际课件中的已校正词表 JSON，用于同音词识别")
    parser.add_argument("--skip-complete", action="store_true", help="保留已经完整转写的讲次")
    args = parser.parse_args()
    args.course_vocabulary = load_json(Path(args.vocab), {}) if args.vocab else {}

    for d in (WORK / "asr", WORK / "audio", WORK / "raw", WORK / "state",
              WORK / "logs", WORK / "stats", WORK / "qc"):
        d.mkdir(parents=True, exist_ok=True)

    args.parts = parse_parts(args.parts)
    items = build_manifest(force=args.remanifest)

    if args.list:
        for it in items:
            print(f"{it['stem']}\t{it['duration']/60:.1f}min\t{it['teacher']}")
        return

    if args.file:
        items = [it for it in items if it["stem"] == args.file]
        if not items:
            raise SystemExit(f"找不到视频: {args.file}")
    elif not args.all:
        raise SystemExit("请指定 --all 或 --file <名称>，先 --list 查看清单")

    model_path = args.model
    if Path(model_path).exists():
        model_path = str(Path(model_path).resolve())

    summaries = []
    for item in items:
        cached_summary = load_json(WORK / "stats" / f"{item['stem']}.json", {})
        if args.skip_complete and cached_summary.get("complete"):
            log(f"保留已完成 {item['stem']}")
            summaries.append(cached_summary)
            continue
        log(f"开始 {item['stem']}（{item['duration']/60:.1f} 分钟）")
        summaries.append(process_video(item, args, model_path))

    log("全部完成")
    for s in summaries:
        log(f"  {s['stem']}: {s['chars']} 字, {s['chars_per_min']} 字/分钟")


if __name__ == "__main__":
    main()
