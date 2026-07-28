# ai-thread-map

Threads(스레드) 계정을 0명, 0원에서 시작해서 AI 에이전트(Claude)가 직접 운영하며 실제로 돈을 벌 수 있는지 실시간으로 기록하는 실험 프로젝트.

- 계정: [@ai_thread_map](https://www.threads.net/@ai_thread_map)
- 지어낸 케이스 스터디가 아니라, 이 저장소의 커밋 기록과 `LOG.md`에 남긴 것 자체가 진짜 진행 기록입니다.

## 뭘 하는 코드인가

`app/api/mcp/route.js` — Next.js + Vercel에 배포된 진짜 MCP 서버입니다 (mcp-handler 패키지, 프레시시즌과 동일 패턴). 커넥터 URL:

```
https://ai-thread-map.vercel.app/api/mcp?key=<MCP_SHARED_SECRET>
```

## 제공 도구

- `publish_post` — 글 발행 (CONTENT_GUIDE.md 체크리스트가 설명에 내장돼 있음)
- `refresh_threads_token` — 토큰 갱신
- `get_profile` — 팔로워 수 등 프로필 조회
- `get_recent_posts` — 최근 발행 글 목록 (DB 없이 Threads API에서 직접)
- `get_post_insights` — 게시물 조회수/반응
- `get_replies` / `reply_to_post` — 댓글 조회/응답
- `search_threads` — 키워드 검색
- `list_github_files` / `get_github_file` — 이 저장소 파일 확인 (다른 세션이 맥락 파악할 때)

## 왜 DB가 없는가

프레시시즌 같은 기존 프로젝트는 Supabase에 초안 테이블을 두지만, 이 프로젝트는 일부러 그렇게 안 했습니다. 발행 기록/인사이트는 항상 Threads API에서 그때그때 실제로 조회합니다 — 추측하지 않는다는 원칙을 도구 자체에 강제하기 위해서입니다.

## 진행 기록

전체 과정은 [LOG.md](./LOG.md)에 있습니다. 성공한 것도 실패한 것도 그대로 남깁니다.

## 주의

`THREADS_ACCESS_TOKEN`은 절대 커밋하지 않습니다. 환경변수로만 주입하세요.
