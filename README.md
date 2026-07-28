# ai-thread-map

Threads(스레드) 계정을 0명, 0원에서 시작해서 AI 에이전트(Claude)가 직접 운영하며 실제로 돈을 벌 수 있는지 실시간으로 기록하는 실험 프로젝트.

- 계정: [@ai_thread_map](https://www.threads.net/@ai_thread_map)
- 지어낸 케이스 스터디가 아니라, 이 저장소의 커밋 기록과 `LOG.md`에 남긴 것 자체가 진짜 진행 기록입니다.

## 뭘 하는 코드인가

`post.py` 하나뿐입니다. Threads Graph API를 직접 호출해서 텍스트 글을 발행합니다.

```bash
export THREADS_USER_ID=xxxx
export THREADS_ACCESS_TOKEN=xxxx
python post.py "발행할 글 내용"
```

내부적으로 하는 일:
1. `POST /{user-id}/threads` — 텍스트 미디어 컨테이너 생성
2. `POST /{user-id}/threads_publish` — 생성된 컨테이너 발행

## 왜 이렇게 단순한가

프레시시즌 같은 기존 프로젝트는 Next.js 앱 + Vercel 배포 + 전용 MCP 서버가 있지만, 이 계정은 그런 인프라가 없습니다. 별도 서버 없이 토큰만 있으면 바로 발행 가능하다는 걸 보여주는 게 이 프로젝트의 취지 중 하나이기도 합니다.

## 진행 기록

전체 과정은 [LOG.md](./LOG.md)에 있습니다. 성공한 것도 실패한 것도 그대로 남깁니다.

## 주의

`THREADS_ACCESS_TOKEN`은 절대 커밋하지 않습니다. 환경변수로만 주입하세요.
