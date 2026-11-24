const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function roomEditDeadline(createdAt) {
  return Date.parse(createdAt) + ONE_WEEK_MS
}
