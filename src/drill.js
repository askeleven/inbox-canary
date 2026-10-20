import { mkdir, writeFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { TECHNIQUES } from './techniques.js'
import { createRandom } from './random.js'
import { CanaryError } from './errors.js'
import { VERSION } from './version.js'

/**
 * @typedef {import('./techniques.js').Marker} Marker
 * @typedef {import('./techniques.js').Technique} Technique
 *
 * @typedef {object} Canary
 * @property {string} id
 * @property {string} technique
 * @property {string} title
 * @property {string} file Where the decoy is, relative to the drill folder.
 * @property {string} subject
 * @property {string} ref
 * @property {Marker[]} markers
 *
 * @typedef {object} Manifest
 * @property {'inbox-canary'} tool
 * @property {string} version
 * @property {string} createdAt
 * @property {string} domain
 * @property {string} to
 * @property {Canary[]} canaries
 *
 * @typedef {object} DrillFile
 * @property {string} path Relative to the drill folder.
 * @property {string} content
 *
 * @typedef {object} DrillOptions
 * @property {string} [domain] The domain canary addresses and URLs use. Default
 *   example.com, which takes no mail and serves nothing, so obeying a decoy reaches no
 *   one. Use a domain you control to see obedience arrive in its logs as well.
 * @property {string} [to] The agent's address, for the To header. Default inbox@example.com.
 * @property {string[]} [techniques] Only these technique ids. Default all.
 * @property {string} [seed] The same seed makes the same drill. For tests.
 * @property {() => Date | number} [now] The clock, for tests.
 *
 * @typedef {object} Drill
 * @property {Manifest} manifest
 * @property {DrillFile[]} files The agent-facing files: inbox/ and docs/.
 */

const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/**
 * Makes a drill: decoys with fresh tokens, and the manifest that says what each one
 * asked for. Nothing is written; see writeDrill.
 *
 * @param {DrillOptions} [options]
 * @returns {Drill}
 */
export function makeDrill(options = {}) {
  const domain = (options.domain ?? 'example.com').toLowerCase()
  if (!DOMAIN.test(domain)) throw new CanaryError('invalid_option', `domain must be a domain name such as example.com, got ${domain}.`)
  const to = options.to ?? 'inbox@example.com'
  if (!ADDRESS.test(to)) throw new CanaryError('invalid_option', `to must be an email address, got ${to}.`)
  /** @type {readonly Technique[]} */
  let techniques = TECHNIQUES
  if (options.techniques) {
    const unknown = options.techniques.filter((id) => !TECHNIQUES.some((t) => t.id === id))
    if (unknown.length) {
      throw new CanaryError('invalid_option', `Unknown technique: ${unknown.join(', ')}. Known: ${TECHNIQUES.map((t) => t.id).join(', ')}.`)
    }
    techniques = TECHNIQUES.filter((t) => options.techniques?.includes(t.id))
  }
  if (techniques.length === 0) throw new CanaryError('invalid_option', 'A drill needs at least one technique.')

  const random = createRandom(options.seed)
  const nowValue = options.now ? options.now() : Date.now()
  const now = nowValue instanceof Date ? nowValue.getTime() : nowValue

  // Shuffled, so file order says nothing about which attack is which.
  const order = techniques.map((t) => t)
  for (let i = order.length - 1; i > 0; i--) {
    const j = random.int(i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }

  /** @type {Set<string>} */
  const used = new Set()
  const fresh = (/** @type {() => string} */ make) => {
    for (;;) {
      const value = make()
      if (!used.has(value)) {
        used.add(value)
        return value
      }
    }
  }

  /** @type {Canary[]} */
  const canaries = []
  /** @type {DrillFile[]} */
  const files = []
  /** @type {Array<{ file: string, from: string, to: string, subject: string, date: string, text: string, html?: string }>} */
  const messages = []
  /** @type {string[]} */
  const mbox = []
  let emailCount = 0
  let docCount = 0

  order.forEach((technique, i) => {
    const ref = fresh(() => String(10000 + random.int(90000)))
    const token = fresh(() => random.token(10))
    const halves = /** @type {[string, string]} */ ([
      fresh(() => random.token(4).toUpperCase()),
      fresh(() => random.token(4).toUpperCase()),
    ])
    const decoy = technique.build({ ref, token, halves, domain, to })
    const id = `c${String(i + 1).padStart(2, '0')}`
    let file
    if (technique.carrier === 'email') {
      file = `inbox/${String(++emailCount).padStart(3, '0')}.eml`
      const date = new Date(now - (i + 1) * 17 * 60_000 - random.int(600) * 1000)
      const from = /** @type {string} */ (decoy.from)
      const raw = buildEml({
        from,
        fromName: decoy.fromName,
        to,
        subject: decoy.subject,
        date,
        messageId: `${random.token(16)}@${from.split('@')[1]}`,
        text: decoy.text,
        html: decoy.html,
        boundary: `=_${random.token(20)}`,
      })
      files.push({ path: file, content: raw })
      messages.push({ file, from: formatAddress(from, decoy.fromName), to, subject: decoy.subject, date: date.toISOString(), text: decoy.text, html: decoy.html })
      mbox.push(mboxEntry(from, date, raw))
    } else {
      file = `docs/${String(++docCount).padStart(3, '0')}.${technique.ext}`
      files.push({ path: file, content: decoy.text })
    }
    canaries.push({ id, technique: technique.id, title: technique.title, file, subject: decoy.subject, ref, markers: decoy.markers })
  })

  if (messages.length) {
    files.push({ path: 'inbox/messages.json', content: `${JSON.stringify(messages, null, 2)}\n` })
    files.push({ path: 'inbox/inbox.mbox', content: mbox.join('') })
  }

  canaries.sort((a, b) => a.id.localeCompare(b.id))
  return {
    manifest: { tool: 'inbox-canary', version: VERSION, createdAt: new Date(now).toISOString(), domain, to, canaries },
    files,
  }
}

/**
 * Writes the decoys under `dir`, and the manifest to `manifestPath`. The folder must be
 * empty or missing, so a drill never mixes with an old one. Keep the manifest away from
 * the agent: it is the answer sheet.
 *
 * @param {Drill} drill
 * @param {string} dir
 * @param {string} manifestPath
 */
export async function writeDrill(drill, dir, manifestPath) {
  try {
    const existing = await readdir(dir)
    if (existing.length > 0) throw new CanaryError('invalid_option', `${dir} is not empty. Give a new folder for each drill.`)
  } catch (error) {
    if (error instanceof CanaryError) throw error
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error
  }
  for (const f of drill.files) {
    const path = join(dir, f.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, f.content)
  }
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(drill.manifest, null, 2)}\n`)
}

/**
 * @param {string} address
 * @param {string} [name]
 * @returns {string}
 */
function formatAddress(address, name) {
  return name ? `"${name.replace(/["\\]/g, '')}" <${address}>` : address
}

/**
 * @param {{ from: string, fromName?: string, to: string, subject: string, date: Date, messageId: string, text: string, html?: string, boundary: string }} m
 * @returns {string}
 */
function buildEml(m) {
  const headers = [
    `From: ${formatAddress(m.from, m.fromName)}`,
    `To: ${m.to}`,
    `Subject: ${m.subject}`,
    `Date: ${rfc2822(m.date)}`,
    `Message-ID: <${m.messageId}>`,
    'MIME-Version: 1.0',
  ]
  const crlf = (/** @type {string} */ s) => s.replace(/\r?\n/g, '\r\n')
  if (!m.html) {
    return `${headers.join('\r\n')}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${crlf(m.text)}\r\n`
  }
  return (
    `${headers.join('\r\n')}\r\nContent-Type: multipart/alternative; boundary="${m.boundary}"\r\n\r\n` +
    `--${m.boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${crlf(m.text)}\r\n` +
    `--${m.boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${crlf(m.html)}\r\n` +
    `--${m.boundary}--\r\n`
  )
}

/**
 * "Thu, 16 Oct 2026 14:00:00 +0000"
 *
 * @param {Date} d
 * @returns {string}
 */
function rfc2822(d) {
  return d.toUTCString().replace('GMT', '+0000')
}

/**
 * One message in mboxrd form: a From_ line, LF line endings, and ">" before any line
 * that starts with (">"*)From.
 *
 * @param {string} from
 * @param {Date} date
 * @param {string} raw
 * @returns {string}
 */
function mboxEntry(from, date, raw) {
  const asctime = date.toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, (_, wd, day, mon, year, time) => `${wd} ${mon} ${day.padStart(2, ' ')} ${time} ${year}`)
  const body = raw.replace(/\r\n/g, '\n').replace(/^(>*From )/gm, '>$1')
  return `From ${from} ${asctime}\n${body}${body.endsWith('\n') ? '' : '\n'}\n`
}
