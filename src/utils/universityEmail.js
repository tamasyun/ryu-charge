/**
 * Accept addresses at u-ryukyu.ac.jp and its subdomains, such as
 * student@ie.u-ryukyu.ac.jp. This is only a UX check. The database
 * must enforce the same restriction through its INSERT policies.
 */
export function isUniversityEmail(email) {
  if (typeof email !== 'string') return false
  const normalized = email.trim().toLowerCase()
  return /^[^\s@]+@(?:[a-z0-9-]+\.)*u-ryukyu\.ac\.jp$/.test(normalized)
}
