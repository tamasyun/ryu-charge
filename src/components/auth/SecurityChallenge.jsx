import { useEffect, useRef, useState } from 'react'
import { Turnstile } from '@marsidev/react-turnstile'

export default function SecurityChallenge({ siteKey, widgetRef, onTokenChange }) {
  const containerRef = useRef(null)
  const [size, setSize] = useState('compact')
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined
    // 横幅300pxを確保できるときは横長にし、狭い画面では小型を中央に置く。
    const observer = new ResizeObserver(([entry]) => {
      setSize(entry.contentRect.width >= 300 ? 'flexible' : 'compact')
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  function invalidateToken() {
    onTokenChange('')
    setError('')
  }

  function fail(message) {
    onTokenChange('')
    setError(message)
  }

  return <div className="login-captcha" ref={containerRef}>
    <Turnstile ref={widgetRef} siteKey={siteKey}
      options={{ language: 'ja', size, responseField: false, retry: 'auto', refreshExpired: 'auto', refreshTimeout: 'auto' }}
      onWidgetLoad={invalidateToken}
      onSuccess={token => { onTokenChange(token); setError('') }}
      // 再試行・期限切れの案内はウィジェットに任せ、古いトークンだけ無効にする。
      onExpire={invalidateToken}
      onError={invalidateToken}
      onTimeout={invalidateToken}
      onUnsupported={() => fail('このブラウザーではセキュリティ確認を利用できません。')}
      scriptOptions={{ onError: () => fail('セキュリティ確認を読み込めません。ページを再読み込みしてください。') }} />
    {error && <p className="login-error" role="alert">{error}</p>}
  </div>
}
