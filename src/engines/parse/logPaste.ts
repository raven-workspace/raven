import type { CommandBlock } from '../../types/log'

export interface DetectedPrompt {
  shell: string
  command: string
}

type PromptRule = (m: RegExpExecArray) => string

// Ordered: first match wins. Each regex captures the command text as the last group.
const PROMPT_RULES: Array<[RegExp, PromptRule]> = [
  [/^\*Evil-WinRM\* PS [^>]*>[ \t]?(.*)$/, () => 'evil-winrm'],
  [/^PS [^>]*>[ \t]?(.*)$/, () => 'powershell'],
  [/^[A-Za-z]:\\[^>]*>(.*)$/, () => 'cmd'],
  [/^([\w.-]+@[\w.-]+):[^$#]*[$#](?:[ \t]+(.*))?$/, (m) => m[1]],
]
const BARE_PROMPT = /^[$#](?:[ \t]+(.*))?$/
/** Second line of Kali's default zsh prompt: `└─$ cmd` (or `└─#` as root). */
const KALI_PROMPT = /^└─[$#](?:[ \t]+(.*))?$/
/** First line of Kali's default zsh prompt, `┌──(kali㉿kali)-[~]`: names user and host, carries no command. */
const KALI_HEADER = /^┌──(?:\([^)]*\)─)*\(([^)㉿@\s]+)[㉿@]([^)\s]+)\)-\[[^\]]*\]\s*$/

/** `user@host` from a Kali prompt header line, or null. */
export function kaliPromptHeader(line: string): string | null {
  const m = KALI_HEADER.exec(line.trim())
  return m ? `${m[1]}@${m[2]}` : null
}

export function detectPrompt(line: string): DetectedPrompt | null {
  for (const [re, shellOf] of PROMPT_RULES) {
    const m = re.exec(line)
    if (m) return { shell: shellOf(m), command: (m[m.length - 1] ?? '').trim() }
  }
  const kali = KALI_PROMPT.exec(line)
  if (kali) return { shell: 'sh', command: (kali[1] ?? '').trim() }
  const bare = BARE_PROMPT.exec(line)
  if (bare) return { shell: 'sh', command: (bare[1] ?? '').trim() }
  return null
}

function finish(command: string, outputLines: string[], shell?: string): CommandBlock {
  const output = outputLines.join('\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd()
  return shell ? { command, output, shell } : { command, output }
}

/** Split a pasted terminal block (Warp copy, shell session) into command blocks. */
export function splitPaste(text: string): CommandBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (!lines.length) return []

  // A Kali header line is consumed: it names the shell of the `└─$` line under it.
  const headers = lines.map(kaliPromptHeader)
  const detected = lines.map((line, i) => {
    if (headers[i]) return null
    const d = detectPrompt(line)
    const header = i > 0 ? headers[i - 1] : null
    return d && header && KALI_PROMPT.test(line) ? { ...d, shell: header } : d
  })
  // Bare `$`/`#` lines only count when a distinctive prompt is also present.
  const hasStrong = detected.some((d) => d !== null && d.shell !== 'sh')
  const prompts = detected.map((d) => (d && (hasStrong || d.shell !== 'sh') ? d : null))

  if (!prompts.some(Boolean)) {
    return [finish(lines[0].trim(), lines.slice(1))]
  }

  const blocks: CommandBlock[] = []
  let cur: { command: string; shell?: string; out: string[] } | null = null
  const close = () => {
    if (cur) blocks.push(finish(cur.command, cur.out, cur.shell))
    cur = null
  }

  lines.forEach((line, i) => {
    if (headers[i] && prompts[i + 1]) return
    const p = prompts[i]
    if (p) {
      close()
      if (p.command) cur = { command: p.command, shell: p.shell, out: [] }
      return
    }
    if (cur) cur.out.push(line)
    else if (blocks.length) {
      // Output after an empty prompt: keep it with the previous block.
      const prev = blocks[blocks.length - 1]
      prev.output = (prev.output ? `${prev.output}\n${line}` : line).trimEnd()
    } else {
      // Text before the first prompt: the outer command and its output.
      cur = { command: line.trim(), out: [] }
    }
  })
  close()
  return blocks
}
