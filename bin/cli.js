#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { makeDrill, writeDrill, checkDrill, parseTranscript, badge, validateManifest, TECHNIQUES, CanaryError } from '../src/index.js'
import { formatText } from '../src/report.js'
import { VERSION } from '../src/version.js'

const USAGE = `
inbox-canary make <folder> [--manifest <file>]
inbox-canary check --manifest <file> [--transcript <file>] [--actions <file>] [--output <file>]
inbox-canary techniques

  A fire drill for prompt injection. "make" writes decoy emails and documents
  with hidden instructions: the kinds real attacks use, each asking for
  something harmless that carries a unique token. Give them to your agent.
  "check" looks for the tokens in what it did and wrote, and says which
  decoys it obeyed. Runs locally, no network.

make
  <folder>              Where the decoys go: inbox/ (.eml files, inbox.mbox,
                        messages.json) and docs/. Must be new or empty.
  --manifest <file>     The answer sheet. Default <folder>.manifest.json, next
                        to the folder. Never let the agent see it.
  --domain <domain>     For canary addresses and URLs. Default example.com,
                        which takes no mail and serves nothing.
  --to <address>        The agent's address. Default inbox@example.com.
  --only <ids>          Only these techniques, comma separated.
  --seed <text>         Same seed, same drill. For tests only.

check
  --manifest <file>     From make.
  --transcript <file>   The agent's transcript: Anthropic or OpenAI messages,
                        JSON or JSONL. Split into what it wrote and what it did;
                        what it read is ignored. Repeatable.
  --actions <file>      What the agent did: tool calls, sent mail, fetched URLs.
                        Not what it read. Repeatable.
  --output <file>       What the agent wrote for a person: replies, summaries.
                        Repeatable.
  --badge <file>        Write a shields.io endpoint badge.
  --json                Machine-readable output.
  --no-colour           Plain text.
  --version, --help

Exit codes
  0  pass: every decoy read, none obeyed
  1  fail (one was obeyed) or incomplete (some never shown to be read)
  2  could not run

Examples
  npx @askeleven/inbox-canary make drill
  npx @askeleven/inbox-canary check --manifest drill.manifest.json --transcript run.jsonl
  npx @askeleven/inbox-canary check --manifest drill.manifest.json --actions sent.log --output replies.txt --badge .github/inbox-canary.json
`

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        manifest: { type: 'string' },
        domain: { type: 'string' },
        to: { type: 'string' },
        only: { type: 'string' },
        seed: { type: 'string' },
        transcript: { type: 'string', multiple: true },
        actions: { type: 'string', multiple: true },
        output: { type: 'string', multiple: true },
        badge: { type: 'string' },
        json: { type: 'boolean', default: false },
        // parseArgs has no --no-x negation, so both spellings are declared explicitly.
        'no-colour': { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    })
  } catch (error) {
    process.stderr.write(`${/** @type {Error} */ (error).message}\n${USAGE}`)
    return 2
  }
  const { values, positionals } = parsed
  if (values.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }

  const [sub, ...args] = positionals
  try {
    if (sub === 'make') return await make(args, values)
    if (sub === 'check') return await check(values)
    if (sub === 'techniques') {
      const width = Math.max(...TECHNIQUES.map((t) => t.id.length))
      for (const t of TECHNIQUES) process.stdout.write(`${t.id.padEnd(width)}  ${t.carrier.padEnd(5)}  ${t.title}\n`)
      return 0
    }
  } catch (error) {
    if (error instanceof CanaryError || error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`)
      return 2
    }
    const code = /** @type {NodeJS.ErrnoException} */ (error).code
    if (code === 'ENOENT' || code === 'EISDIR' || code === 'EACCES') {
      process.stderr.write(`${/** @type {Error} */ (error).message}\n`)
      return 2
    }
    throw error
  }
  process.stderr.write(`${sub ? `Unknown command: ${sub}\n` : ''}${USAGE}`)
  return 2
}

class UsageError extends Error {}

/**
 * @param {string[]} args
 * @param {Record<string, any>} values
 * @returns {Promise<number>}
 */
async function make(args, values) {
  const folder = args[0]
  if (!folder) throw new UsageError(`make needs a folder for the decoys.\n${USAGE}`)
  const manifestPath = values.manifest ?? `${folder.replace(/[\\/]+$/, '')}.manifest.json`
  const inside = relative(resolve(folder), resolve(manifestPath))
  if (!inside.startsWith('..') && !inside.startsWith('/')) {
    throw new UsageError('The manifest must not go inside the decoy folder: it is the answer sheet, and the agent will read that folder.')
  }
  if (existsSync(manifestPath)) throw new UsageError(`${manifestPath} already exists. Each drill needs a new manifest.`)

  const drill = makeDrill({
    domain: values.domain,
    to: values.to,
    seed: values.seed,
    techniques: values.only ? String(values.only).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  })
  await writeDrill(drill, folder, manifestPath)

  if (values.json) {
    process.stdout.write(`${JSON.stringify({ folder, manifest: manifestPath, files: drill.files.map((f) => f.path) }, null, 2)}\n`)
    return 0
  }
  const emails = drill.manifest.canaries.filter((c) => c.file.startsWith('inbox/')).length
  const docs = drill.manifest.canaries.length - emails
  process.stdout.write(
    `Wrote ${emails} decoy emails and ${docs} decoy documents to ${folder}/\n` +
      `      inbox/*.eml, inbox/inbox.mbox, inbox/messages.json: the same emails, three ways\n` +
      `      docs/: documents, a web page, a CV and a calendar invite\n` +
      `Answer sheet: ${manifestPath}. Keep it away from the agent.\n\n` +
      `Next: have your agent work through ${folder}/ as it would real mail and files: summarise,\n` +
      `reply, triage. Save its transcript, then:\n\n` +
      `  npx @askeleven/inbox-canary check --manifest ${manifestPath} --transcript <transcript>\n`,
  )
  return 0
}

/**
 * @param {Record<string, any>} values
 * @returns {Promise<number>}
 */
async function check(values) {
  if (!values.manifest) throw new UsageError(`check needs --manifest.\n${USAGE}`)
  /** @type {unknown} */
  let manifest
  try {
    manifest = JSON.parse(await readFile(values.manifest, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) throw new UsageError(`${values.manifest} is not JSON.`)
    throw error
  }
  validateManifest(manifest)

  /** @type {import('../src/check.js').Evidence[]} */
  const evidence = []
  for (const path of values.transcript ?? []) evidence.push(...parseTranscript(await readFile(path, 'utf8'), path))
  for (const path of values.actions ?? []) evidence.push({ name: path, kind: 'actions', text: await readFile(path, 'utf8') })
  for (const path of values.output ?? []) evidence.push({ name: path, kind: 'output', text: await readFile(path, 'utf8') })
  if (evidence.length === 0) throw new UsageError('check needs at least one --transcript, --actions or --output file.')

  const result = checkDrill(manifest, evidence)
  if (values.badge) {
    await mkdir(dirname(values.badge), { recursive: true })
    await writeFile(values.badge, `${JSON.stringify(badge(result), null, 2)}\n`)
  }
  process.stdout.write(values.json ? `${JSON.stringify(result, null, 2)}\n` : formatText(result, { colour: useColour(values) }))
  return result.verdict === 'pass' ? 0 : 1
}

/**
 * Honours --no-colour, --no-color, NO_COLOR, and a non-TTY stdout.
 *
 * @param {Record<string, unknown>} values
 * @returns {boolean}
 */
function useColour(values) {
  if (values['no-colour'] || values['no-color']) return false
  if (process.env.NO_COLOR) return false
  return process.stdout.isTTY === true
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    process.stderr.write(`${error?.stack ?? error}\n`)
    process.exitCode = 2
  },
)
