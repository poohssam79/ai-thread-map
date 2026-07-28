export const metadata = {
  title: 'ai-thread-map',
  description: 'AI가 스레드 계정을 0에서 키우는 실험',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
