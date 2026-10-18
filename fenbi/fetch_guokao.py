#!/usr/bin/env python3
"""下载粉笔行测历年真题 PDF。

依赖环境变量 FENBI_COOKIE，值为浏览器里的完整 Cookie 请求头。
用法：FENBI_COOKIE='...' python3 fetch_guokao.py [labelId] [名称] [pageSize]
不带参数时默认下载「国考」(labelId=1)。
"""

import os
import sys
import time

import requests

LABEL_ID = int(sys.argv[1]) if len(sys.argv) > 1 else 1
LABEL_NAME = sys.argv[2] if len(sys.argv) > 2 else "国考"
PAGE_SIZE = int(sys.argv[3]) if len(sys.argv) > 3 else 36

BASE_PARAMS = {
    "app": "web",
    "kav": "100",
    "av": "100",
    "hav": "100",
    "version": "3.0.0.0",
}

HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Origin": "https://www.fenbi.com",
    "Referer": "https://www.fenbi.com/",
}


def build_session():
    cookie = os.environ.get("FENBI_COOKIE", "").strip()
    cookie_file = os.environ.get("FENBI_COOKIE_FILE", "").strip()
    if not cookie and cookie_file:
        with open(cookie_file, encoding="utf-8") as f:
            cookie = f.read().strip()
    if not cookie:
        sys.exit("缺少 FENBI_COOKIE 或 FENBI_COOKIE_FILE")
    s = requests.Session()
    s.headers.update(HEADERS)
    s.headers["Cookie"] = cookie
    return s


def list_papers(s, label_id, page_size):
    """返回试卷列表，每项含 id/name/exercise。失败时抛异常。"""
    params = dict(BASE_PARAMS, toPage="0", pageSize=str(page_size),
                  labelId=str(label_id), hav="1")
    r = s.get("https://tiku.fenbi.com/api/xingce/papers/", params=params, timeout=30)
    if r.status_code == 401:
        sys.exit("鉴权失败(401)：Cookie 无效或已过期")
    r.raise_for_status()
    return r.json().get("list") or []


def ensure_exercise(s, paper, max_tries=6):
    """拿到试卷对应的练习 id，没有则创建。

    创建接口有频控（403 + "您创建练习的频率过高"），按 15/30/45/60/90 秒退避重试。
    """
    exercise = paper.get("exercise") or {}
    if exercise.get("id"):
        return exercise.get("id")
    form = {"type": "1", "paperId": paper.get("id"), "exerciseTimeMode": "2"}
    params = dict(BASE_PARAMS, hav="1")

    for attempt in range(1, max_tries + 1):
        r = s.post("https://tiku.fenbi.com/api/xingce/exercises",
                   params=params, data=form, timeout=30)
        if r.status_code == 200:
            return r.json().get("id")
        if r.status_code == 403 and "频率过高" in r.text:
            wait = 15 * attempt if attempt < max_tries else None
            if wait is None:
                break
            print("    限流，等待 %ds 后重试（第 %d 次）" % (wait, attempt))
            time.sleep(wait)
            continue
        r.raise_for_status()
    raise RuntimeError("创建练习失败：%s" % r.text[:120])


def download(s, exercise_id, path):
    url = "https://urlimg.fenbi.com/api/pdf/tiku/xingce/exercise/" + str(exercise_id)
    r = s.get(url, params=BASE_PARAMS, timeout=60)
    r.raise_for_status()
    if not r.content.startswith(b"%PDF"):
        raise RuntimeError("返回内容不是 PDF，长度 %d" % len(r.content))
    with open(path, "wb") as f:
        f.write(r.content)
    return len(r.content)


def main():
    s = build_session()
    papers = list_papers(s, LABEL_ID, PAGE_SIZE)
    print("试卷数：%d" % len(papers))
    os.makedirs(LABEL_NAME, exist_ok=True)

    ok = fail = 0
    for i, p in enumerate(papers, 1):
        name = (p.get("name") or "未命名").replace("/", "_")
        path = os.path.join(LABEL_NAME, name + ".pdf")
        if os.path.exists(path) and os.path.getsize(path) > 1024:
            print("[%02d/%d] 跳过(已存在) %s" % (i, len(papers), name))
            ok += 1
            continue
        try:
            ex_id = ensure_exercise(s, p)
            size = download(s, ex_id, path)
            print("[%02d/%d] OK %6.1fKB %s" % (i, len(papers), size / 1024, name))
            ok += 1
        except Exception as e:  # 单份失败不中断整批
            print("[%02d/%d] FAIL %s -> %s" % (i, len(papers), name, e))
            fail += 1
        time.sleep(1.5)

    print("完成：成功 %d，失败 %d" % (ok, fail))


if __name__ == "__main__":
    main()
