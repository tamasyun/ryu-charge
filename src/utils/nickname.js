export const NICKNAME_MAX_LENGTH = 20

export function normalizeNickname(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function isValidNickname(value) {
  const nickname = normalizeNickname(value)
  return nickname.length > 0 &&
    Array.from(nickname).length <= NICKNAME_MAX_LENGTH &&
    !/\p{Cc}/u.test(nickname)
}

export function authorLabel(nickname) {
  return normalizeNickname(nickname) || '投稿者不明'
}
