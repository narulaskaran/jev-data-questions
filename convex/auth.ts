/** Shared write authorization. Plain helpers only: this module exports no Convex functions. */

const encoder = new TextEncoder()

/** Compares in time that depends only on the longer input, not on where they differ. */
export const timingSafeEqual = (a: string, b: string): boolean => {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return diff === 0
}

/** Throws unless `authToken` matches CONVEX_WRITE_SECRET. Fails closed when the secret is unset or empty. */
export const assertAuthorized = (authToken: string): void => {
  const expected = process.env.CONVEX_WRITE_SECRET
  if (!expected || !timingSafeEqual(authToken, expected)) throw new Error('Unauthorized')
}
