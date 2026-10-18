#!/usr/bin/env python3
"""从 ModelScope 分段并发下载 mlx-whisper 模型（国内网络比 HF 快）。

只用标准库，下载后按顺序拼接并校验总字节数。
"""

from __future__ import annotations

import concurrent.futures
import os
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://modelscope.cn/models/mlx-community/whisper-large-v3-turbo/resolve/master/"
FILES = {
    "config.json": 268,
    "weights.safetensors": 1613977612,
    "README.md": 359,
    "configuration.json": 64,
    ".gitattributes": 1575,
}
TARGET = Path(__file__).resolve().parent / "models" / "whisper-large-v3-turbo"
THREADS = 16


def fetch_range(url: str, start: int, end: int, out: Path, tries: int = 6) -> int:
    """下载 [start, end] 字节区间到 out，失败重试，返回实际字节数。"""
    want = end - start + 1
    for attempt in range(1, tries + 1):
        got = out.stat().st_size if out.exists() else 0
        if got >= want:
            return got
        req = urllib.request.Request(url, headers={"Range": f"bytes={start + got}-{end}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp, open(out, "ab") as fh:
                while True:
                    block = resp.read(1 << 20)
                    if not block:
                        break
                    fh.write(block)
        except Exception as exc:                       # 网络抖动，续传
            print(f"  重试 {attempt}: {exc}", flush=True)
            time.sleep(2 * attempt)
    return out.stat().st_size if out.exists() else 0


def download(name: str, total: int) -> None:
    """把一个文件切成多段并发下载后拼接。"""
    TARGET.mkdir(parents=True, exist_ok=True)
    final = TARGET / name
    if final.exists() and final.stat().st_size == total:
        print(f"跳过 {name}（已完整）", flush=True)
        return
    if total < 4096:
        fetch_range(BASE + name, 0, total - 1, final)
        print(f"完成 {name} {final.stat().st_size}B", flush=True)
        return

    step = total // THREADS + 1
    jobs = []
    for i in range(THREADS):
        start = i * step
        end = min(start + step - 1, total - 1)
        if start > end:
            break
        jobs.append((start, end, TARGET / f".part-{name}-{i:02d}"))

    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=THREADS) as pool:
        futures = [pool.submit(fetch_range, BASE + name, s, e, p) for s, e, p in jobs]
        done = 0
        for fut in concurrent.futures.as_completed(futures):
            done += fut.result()
            rate = done / max(time.time() - started, 1e-6) / 1e6
            print(f"  {name}: {done/1e6:.0f}/{total/1e6:.0f} MB ({rate:.1f} MB/s)", flush=True)

    with open(final, "wb") as out:
        for _, _, part in jobs:
            with open(part, "rb") as fh:
                while True:
                    block = fh.read(1 << 22)
                    if not block:
                        break
                    out.write(block)
            os.remove(part)

    size = final.stat().st_size
    print(f"完成 {name} {size}B" + ("" if size == total else f"（预期 {total}，不一致）"), flush=True)
    if size != total:
        sys.exit(f"{name} 大小不符，请重跑")


def main() -> None:
    for name, size in FILES.items():
        download(name, size)


if __name__ == "__main__":
    main()
