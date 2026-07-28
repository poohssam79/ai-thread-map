#!/usr/bin/env python3
"""Threads Graph API로 텍스트 글을 발행한다.

사용법:
    export THREADS_USER_ID=xxxx
    export THREADS_ACCESS_TOKEN=xxxx
    python post.py "발행할 글 내용"
"""
import os
import sys
import time
import urllib.parse
import urllib.request
import json

GRAPH_BASE = "https://graph.threads.net/v1.0"


def _post(url: str, params: dict) -> dict:
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def create_text_container(user_id: str, token: str, text: str) -> str:
    url = f"{GRAPH_BASE}/{user_id}/threads"
    result = _post(url, {
        "media_type": "TEXT",
        "text": text,
        "access_token": token,
    })
    return result["id"]


def publish_container(user_id: str, token: str, creation_id: str) -> dict:
    url = f"{GRAPH_BASE}/{user_id}/threads_publish"
    return _post(url, {
        "creation_id": creation_id,
        "access_token": token,
    })


def main():
    if len(sys.argv) < 2:
        print("사용법: python post.py \"발행할 글 내용\"", file=sys.stderr)
        sys.exit(1)

    text = sys.argv[1]
    user_id = os.environ.get("THREADS_USER_ID")
    token = os.environ.get("THREADS_ACCESS_TOKEN")

    if not user_id or not token:
        print("THREADS_USER_ID / THREADS_ACCESS_TOKEN 환경변수가 필요합니다.", file=sys.stderr)
        sys.exit(1)

    creation_id = create_text_container(user_id, token, text)
    print(f"컨테이너 생성 완료: {creation_id}")

    # Threads API는 컨테이너 생성 직후 바로 발행하면 실패할 수 있어 약간의 대기가 필요하다.
    time.sleep(2)

    result = publish_container(user_id, token, creation_id)
    print(f"발행 완료: {result}")


if __name__ == "__main__":
    main()
