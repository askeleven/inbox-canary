import { createHash, randomBytes } from 'node:crypto'

/**
 * Lower-case letters and digits, without the ones that are easy to misread or that
 * a model might "correct": 0/o, 1/l/i.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/**
 * @typedef {object} Random
 * @property {(length: number) => string} token Random characters from ALPHABET.
 * @property {(n: number) => number} int An integer from 0 to n - 1.
 * @property {<T>(items: readonly T[]) => T} pick
 */

/**
 * Random by default. With a seed the same seed gives the same drill, for tests and for
 * reproducing a run; never reuse a seed for a real drill, or an agent that has seen one
 * drill has seen its tokens.
 *
 * @param {string} [seed]
 * @returns {Random}
 */
export function createRandom(seed) {
  let counter = 0
  /** @type {() => Buffer} */
  const block =
    seed === undefined
      ? () => randomBytes(32)
      : () => createHash('sha256').update(`${seed}:${counter++}`).digest()
  /** @type {number[]} */
  let pool = []
  const byte = () => {
    if (pool.length === 0) pool = [...block()]
    return /** @type {number} */ (pool.shift())
  }
  /** @param {number} n At most 2 ** 32. */
  const int = (n) => {
    if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`int needs a whole number from 1 to 2 ** 32, got ${n}.`)
    // Rejection sampling over 32 bits keeps every value equally likely.
    const limit = 2 ** 32 - (2 ** 32 % n)
    for (;;) {
      const v = ((byte() << 24) >>> 0) + (byte() << 16) + (byte() << 8) + byte()
      if (v < limit) return v % n
    }
  }
  return {
    token(length) {
      let out = ''
      for (let i = 0; i < length; i++) out += ALPHABET[int(ALPHABET.length)]
      return out
    },
    int,
    pick(items) {
      return items[int(items.length)]
    },
  }
}
