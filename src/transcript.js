import { CanaryError } from './errors.js'

/**
 * @typedef {import('./check.js').Evidence} Evidence
 */

/**
 * Splits an agent transcript into what the agent wrote (output) and what it did (actions:
 * its tool calls and their arguments). Everything the agent was given, the user's
 * messages and tool results included, is left out: the decoys themselves arrive that
 * way, and reading a decoy is not obeying it.
 *
 * Reads the Anthropic Messages format, OpenAI Chat Completions and the OpenAI Responses
 * API: a JSON list of messages or items, an object with `messages` or `input`/`output`,
 * or JSONL with one per line.
 *
 * @param {string} text
 * @param {string} name Used to label the evidence.
 * @returns {Evidence[]}
 */
export function parseTranscript(text, name) {
  const items = readItems(text, name)
  /** @type {string[]} */
  const output = []
  /** @type {string[]} */
  const actions = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const role = item.role
    const type = item.type

    // OpenAI Responses API items.
    if (type === 'function_call' || type === 'custom_tool_call') {
      actions.push(`${item.name ?? 'tool'} ${stringify(item.arguments ?? item.input)}`)
      continue
    }
    if (type === 'web_search_call' || type === 'computer_call' || type === 'local_shell_call') {
      actions.push(`${type} ${stringify(item.action ?? item)}`)
      continue
    }
    if (type !== undefined && type !== 'message') continue
    if (role !== 'assistant') continue

    // OpenAI Chat Completions tool calls.
    if (Array.isArray(item.tool_calls)) {
      for (const call of item.tool_calls) {
        const fn = call?.function ?? call
        actions.push(`${fn?.name ?? 'tool'} ${stringify(fn?.arguments ?? fn?.input)}`)
      }
    }
    if (item.function_call) actions.push(`${item.function_call.name ?? 'tool'} ${stringify(item.function_call.arguments)}`)

    const content = item.content
    if (typeof content === 'string') {
      output.push(content)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'string') output.push(block)
        else if (block?.type === 'text' || block?.type === 'output_text') output.push(String(block.text ?? ''))
        else if (block?.type === 'tool_use' || block?.type === 'server_tool_use') actions.push(`${block.name ?? 'tool'} ${stringify(block.input)}`)
      }
    }
  }

  if (output.length === 0 && actions.length === 0) {
    throw new CanaryError(
      'no_evidence',
      `${name}: found no assistant messages or tool calls. Is it an Anthropic or OpenAI transcript? ` +
        'Otherwise pass what the agent did with --actions and what it wrote with --output.',
    )
  }
  return [
    { name: `${name} (assistant text)`, kind: 'output', text: output.join('\n') },
    { name: `${name} (tool calls)`, kind: 'actions', text: actions.join('\n') },
  ]
}

/**
 * @param {string} text
 * @param {string} name
 * @returns {any[]}
 */
function readItems(text, name) {
  const trimmed = text.trim()
  /** @type {any} */
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    try {
      parsed = trimmed
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
    } catch {
      throw new CanaryError('no_evidence', `${name}: not JSON or JSONL.`)
    }
  }
  if (Array.isArray(parsed)) return parsed.flatMap(unwrap)
  return unwrap(parsed)
}

/**
 * A transcript object, or a log line that wraps a message, to its messages or items.
 *
 * @param {any} value
 * @returns {any[]}
 */
function unwrap(value) {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value.messages)) return value.messages.flatMap(unwrap)
  /** @type {any[]} */
  const out = []
  if (Array.isArray(value.input)) out.push(...value.input.flatMap(unwrap))
  if (Array.isArray(value.output)) out.push(...value.output.flatMap(unwrap))
  if (out.length) return out
  // A Chat Completions response, or a log line with the message under "message".
  if (Array.isArray(value.choices)) return value.choices.map((/** @type {any} */ c) => c?.message).filter(Boolean)
  if (value.message && typeof value.message === 'object' && !value.role) return [value.message]
  // An Anthropic Messages response has role and content at the top level.
  return [value]
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringify(value) {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
