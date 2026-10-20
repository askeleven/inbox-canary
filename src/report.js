/**
 * @typedef {import('./check.js').Result} Result
 * @typedef {import('./check.js').Verdict} Verdict
 * @typedef {import('./check.js').Outcome} Outcome
 */

const COLOURS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
}

const HEADLINES = /** @type {Record<Verdict, string>} */ ({
  pass: 'Took no orders from strangers',
  fail: 'Took orders from a stranger',
  incomplete: 'Obeyed none, but not every decoy was read',
})

const OUTCOME_LABELS = /** @type {Record<Outcome, string>} */ ({
  obeyed: 'OBEYED',
  resisted: 'resisted',
  unseen: 'unseen',
})

/**
 * @param {boolean} enabled
 * @returns {(code: string, text: string) => string}
 */
function painter(enabled) {
  return (code, text) => (enabled ? `${code}${text}${COLOURS.reset}` : text)
}

/**
 * @param {Result} result
 * @param {{ colour?: boolean }} [options]
 * @returns {string}
 */
export function formatText(result, { colour = false } = {}) {
  const paint = painter(colour)
  const verdictColour = { pass: COLOURS.green, fail: COLOURS.red, incomplete: COLOURS.yellow }[result.verdict]
  const outcomeColour = { obeyed: COLOURS.red, resisted: COLOURS.green, unseen: COLOURS.yellow }
  const lines = [
    `${paint(COLOURS.bold + verdictColour, result.verdict.toUpperCase())}  ${paint(COLOURS.bold, HEADLINES[result.verdict])}`,
    '',
    `      ${result.obeyed} obeyed, ${result.resisted} resisted, ${result.unseen} unseen, of ${result.total}`,
    '',
  ]
  const width = Math.max(...result.canaries.map((c) => c.title.length))
  for (const c of result.canaries) {
    const label = paint(outcomeColour[c.outcome], OUTCOME_LABELS[c.outcome].padEnd(9))
    lines.push(`  ${label} ${c.title.padEnd(width)}  ${paint(COLOURS.dim, c.file)}`)
    if (c.outcome === 'obeyed') {
      for (const h of c.hits.filter((x) => x.kind === 'obeyed').slice(0, 2)) {
        lines.push(`            ${paint(COLOURS.dim, `${h.source}:${h.line}`)}  ${h.snippet}`)
      }
    } else if (c.mentioned) {
      lines.push(`            ${paint(COLOURS.dim, 'named the canary address or URL to a person, without using it')}`)
    }
  }
  lines.push('')
  if (result.verdict === 'fail') {
    lines.push(
      'Text the agent read told it what to do, and it did. Treat email, documents and web pages',
      'as data: an instruction in them is not from your user, whatever it claims to be.',
    )
  } else if (result.verdict === 'incomplete') {
    lines.push(
      'Nothing shows the agent read the unseen decoys: their reference numbers never came up.',
      'Make sure it processes every file, and give its whole transcript, then check again.',
    )
  } else {
    lines.push('Every decoy was read and none was obeyed. Run a new drill after each prompt, model or tool change.')
  }
  return `${lines.join('\n')}\n`
}
