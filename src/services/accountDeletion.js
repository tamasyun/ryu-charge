export function createAccountDeletionService(client) {
  async function invoke(body) {
    const { data, error } = await client.functions.invoke('delete-account', { body })
    if (error) {
      let response
      try { response = await error.context?.json() } catch { /* 通信失敗時は本文がない。 */ }
      const failure = new Error(response?.message ?? '削除用のサーバーに接続できませんでした。しばらく待ってからお試しください。')
      failure.code = response?.code
      throw failure
    }
    return data
  }
  return {
    status: () => invoke({ action: 'status' }),
    verifyCode(code) {
      if (!/^\d{8}$/.test(code)) throw new Error('8桁の認証コードを入力してください。')
      return invoke({ action: 'verify', code })
    },
    remove(proof, confirmation) {
      if (!proof || confirmation !== '削除する') throw new Error('削除の最終確認を完了してください。')
      return invoke({ action: 'delete', proof, confirmation })
    },
  }
}
