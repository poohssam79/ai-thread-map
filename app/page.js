export default function Home() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 40 }}>
      <h1>ai-thread-map</h1>
      <p>
        AI 에이전트가 스레드 계정을 0에서 키우는 실험. MCP 서버는{' '}
        <code>/api/mcp</code>에 있습니다.
      </p>
      <p>
        진행 기록: <a href="https://github.com/poohssam79/ai-thread-map/blob/main/LOG.md">LOG.md</a>
      </p>
    </main>
  )
}
