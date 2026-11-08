import type { FoundCrack, Parser } from './types'

// hashcat `hash:plain` lines. Kerberos hashes can hold ':' themselves (SPN port, asrep user@realm:checksum), so each is matched by shape.
const KRB5TGS = /^(\$krb5tgs\$.*?\$[0-9a-fA-F]{32}\$[0-9a-fA-F]+):(.+)$/
const KRB5ASREP = /^(\$krb5asrep\$(?:\d+\$)?[^:\s]+:[0-9a-fA-F]+\$[0-9a-fA-F]+):(.+)$/
const DCC2 = /^(\$DCC2\$\d+#[^#\s]+#[0-9a-fA-F]{32}):(.+)$/
// NetNTLM (Responder, ntlmrelayx captures): v2 `user::domain:challenge:ntproofstr:blob`, v1 `user::domain:lm:nt:challenge`.
// The hash is everything before the final `:plain`, exactly as captured.
const NETNTLMV2 = /^([^:\s]+::[^:\s]*:[0-9a-fA-F]{16}:[0-9a-fA-F]{32}:[0-9a-fA-F]+):(.+)$/
const NETNTLMV1 = /^([^:\s]+::[^:\s]*:[0-9a-fA-F]{48}:[0-9a-fA-F]{48}:[0-9a-fA-F]{16}):(.+)$/
// Bare hex digests are ambiguous (an `lm:nt` pair has the same shape), so they count only when the command is hashcat.
const HEX_DIGEST = /^([0-9a-fA-F]{32}|[0-9a-fA-F]{40}|[0-9a-fA-F]{64}|[0-9a-fA-F]{128}):(.+)$/

const JOHN_FOOTER = /^(\d+) password hash(?:es)? cracked, \d+ left\s*$/
// pwdump-style line: user:password:rid:lm:nt:::  (the password may itself contain ':')
const PWDUMP = /^([^:]+):(.*):\d+:[0-9a-fA-F]{32}:[0-9a-fA-F]{32}:::\s*$/
// unshadowed passwd line: user:password:uid:gid:gecos:home:shell
const PASSWD = /^([^:]+):(.*):\d+:\d+:[^:]*:[^:]*:[^:]*$/
// john prints `login:password` then the input line's remaining fields. A captured or cached hash leaves its tail:
// NetNTLMv2 `:domain:challenge:ntproofstr:blob`, NetNTLMv1 `:domain:lm:nt:challenge` (each after the empty field of
// `user::domain`, when john keeps it), DCC2 `: (date)` (secretsdump). The password is what comes before that tail.
const HASH_TAILS = [
  /^([^:]+):(.*?):(?::)?[^:\s]*:[0-9a-fA-F]{16}:[0-9a-fA-F]{32}:[0-9a-fA-F]+\s*$/,
  /^([^:]+):(.*?):(?::)?[^:\s]*:[0-9a-fA-F]{48}:[0-9a-fA-F]{48}:[0-9a-fA-F]{16}\s*$/,
  /^([^:]+):(.*?):\s*\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\)\s*$/,
]
// A *2john container file as field 1 (`archive.zip/web/settings.php:pass:web/settings.php:archive.zip:…`).
const CONTAINER_FILE = /^[^:\s]+\.(zip|rar|7z|pdf|docx?|xlsx?|pptx?|odt|ods|kdbx|php|txt|conf|config|xml|ini|key|pem|ppk|pfx|p12|gpg|db|sqlite)(\/[^:]*)?$/i
const JOHN_LIVE_MARKER = /^Press 'q' or Ctrl-C to abort/
const JOHN_NOISE = /^(\d+g\s|Use the |Session |Proceeding |Warning|Almost done|No password|Press |Loaded |Cost |Will run |Using default)/

function parseHashcat(lines: string[], isHashcat: boolean): FoundCrack[] {
  const out: FoundCrack[] = []
  for (const line of lines) {
    const m =
      KRB5TGS.exec(line) ?? KRB5ASREP.exec(line) ?? DCC2.exec(line) ?? NETNTLMV2.exec(line) ?? NETNTLMV1.exec(line) ??
      (isHashcat ? HEX_DIGEST.exec(line) : null)
    if (m) out.push({ hash: m[1], plaintext: m[2] })
  }
  return out
}

function parseJohnShow(lines: string[], showCommand: boolean): FoundCrack[] {
  const footer = lines.findIndex((l) => JOHN_FOOTER.test(l))
  let block: string[]
  if (footer >= 0) {
    if (Number(JOHN_FOOTER.exec(lines[footer])![1]) === 0) return []
    let end = footer
    while (end > 0 && lines[end - 1].trim() === '') end--
    let start = end
    while (start > 0 && lines[start - 1].trim() !== '') start--
    block = lines.slice(start, end)
  } else if (showCommand) {
    block = lines.filter((l) => l.trim() !== '' && !JOHN_NOISE.test(l))
  } else return []
  const out: FoundCrack[] = []
  for (const line of block) {
    const pw = PWDUMP.exec(line)
    if (pw) { out.push({ hash: '', plaintext: pw[2], username: pw[1] }); continue }
    const tail = HASH_TAILS.map((re) => re.exec(line)).find((m) => m)
    if (tail) { out.push({ hash: '', plaintext: tail[2], username: tail[1] }); continue }
    const pd = PASSWD.exec(line)
    if (pd) { out.push({ hash: '', plaintext: pd[2], username: pd[1] }); continue }
    const parts = line.split(':')
    if (parts.length < 2 || !parts[0]) continue
    // Container formats (zip, rar) print `file:password:path:...`: the password is the second field, and a ':' inside
    // it is inherently ambiguous (cut there, known limit). Otherwise the line is `user:password`, colons and all.
    const plaintext = CONTAINER_FILE.test(parts[0]) ? parts[1] : parts.slice(1).join(':')
    out.push({ hash: '', plaintext, username: parts[0] })
  }
  return out
}

function parseJohnLive(lines: string[]): FoundCrack[] {
  const start = lines.findIndex((l) => JOHN_LIVE_MARKER.test(l))
  if (start < 0) return []
  const out: FoundCrack[] = []
  for (const line of lines.slice(start + 1)) {
    if (JOHN_NOISE.test(line)) continue
    const m = /^(\S.*?)\s+\((.+)\)\s*$/.exec(line)
    if (m) out.push({ hash: '', plaintext: m[1], username: m[2] })
  }
  return out
}

function extract(command: string, output: string): FoundCrack[] {
  const lines = output.split('\n')
  const showCommand = /\bjohn\b/.test(command) && /--show\b/.test(command)
  const found = [
    ...parseHashcat(lines, /\bhashcat\b/.test(command)),
    ...parseJohnShow(lines, showCommand),
    ...parseJohnLive(lines),
  ]
  const seen = new Set<string>()
  return found.filter((c) => {
    const k = [c.hash, (c.username ?? '').toLowerCase(), c.plaintext].join('\u0000')
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export const cracked: Parser = {
  id: 'cracked',
  detect: (i) => extract(i.command, i.output).length > 0,
  parse: (i) => ({
    credentials: [], attempts: [], cracks: extract(i.command, i.output), usernames: [], vectors: [], ticks: [],
  }),
}
