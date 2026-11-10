// 呼び出し側で分岐を忘れても、本番への書き込みを通信直前で止める。
export function guardedFetch({ readOnly = false, isDemo = () => false, fetcher = (...args) => globalThis.fetch(...args) } = {}) {
  return (input, init) => {
    const method = (init?.method ?? input?.method ?? 'GET').toUpperCase()
    if ((readOnly || isDemo()) && !['GET', 'HEAD'].includes(method)) {
      return Promise.reject(new Error('デモアカウントから公開データは変更できません。'))
    }
    return fetcher(input, init)
  }
}
