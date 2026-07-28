// app/api/mcp/route.js
//
// ai_thread_map 계정용 MCP(Model Context Protocol) 서버.
// 프레시시즌(minsiljang0/Fresh_Season)의 publish_thread_post/refresh_threads_token/
// list_github_files/get_github_file 패턴을 이식했고, Meta 앱에 등록해둔 권한
// (threads_basic, threads_content_publish, threads_manage_replies, threads_read_replies,
// threads_manage_insights, threads_keyword_search) 기준으로 실제 쓸 수 있는 도구를 전부 갖췄다.
//
// 프레시시즌과 다른 점: Supabase가 없어서 draft 테이블이 없다. 그래서:
//   - 초안 검토는 대화 중 사람이 직접 확인 → publish_post 호출
//   - 발행 기록(get_publish_log 대응)은 DB 대신 get_recent_posts로 Threads API에서 직접 조회
//
// 필요한 환경변수 (Vercel 프로젝트 설정 > Environment Variables):
//   THREADS_USER_ID / THREADS_ACCESS_TOKEN  - Meta for Developers에서 발급받은 값
//   MCP_SHARED_SECRET                        - 이 MCP 서버 보호용 공유 비밀키
//   GITHUB_TOKEN (선택)                      - list_github_files/get_github_file API 한도 완화용
//
// 커넥터 등록 URL: https://ai-thread-map.vercel.app/api/mcp?key=<MCP_SHARED_SECRET>

import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'

const GITHUB_REPO = 'poohssam79/ai-thread-map'

async function threadsApiCall(url, options) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}

/** 현재 시각을 KST(UTC+9) 기준 ISO 문자열로 반환 */
function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00')
}

const baseHandler = createMcpHandler(
  (server) => {
    // ── 발행 ──────────────────────────────────────────────────────────
    server.registerTool(
      'publish_post',
      {
        title: 'Threads(스레드) 글 발행',
        description:
          'ai_thread_map 계정에 텍스트 글을 Meta Threads API로 실제 발행한다. ' +
          '초안 DB가 없으므로 이 툴은 받은 text를 그대로, 즉시 발행한다 — 호출 전에 ' +
          '내용을 사람에게 보여주고 승인받은 뒤에만 호출할 것. ' +
          'THREADS_USER_ID/THREADS_ACCESS_TOKEN 환경변수가 없으면 오류를 반환한다.' +
          '\n\n⚠️ 호출 전 필수 확인 (저장소 CONTENT_GUIDE.md 요약): ' +
          '(1) 순수 정보나열형/백과사전 어투 금지 — 총정리형, 위트있는 한 줄, 또는 실제로 있었던 개인 서사만. ' +
          '(2) 본문에 외부 링크 넣지 말 것, 해시태그는 2~3개까지. ' +
          '(3) 지어낸 경험담·숫자 금지, 검증 가능한 사실만. ' +
          '(4) 첫 줄에 숫자·의외성·질문 중 하나를 넣을 것. ' +
          '이 체크리스트를 통과 못 하면 text를 고쳐서 다시 호출할 것, 그냥 발행하지 말 것.',
        inputSchema: {
          text: z.string().min(1).max(500).describe('발행할 글 내용'),
        },
        annotations: { destructiveHint: false, idempotentHint: false },
      },
      async ({ text }) => {
        const threadsUserId = process.env.THREADS_USER_ID
        const accessToken = process.env.THREADS_ACCESS_TOKEN
        if (!threadsUserId || !accessToken) {
          return { content: [{ type: 'text', text: '❌ THREADS_USER_ID/THREADS_ACCESS_TOKEN 환경변수가 설정되어 있지 않습니다.' }], isError: true }
        }
        try {
          const containerParams = new URLSearchParams({ media_type: 'TEXT', text, access_token: accessToken })
          const container = await threadsApiCall(
            `https://graph.threads.net/v1.0/${threadsUserId}/threads?${containerParams.toString()}`,
            { method: 'POST' }
          )
          const creationId = container?.id
          if (!creationId) throw new Error('컨테이너 생성 응답에 id가 없습니다: ' + JSON.stringify(container))

          await new Promise((r) => setTimeout(r, 2000))

          const publishParams = new URLSearchParams({ creation_id: creationId, access_token: accessToken })
          const published = await threadsApiCall(
            `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish?${publishParams.toString()}`,
            { method: 'POST' }
          )
          const threadsPostId = published?.id
          const permalink = threadsPostId ? `https://www.threads.net/@${threadsUserId}/post/${threadsPostId}` : null

          return {
            content: [{
              type: 'text',
              text: `✅ 게시 완료 (${nowKST()})\nthreads_post_id: ${threadsPostId}${permalink ? '\n' + permalink : ''}`,
            }],
          }
        } catch (err) {
          return { content: [{ type: 'text', text: `❌ 게시 실패: ${err.message}` }], isError: true }
        }
      }
    )

    // ── 토큰 ──────────────────────────────────────────────────────────
    server.registerTool(
      'refresh_threads_token',
      {
        title: 'Threads(스레드) 액세스 토큰 갱신',
        description:
          'Meta Threads 장기 액세스 토큰(기본 60일 만료)을 현재 THREADS_ACCESS_TOKEN으로 갱신 요청해 ' +
          '새 토큰을 발급받는다. 이 서버는 토큰을 어디에도 저장하지 않으므로, 반환된 새 토큰 값을 ' +
          'Vercel 프로젝트 환경변수 THREADS_ACCESS_TOKEN에 사용자가 직접 반영하고 재배포해야 적용된다.',
        inputSchema: {},
        annotations: { destructiveHint: false, idempotentHint: false },
      },
      async () => {
        const accessToken = process.env.THREADS_ACCESS_TOKEN
        if (!accessToken) {
          return { content: [{ type: 'text', text: '❌ THREADS_ACCESS_TOKEN 환경변수가 설정되어 있지 않습니다.' }], isError: true }
        }
        try {
          const refreshParams = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: accessToken })
          const data = await threadsApiCall(
            `https://graph.threads.net/refresh_access_token?${refreshParams.toString()}`,
            { method: 'GET' }
          )
          const expiresInDays = data.expires_in ? Math.round(data.expires_in / 86400) : '?'
          return {
            content: [{
              type: 'text',
              text: `✅ 토큰 갱신 완료 (${expiresInDays}일 후 만료)\n\n` +
                `⚠️ 아래 값을 Vercel 프로젝트 설정 > Environment Variables > THREADS_ACCESS_TOKEN에 반영하고 재배포하세요:\n\n` +
                data.access_token,
            }],
          }
        } catch (err) {
          return { content: [{ type: 'text', text: `❌ 토큰 갱신 실패: ${err.message}` }], isError: true }
        }
      }
    )

    // ── 프로필 / 발행 기록 / 인사이트 (DB 대신 Threads API에서 직접 조회) ──────────
    server.registerTool(
      'get_profile',
      {
        title: 'Threads 프로필 정보 조회',
        description: 'ai_thread_map 계정의 팔로워 수 등 프로필 정보를 조회한다. 성장 상황을 숫자로 확인할 때 쓴다 — 추측하지 말고 이걸로 확인할 것.',
        inputSchema: {},
      },
      async () => {
        const threadsUserId = process.env.THREADS_USER_ID
        const accessToken = process.env.THREADS_ACCESS_TOKEN
        if (!threadsUserId || !accessToken) {
          return { content: [{ type: 'text', text: '❌ THREADS_USER_ID/THREADS_ACCESS_TOKEN 환경변수가 설정되어 있지 않습니다.' }], isError: true }
        }
        try {
          const params = new URLSearchParams({ fields: 'id,username,name,threads_profile_picture_url,threads_biography', access_token: accessToken })
          const data = await threadsApiCall(`https://graph.threads.net/v1.0/${threadsUserId}?${params.toString()}`, { method: 'GET' })
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `❌ 조회 실패: ${err.message}` }], isError: true }
        }
      }
    )

    server.registerTool(
      'get_recent_posts',
      {
        title: '최근 발행 글 목록 조회',
        description: 'ai_thread_map 계정이 최근에 올린 글 목록을 실제 Threads API에서 가져온다. 별도 DB가 없으므로 발행 기록은 항상 이 툴로 확인한다 (추측 금지).',
        inputSchema: {
          limit: z.number().int().min(1).max(50).optional().describe('가져올 개수, 기본 10'),
        },
      },
      async ({ limit = 10 }) => {
        const threadsUserId = process.env.THREADS_USER_ID
        const accessToken = process.env.THREADS_ACCESS_TOKEN
        if (!threadsUserId || !accessToken) {
          return { content: [{ type: 'text', text: '❌ THREADS_USER_ID/THREADS_ACCESS_TOKEN 환경변수가 설정되어 있지 않습니다.' }], isError: true }
        }
        try {
          const params = new URLSearchParams({ fields: 'id,text,timestamp,permalink', limit: String(limit), access_token: accessToken })
          const data = await threadsApiCall(`https://graph.threads.net/v1.0/${threadsUserId}/threads?${params.toString()}`, { method: 'GET' })
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `❌ 조회 실패: ${err.message}` }], isError: true }
        }
      }
    )

    server.registerTool(
      'get_post_insights',
      {
        title: '게시물 조회수/반응 확인',
        description: '특정 게시물의 조회수·좋아요·댓글 등 실제 인사이트를 가져온다. 글이 잘 됐는지 추측하지 말고 이걸로 확인할 것.',
        inputSchema: {
          media_id: z.string().describe('threads media id (get_recent_posts로 확인)'),
        },
      },
      async ({ media_id }) => {
        const accessToken = process.env.THREADS_ACCESS_TOKEN
        if (!accessToken) {
          return { content: [{ type: 'text', text: '❌ THREADS_ACCESS_TOKEN 환경변수가 설정되어 있지 않습니다.' }], isError: true }
        }
        try {
          const params = new URLSearchParams({ metric: 'views,likes,replies,reposts,quotes', access_token: accessToken })
          const data = await threadsApiCall(`https://graph.threads.net/v1.0/${media_id}/insights?${params.toString()}`, { method: 'GET' })
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `❌ 조회 실패: ${err.message}` }], isError: true }
        }
      }
    )

    // ── 삭제 ──────────────────────────────────────────────────────────
    server.registerTool(
      'delete_post',
      {
        title: '게시물/댓글 삭제',
        description:
          '잘못 발행된 글이나 댓글을 삭제한다. threads_delete 권한이 Meta 앱에 등록되어 있어야 동작한다 ' +
          '(2026-07-29 기준 아직 미등록 — Meta 개발자 콘솔에서 추가 필요). 되돌릴 수 없으니 삭제 전 ' +
          '반드시 어떤 글인지 사람에게 확인받을 것.',
        inputSchema: {
          media_id: z.string().describe('삭제할 게시물/댓글의 threads media id'),
        },
        annotations: { destructiveHint: true, idempotentHint: false },
      },
      async ({ media_id }) => {
        const accessToken = process.env.THREADS_ACCESS_TOKEN
        if (!accessToken) {
          return { content: [{ type: 'text', text: '❌ THREADS_ACCESS_TOKEN 환경변수가 설정되어 있지 않습니다.' }], isError: true }
        }
        try {
          const params = new URLSearchParams({ access_token: accessToken })
          const data = await threadsApiCall(`https://graph.threads.net/v1.0/${media_id}?${params.toString()}`, { method: 'DELETE' })
          return { content: [{ type: 'text', text: `✅ 삭제 완료: ${JSON.stringify(data)}` }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `❌ 삭제 실패: ${err.message}` }], isError: true }
        }
      }
    )

    // ── 댓글 ──────────────────────────────────────────────────────────
    server.registerTool(
      'get_replies',
      {
        title: '댓글 조회',
        description: '특정 게시물에 달린 댓글(답글) 목록을 가져온다. 답글을 달기 전에 먼저 이걸로 내용을 확인한다.',
        inputSchema: {
          media_id: z.string().describe('댓글을 조회할 게시물의 threads media id'),
        },
      },
      async ({ media_id }) => {
        const accessToken = process.env.THREADS_ACCESS_TOKEN
        if (!accessToken) {
          return { content: [{ type: 'text', text: '❌ THREADS_ACCESS_TOKEN 환경변수가 설정되어 있지 않습니다.' }], isError: true }
        }
        try {
          const params = new URLSearchParams({ fields: 'id,text,username,timestamp,permalink', access_token: accessToken })
          const data = await threadsApiCall(`https://graph.threads.net/v1.0/${media_id}/replies?${params.toString()}`, { method: 'GET' })
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `❌ 조회 실패: ${err.message}` }], isError: true }
        }
      }
    )

    server.registerTool(
      'reply_to_post',
      {
        title: '댓글(답글) 달기',
        description:
          '특정 게시물이나 댓글에 답글을 실제로 게시한다. CONTENT_GUIDE.md 원칙(지어낸 내용 금지, 광고 티 금지)이 답글에도 동일하게 적용된다. ' +
          '호출 전 사람에게 내용을 보여주고 승인받을 것.',
        inputSchema: {
          reply_to_id: z.string().describe('답글을 달 대상의 threads media id'),
          text: z.string().min(1).max(500).describe('답글 내용'),
        },
        annotations: { destructiveHint: false, idempotentHint: false },
      },
      async ({ reply_to_id, text }) => {
        const threadsUserId = process.env.THREADS_USER_ID
        const accessToken = process.env.THREADS_ACCESS_TOKEN
        if (!threadsUserId || !accessToken) {
          return { content: [{ type: 'text', text: '❌ THREADS_USER_ID/THREADS_ACCESS_TOKEN 환경변수가 설정되어 있지 않습니다.' }], isError: true }
        }
        try {
          const containerParams = new URLSearchParams({ media_type: 'TEXT', text, reply_to_id, access_token: accessToken })
          const container = await threadsApiCall(
            `https://graph.threads.net/v1.0/${threadsUserId}/threads?${containerParams.toString()}`,
            { method: 'POST' }
          )
          const creationId = container?.id
          if (!creationId) throw new Error('컨테이너 생성 응답에 id가 없습니다: ' + JSON.stringify(container))
          await new Promise((r) => setTimeout(r, 2000))
          const publishParams = new URLSearchParams({ creation_id: creationId, access_token: accessToken })
          const published = await threadsApiCall(
            `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish?${publishParams.toString()}`,
            { method: 'POST' }
          )
          return { content: [{ type: 'text', text: `✅ 답글 게시 완료: ${JSON.stringify(published)}` }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `❌ 답글 게시 실패: ${err.message}` }], isError: true }
        }
      }
    )

    // ── 검색 ──────────────────────────────────────────────────────────
    server.registerTool(
      'search_threads',
      {
        title: '스레드 키워드 검색',
        description: '공개 스레드 게시물을 키워드로 검색한다. 관련 대화를 찾아 참여할 때 사용.',
        inputSchema: {
          q: z.string().describe('검색 키워드'),
          search_type: z.enum(['TOP', 'RECENT']).optional().describe('기본 TOP'),
        },
      },
      async ({ q, search_type = 'TOP' }) => {
        const accessToken = process.env.THREADS_ACCESS_TOKEN
        if (!accessToken) {
          return { content: [{ type: 'text', text: '❌ THREADS_ACCESS_TOKEN 환경변수가 설정되어 있지 않습니다.' }], isError: true }
        }
        try {
          const params = new URLSearchParams({ q, search_type, fields: 'id,text,username,timestamp,permalink', access_token: accessToken })
          const data = await threadsApiCall(`https://graph.threads.net/v1.0/keyword_search?${params.toString()}`, { method: 'GET' })
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `❌ 검색 실패: ${err.message}` }], isError: true }
        }
      }
    )

    // ── GitHub 저장소 확인 ────────────────────────────────────────────
    server.registerTool(
      'list_github_files',
      {
        title: 'GitHub 저장소 파일 목록 조회',
        description: `${GITHUB_REPO} 저장소의 특정 경로에 어떤 파일·폴더가 있는지 조회한다. path를 비우면 루트를 본다.`,
        inputSchema: {
          path: z.string().optional().describe('조회할 경로. 비우면 루트'),
          ref: z.string().optional().describe('브랜치/커밋. 기본: main'),
        },
      },
      async ({ path = '', ref = 'main' }) => {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(ref)}`
        const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-thread-map-mcp' }
        if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
        const res = await fetch(url, { headers })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return { content: [{ type: 'text', text: `❌ GitHub API 오류 (${res.status}): ${text}` }], isError: true }
        }
        const data = await res.json()
        const list = Array.isArray(data) ? data : [data]
        const lines = list.map(f => `${f.type === 'dir' ? '📁' : '📄'} ${f.path}${f.type === 'file' ? ` (${f.size} bytes)` : ''}`)
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }
    )

    server.registerTool(
      'get_github_file',
      {
        title: 'GitHub 저장소 파일 내용 조회',
        description: `${GITHUB_REPO} 저장소의 특정 파일 내용을 텍스트로 가져온다. 다른 계정/세션에서 이 프로젝트 맥락을 파악할 때 README.md, LOG.md, CONTENT_GUIDE.md부터 읽을 것.`,
        inputSchema: {
          path: z.string().describe('파일 경로. 예: "LOG.md"'),
          ref: z.string().optional().describe('브랜치/커밋. 기본: main'),
        },
      },
      async ({ path, ref = 'main' }) => {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(ref)}`
        const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-thread-map-mcp' }
        if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
        const res = await fetch(url, { headers })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return { content: [{ type: 'text', text: `❌ GitHub API 오류 (${res.status}): ${text}` }], isError: true }
        }
        const data = await res.json()
        if (data.type !== 'file') return { content: [{ type: 'text', text: `❌ "${path}"는 파일이 아니라 ${data.type}입니다` }], isError: true }
        const content = Buffer.from(data.content, data.encoding || 'base64').toString('utf-8')
        return { content: [{ type: 'text', text: `[${path}] (${data.size} bytes)\n\n${content}` }] }
      }
    )
  },
  {
    instructions:
      'AI가 스레드(Threads) 계정 ai_thread_map을 0에서 키우는 실험용 MCP 서버. ' +
      '글 발행(publish_post), 댓글 조회/응답(get_replies/reply_to_post), 프로필·발행기록·인사이트 조회 ' +
      '(get_profile/get_recent_posts/get_post_insights — 별도 DB 없이 Threads API에서 직접 확인), ' +
      '키워드 검색(search_threads), 삭제(delete_post — threads_delete 권한 필요), ' +
      '저장소 파일 확인(list_github_files/get_github_file)을 제공한다. ' +
      '발행/답글 전에는 항상 사람에게 내용을 먼저 보여주고 승인을 받을 것. ' +
      '반응·조회수는 추측하지 말고 get_recent_posts/get_post_insights로 실제 확인할 것.',
  },
  { basePath: '/api', maxDuration: 30, verboseLogs: true }
)

// 프레시시즌과 동일한 ?key= 쿼리파라미터 인증 방식.
async function authedHandler(request) {
  const url = new URL(request.url)
  const key = url.searchParams.get('key')
  if (!process.env.MCP_SHARED_SECRET || key !== process.env.MCP_SHARED_SECRET) {
    return new Response(JSON.stringify({ error: '인증 필요 (key 파라미터 확인)' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return baseHandler(request)
}

export { authedHandler as GET, authedHandler as POST }
