#!/usr/bin/env python3
"""配额恢复后自动续传粉笔真题。

服务端按账号限制「生成 PDF / 创建练习」的频率，超过阈值返回 403
"您创建练习的频率过高，请稍候再试"。本脚本对缺失的试卷循环探测，
一旦放行就落盘，已存在文件跳过，可随时中断重跑。

用法：FENBI_COOKIE_FILE=/tmp/fb_cookie.txt python3 resume_download.py 23 山西 21
"""

import os
import sys
import time

import requests

import fetch_guokao as fb

RETRY_WAIT = 90          # 受限后等待秒数
MAX_MINUTES = 90         # 总等待上限


def pdf_via_paper(s, paper_id, path):
    """直接用 paperId 取 PDF。返回 True 表示已成功落盘。"""
    url = "https://urlimg.fenbi.com/api/pdf/tiku/xingce/paper/" + str(paper_id)
    r = s.get(url, params=fb.BASE_PARAMS, timeout=90)
    if r.status_code == 403:
        return None      # 受限，稍后再试
    if r.status_code == 200 and r.content.startswith(b"%PDF"):
        with open(path, "wb") as f:
            f.write(r.content)
        return True
    return False         # 该路由不可用，回退到练习路由


def main():
    label_id = int(sys.argv[1])
    name_dir = sys.argv[2]
    page_size = int(sys.argv[3]) if len(sys.argv) > 3 else 40

    s = fb.build_session()
    papers = fb.list_papers(s, label_id, page_size)
    os.makedirs(name_dir, exist_ok=True)
    todo = []
    for p in papers:
        name = (p.get("name") or "未命名").replace("/", "_")
        path = os.path.join(name_dir, name + ".pdf")
        if os.path.exists(path) and os.path.getsize(path) > 1024:
            continue
        todo.append((p, path))
    print("待下载 %d 份" % len(todo), flush=True)
    if not todo:
        return

    deadline = time.time() + MAX_MINUTES * 60
    while todo and time.time() < deadline:
        for item in list(todo):
            p, path = item
            label = (p.get("name") or "")[:30]
            try:
                got = pdf_via_paper(s, p.get("id"), path)
                if got:
                    print("OK  %s (%.1fMB)" % (label, os.path.getsize(path) / 1048576), flush=True)
                    todo.remove(item)
                    time.sleep(2)
                    continue
                if got is None:
                    print("... 受限 %s" % label, flush=True)
                    break      # 受限时不再继续消耗，整轮退避
                ex_id = fb.ensure_exercise(s, p)
                size = fb.download(s, ex_id, path)
                print("OK(练习路由) %s %.1fMB" % (label, size / 1048576), flush=True)
                todo.remove(item)
            except Exception as e:
                print("ERR %s -> %s" % (label, e), flush=True)
        if todo:
            time.sleep(RETRY_WAIT)

    print("剩余 %d 份未完成" % len(todo), flush=True)


if __name__ == "__main__":
    main()
