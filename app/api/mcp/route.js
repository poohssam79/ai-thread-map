// app/api/mcp/route.js
//
// ai_thread_map 계정용 MCP(Model Context Protocol) 서버.
// 프레시시즌(app/api/mcp/route.js, minsiljang0/Fresh_Season)의 publish_thread_post/
// refresh_threads_token 패턴을 그대로 이식했습니다 — mcp-handler 패키지, ?key= 인증 방식 동일.
//
// 프레시시즌과 다른 점: 이 프로젝트엔 Supabase가 없어서 threads_posts 같은 DB 초안 테이블이
// 없습니다. 그래서 draft→post_id 2단계 대신, publish_post 하나가 텍스트를 바로 받아
// 컨테이너 생성부터 발행까지 한 번에 처리합니다. 초안 검토는 이 도구를 호출하기 전에
// 대화 중에 사람이 눈으로 확인하는 것으로 대체합니다.
//
// 필요한 환경변수 (Vercel 프로젝트 설정 > Environment Variables):
//   THREADS_USER_ID / THREADS_ACCESS_TOKEN  - Meta for Developers에서 발급받은 값
//   MCP_SHARED_SECRET                        - 이 MCP 서버 보호용 공유 비밀키 (직접 정해서 등록)
//
// 커넥터 등록 URL: https://<vercel-domain>/api/mcp?key=여기에_MCP_SHARED_SECRET_값

import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'

/** 현재 시각을 KST(UTC+9) 기준 ISO 문자열로 반환 */
function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00')
}

async function threadsApiCall(url, options) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}

const baseHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      'publish_post',
      {
        title: 'Threads(스레드) 글 발행',
        description:
          'ai_thread_map 계정에 텍스트 글을 Meta Threads API로 실제 발행한다. ' +
          '초안 DB가 없으므로 이 툴은 받은 text를 그대로, 즉시 발행한다 — 호출 전에 ' +
          '내용을 사람에게 보여주고 승인받은 뒤에만 호출할 것. ' +
          'THREADS_USER_ID/THREADS_ACCESS_TOKEN 환경변수가 없으면 오류를 반환한다.',
        inputSchema: {
          text: z.string().min(1).max(500).describe('발행할 글 내용'),
        },
        annotations: { destructiveHint: false, idempotentHint: false },
      },
      async ({ text }) => {
        const threadsUserId = process.env.THREADS_USER_ID
        const accessToken = process.env.THREADS_ACCESS_TOKEN
        if (!threadsUserId || !accessToken) {
          return {
            content: [{ type: 'text', text: '❌ THREADS_USER_ID/THREADS_ACCESS_TOKEN 환경변수가 설정되어 있지 않습니다.' }],
            isError: true,
          }
        }

        try {
          const containerParams = new URLSearchParams({ media_type: 'TEXT', text, access_token: accessToken })
          const container = await threadsApiCall(
            `https://graph.threads.net/v1.0/${threadsUserId}/threads?${containerParams.toString()}`,
            { method: 'POST' }
          )
          const creationId = container?.id
          if (!creationId) throw new Error('컨테이너 생성 응답에 id가 없습니다: ' + JSON.stringify(container))

          // Threads API는 컨테이너 생성 직후 바로 발행하면 실패할 수 있어 약간의 대기가 필요하다.
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
  },
  {
    instructions:
      'AI가 스레드(Threads) 계정 ai_thread_map을 0에서 키우는 실험용 MCP 서버. ' +
      '글을 발행하는 도구(publish_post)와 토큰을 갱신하는 도구(refresh_threads_token)만 제공한다. ' +
      '발행 전에는 항상 사람에게 내용을 먼저 보여주고 승인을 받을 것.',
  },
  { basePath: '/api', maxDuration: 30, verboseLogs: true }
)

// 프레시시즌과 동일한 ?key= 쿼리파라미터 인증 방식.
// (claude.ai 커넥터가 인증 없는 MCP 서버에 연결할 때 OAuth 클라이언트 자동등록을
// 시도하다 실패하는 별도 문제가 있어, 검증된 이 방식을 그대로 이식함.)
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
