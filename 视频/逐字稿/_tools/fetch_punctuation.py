"""下载官方量化标点模型，并核对官方清单中的 SHA-256。"""
import hashlib
from pathlib import Path
import fetch_model

fetch_model.BASE = "https://modelscope.cn/models/iic/punc_ct-transformer_zh-cn-common-vocab272727-onnx/resolve/master/"
fetch_model.TARGET = Path(__file__).resolve().parent / "models/ct-punc"
files = {
    "config.yaml": (810, "a56ec10925b06fa976ad51af373396be2b13e1eb8dc62a5426b5adebaba7071d"),
    "tokens.json": (4207480, "c960ab87bccea4aa15cf49a59f71973c2c330b46668048cd8da253749ec71ee3"),
    "model_quant.onnx": (282752912, "e6cd8399bf7d0e75f8d9af4a107310e1968ecab1d50135e765b8f0265b27a83d"),
}
for name, (size, expected) in files.items():
    fetch_model.download(name, size)
    actual = hashlib.file_digest((fetch_model.TARGET / name).open("rb"), "sha256").hexdigest()
    if actual != expected:
        raise RuntimeError(f"SHA-256 mismatch: {name}: {actual}")
    print(f"SHA-256 OK: {name}", flush=True)
