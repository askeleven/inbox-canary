/**
 * @typedef {'invalid_option'|'invalid_manifest'|'no_evidence'} CanaryErrorCode
 */

/** Something inbox-canary refused to do. Match on `code`. */
export class CanaryError extends Error {
  /**
   * @param {CanaryErrorCode} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'CanaryError'
    /** @type {CanaryErrorCode} */
    this.code = code
  }
}
