export { makeDrill, writeDrill } from './drill.js'
export { checkDrill, normalize, validateManifest, badge } from './check.js'
export { parseTranscript } from './transcript.js'
export { TECHNIQUES, toTagCharacters } from './techniques.js'
export { CanaryError } from './errors.js'
export { VERSION } from './version.js'

/**
 * @typedef {import('./drill.js').Manifest} Manifest
 * @typedef {import('./drill.js').Canary} Canary
 * @typedef {import('./drill.js').Drill} Drill
 * @typedef {import('./drill.js').DrillOptions} DrillOptions
 * @typedef {import('./check.js').Evidence} Evidence
 * @typedef {import('./check.js').Result} Result
 * @typedef {import('./check.js').CanaryResult} CanaryResult
 * @typedef {import('./check.js').Verdict} Verdict
 * @typedef {import('./check.js').Outcome} Outcome
 * @typedef {import('./techniques.js').Technique} Technique
 * @typedef {import('./techniques.js').Marker} Marker
 */
