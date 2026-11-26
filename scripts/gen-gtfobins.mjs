// Regenerates src/engines/interpret/gtfobins.ts from a local clone of GTFOBins.
// Usage: node scripts/gen-gtfobins.mjs <path-to-GTFOBins.github.io-clone>
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const clone = process.argv[2]
if (!clone) throw new Error('usage: node scripts/gen-gtfobins.mjs <clone-path>')
const dir = join(clone, '_gtfobins')
const commit = execFileSync('git', ['-C', clone, 'log', '-1', '--format=%H (%cs)'], { encoding: 'utf8' }).trim()
const ORDER = ['suid', 'sudo', 'capabilities', 'limited-suid']

const found = {}
const alias = {}
for (const name of readdirSync(dir).sort()) {
  const front = readFileSync(join(dir, name), 'utf8').split('---')[1]
  const a = /^alias: (\S+)/m.exec(front)
  if (a) { alias[name] = a[1]; continue }
  const ctx = new Set([...front.matchAll(/^ {6}(sudo|suid|capabilities|limited-suid):/gm)].map((m) => m[1]))
  if (ctx.size) found[name] = ctx
}
for (const [name, target] of Object.entries(alias)) if (found[target]) found[name] = new Set(found[target])

const lines = [
  '// Bundled from the GTFOBins repository: https://github.com/GTFOBins/GTFOBins.github.io (_gtfobins/*).',
  '// GTFOBins is licensed GPL-3.0. Only the binary-to-mechanism mapping is bundled here; see NOTICE.',
  `// Commit ${commit}, fetched ${new Date().toISOString().slice(0, 10)}.`,
  "// Generated from each entry's `contexts:` keys (suid, sudo, capabilities, limited-suid); aliases copy their target.",
  '// This commit has no limited-suid contexts and no `sh` entry; the type keeps limited-suid for the interface.',
  '// Regenerate, do not hand-edit: node scripts/gen-gtfobins.mjs <path-to-GTFOBins.github.io-clone>',
  '',
  "export type GtfoMechanism = 'suid' | 'sudo' | 'capabilities' | 'limited-suid'",
  '',
  'export const GTFOBINS: Record<string, GtfoMechanism[]> = {',
]
for (const k of Object.keys(found).sort()) {
  const key = /^[A-Za-z_]\w*$/.test(k) ? k : `'${k}'`
  lines.push(`  ${key}: [${ORDER.filter((o) => found[k].has(o)).map((o) => `'${o}'`).join(', ')}],`)
}
lines.push('}', '')
writeFileSync(new URL('../src/engines/interpret/gtfobins.ts', import.meta.url), lines.join('\n'))
console.log(Object.keys(found).length)
