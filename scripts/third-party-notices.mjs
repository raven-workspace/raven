// Writes THIRD_PARTY_NOTICES, the licences of everything Raven ships that it didn't write, and
// fails when a dependency's licence is missing or not on the allow-list.
//
//   npm run notices             rewrite THIRD_PARTY_NOTICES
//   npm run notices -- --check  fail if it is out of date (CI)
//
// Three sources, one allow-list (`accepted` in src-tauri/about.toml):
// - Rust crates: cargo-about, for the shipped targets, with the `terminal` feature so libghostty-vt
//   and portable-pty are listed before the terminal ships. Offline, so the output depends only on
//   Cargo.lock and not on what GitHub serves that day.
// - npm packages: every package in package-lock.json that isn't a dev dependency, with the licence
//   files inside the package.
// - third-party/built-in.json: C and Zig libraries that crates compile from source, and fonts.
//
// Needs cargo-about at CARGO_ABOUT_VERSION (`cargo install --locked cargo-about --features cli
// --version <it>`) and an installed node_modules (`npm ci`).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const CARGO_ABOUT_VERSION = '0.9.3'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'THIRD_PARTY_NOTICES')
const check = process.argv.includes('--check')
const problems = []

// ---- The allow-list ----

/** `accepted` from about.toml, in its order: the order also sets which licence of an OR is named. */
function readAccepted() {
  const toml = readFileSync(join(root, 'src-tauri/about.toml'), 'utf8')
  const body = /^accepted = \[([\s\S]*?)^\]/m.exec(toml)
  if (!body) throw new Error('src-tauri/about.toml: no `accepted = [...]` list')
  return [...body[1].replace(/#.*$/gm, '').matchAll(/"([^"]+)"/g)].map((m) => m[1])
}
const accepted = readAccepted()

/** Parses an SPDX expression into a tree of { and | or: [...] } and { id } leaves. */
export function parseSpdx(expr) {
  const tokens = expr.replace(/[()]/g, ' $& ').trim().split(/\s+/)
  let i = 0
  const peek = () => tokens[i]
  const fail = () => { throw new Error(`can't read the licence expression "${expr}"`) }
  function atom() {
    const t = tokens[i++]
    if (t === '(') {
      const e = or()
      if (tokens[i++] !== ')') fail()
      return e
    }
    if (!t || /^(AND|OR|WITH|\))$/i.test(t)) fail()
    if (peek()?.toUpperCase() === 'WITH') {
      i++
      const exception = tokens[i++]
      if (!exception) fail()
      return { id: `${t} WITH ${exception}` }
    }
    return { id: t }
  }
  function and() {
    const parts = [atom()]
    while (peek()?.toUpperCase() === 'AND') { i++; parts.push(atom()) }
    return parts.length === 1 ? parts[0] : { and: parts }
  }
  function or() {
    const parts = [and()]
    while (peek()?.toUpperCase() === 'OR') { i++; parts.push(and()) }
    return parts.length === 1 ? parts[0] : { or: parts }
  }
  const tree = or()
  if (i !== tokens.length) fail()
  return tree
}

/** The licences an expression is used under: each AND needs all, each OR the earliest-listed one. Null if none fits. */
export function chooseLicences(tree, list) {
  if (tree.id) return list.includes(tree.id) ? [tree.id] : null
  if (tree.and) {
    const all = tree.and.map((t) => chooseLicences(t, list))
    return all.some((c) => c === null) ? null : [...new Set(all.flat())]
  }
  const options = tree.or.map((t) => chooseLicences(t, list)).filter((c) => c !== null)
  if (options.length === 0) return null
  const rank = (c) => Math.max(...c.map((id) => list.indexOf(id)))
  return options.reduce((best, c) => (rank(c) < rank(best) ? c : best))
}

/** The licences `expr` is used under, or a problem recorded against `who`. */
function allowed(who, expr) {
  if (typeof expr !== 'string' || expr.trim() === '') {
    problems.push(`${who}: no licence`)
    return null
  }
  let chosen
  try {
    chosen = chooseLicences(parseSpdx(expr), accepted)
  } catch (e) {
    problems.push(`${who}: ${e.message}`)
    return null
  }
  if (!chosen) problems.push(`${who}: "${expr}" is not on the allow-list in src-tauri/about.toml`)
  return chosen
}

// ---- Licence texts, shared by every entry that has the same text ----

const texts = new Map() // normalised text -> { id, text }
function normalise(text) {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^\n+|\s+$/g, '')
}
/** Registers a licence text and returns its key. */
function addText(licence, text) {
  const t = normalise(text)
  if (!texts.has(t)) texts.set(t, { licence, text: t })
  return t
}

// ---- Rust crates ----

function rustCrates() {
  let version = ''
  try {
    version = execFileSync('cargo', ['about', '--version'], { encoding: 'utf8' }).trim()
  } catch {
    // reported below
  }
  if (version !== `cargo-about ${CARGO_ABOUT_VERSION}`) {
    throw new Error(
      `needs cargo-about ${CARGO_ABOUT_VERSION}, found "${version || 'none'}". Install it with:\n` +
        `  cargo install --locked cargo-about --features cli --version ${CARGO_ABOUT_VERSION}`,
    )
  }
  const manifest = join(root, 'src-tauri/Cargo.toml')
  // Offline below, so fetch first: a fresh clone hasn't downloaded every target's crates.
  execFileSync('cargo', ['fetch', '--locked', '--manifest-path', manifest], { stdio: ['ignore', 'ignore', 'inherit'] })
  let json
  try {
    json = execFileSync(
      'cargo',
      ['about', 'generate', '--format', 'json', '--fail', '--locked', '--offline', '--features', 'terminal', '--manifest-path', manifest],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
    )
  } catch {
    // cargo-about has printed which crates failed and why.
    problems.push('Rust crates: cargo-about rejected the licences above (see src-tauri/about.toml)')
    return []
  }
  const about = JSON.parse(json)
  const crates = new Map()
  for (const l of about.licenses) {
    const key = addText(l.id, l.text)
    for (const { crate } of l.used_by) {
      const id = `${crate.name}@${crate.version}`
      if (!crates.has(id)) {
        crates.set(id, {
          name: crate.name,
          version: crate.version,
          expr: crate.license ?? '',
          url: crate.repository ?? crate.homepage ?? sourceUrl(crate.source),
          licences: new Set(),
          texts: new Set(),
        })
      }
      crates.get(id).licences.add(l.id)
      crates.get(id).texts.add(key)
    }
  }
  return [...crates.values()]
}

/** A git dependency's URL, from cargo's `git+https://…?rev=…#commit` source. */
function sourceUrl(source) {
  const git = /^git\+([^?#]+)/.exec(source ?? '')
  return git ? git[1] : ''
}

// ---- npm packages ----

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i

function npmPackages() {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const out = []
  for (const [path, p] of Object.entries(lock.packages)) {
    // "" is Raven itself; dev and devOptional packages never reach the app bundle.
    if (path === '' || p.dev || p.devOptional) continue
    const name = p.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    const who = `npm ${name}@${p.version}`
    const dir = join(root, path)
    if (!existsSync(dir)) throw new Error(`${path} is not installed: run npm ci first`)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const expr = typeof pkg.license === 'string' ? pkg.license : p.license
    const licences = allowed(who, expr)
    if (!licences) continue
    const files = readdirSync(dir)
      .filter((f) => LICENCE_FILE.test(f) && statSync(join(dir, f)).isFile())
      .sort()
    let text = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n\n')
    if (files.length === 0) {
      // No file in the package: the standard text, naming the author from package.json.
      if (licences.length !== 1 || !existsSync(join(root, `third-party/templates/${licences[0]}.txt`))) {
        problems.push(`${who}: no licence file in the package, and no third-party/templates/${licences.join('+')}.txt to use instead`)
        continue
      }
      const holder = authorName(pkg.author) || `the authors of ${name}`
      text = readFileSync(join(root, `third-party/templates/${licences[0]}.txt`), 'utf8').replace('{{holder}}', holder)
    }
    out.push({
      name,
      version: p.version,
      expr,
      url: repoUrl(pkg.repository) || pkg.homepage || '',
      licences: new Set(licences),
      texts: new Set([addText(licences.join(' AND '), text)]),
    })
  }
  // One entry per name and version, even when npm installed it in two places.
  const seen = new Set()
  return out.filter((p) => {
    const id = `${p.name}@${p.version}`
    return seen.has(id) ? false : seen.add(id)
  })
}

function authorName(author) {
  if (typeof author === 'string') return author.replace(/\s*[<(].*$/, '').trim()
  return author?.name ?? ''
}

function repoUrl(repo) {
  const url = typeof repo === 'string' ? repo : repo?.url
  if (!url) return ''
  if (/^github:/.test(url) || /^[\w-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url.replace(/^github:/, '')}`
  return url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://').replace(/\.git$/, '')
}

// ---- Built-in components ----

function builtIn() {
  const { components } = JSON.parse(readFileSync(join(root, 'third-party/built-in.json'), 'utf8'))
  const out = []
  for (const c of components) {
    const licences = allowed(`built-in ${c.name}`, c.license)
    if (!licences) continue
    const text = c.files.map((f) => readFileSync(join(root, f), 'utf8')).join('\n\n')
    out.push({ ...c, expr: c.license, licences: new Set(licences), texts: new Set([addText(licences.join(' AND '), text)]) })
  }
  return out
}

// ---- The file ----

const WIDTH = 100

function heading(title) {
  return `${title}\n${'='.repeat(title.length)}\n`
}

function render(built, crates, npm) {
  // Texts are numbered in licence order, then text order, so the numbering only moves when the texts do.
  const ordered = [...texts.values()].sort((a, b) =>
    a.licence === b.licence ? (a.text < b.text ? -1 : 1) : a.licence < b.licence ? -1 : 1,
  )
  const number = new Map(ordered.map((t, i) => [t.text, i + 1]))
  const refs = (entry) => [...entry.texts].map((t) => number.get(t)).sort((a, b) => a - b).map((n) => `[${n}]`).join(' ')
  const byName = (a, b) => (a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1)

  const entry = (e, extra = []) =>
    [
      `${e.name} ${e.version}`,
      `    Licence: ${e.expr}${[...e.licences].join(' AND ') === e.expr ? '' : ` (used under ${[...e.licences].join(' AND ')})`}. Text ${refs(e)}`,
      ...(e.url ? [`    ${e.url}`] : []),
      ...extra,
    ].join('\n')

  const parts = [
    heading('Third-party notices for Raven Workspace Community Edition'),
    [
      'Raven is free software under the GNU Affero General Public License, version 3 only',
      '(AGPL-3.0-only). It is built with the open source software below, each part under its own',
      'licence. Each entry names its licence and points to the full text, numbered, at the end.',
      '',
      'Generated from Cargo.lock, package-lock.json and third-party/built-in.json by',
      '`npm run notices`. Do not edit it by hand.',
      '',
      `1. Built into Raven: ${built.length}`,
      `2. Rust crates: ${crates.length}`,
      `3. npm packages: ${npm.length}`,
      `4. Licence texts: ${ordered.length}`,
      '',
    ].join('\n'),
    heading('1. Built into Raven'),
    'Libraries compiled from source inside a Rust crate, and fonts, which no package manager lists.\n',
    built.map((c) => entry(c, [`    ${c.use}`])).join('\n\n') + '\n',
    heading('2. Rust crates'),
    crates.sort(byName).map((c) => entry(c)).join('\n\n') + '\n',
    heading('3. npm packages'),
    npm.sort(byName).map((p) => entry(p)).join('\n\n') + '\n',
    heading('4. Licence texts'),
    ordered.map((t, i) => `${'-'.repeat(WIDTH)}\n[${i + 1}] ${t.licence}\n${'-'.repeat(WIDTH)}\n\n${t.text}\n`).join('\n'),
  ]
  return parts.join('\n')
}

function main() {
  const built = builtIn()
  const crates = rustCrates()
  const npm = npmPackages()
  if (problems.length > 0) {
    console.error(`THIRD_PARTY_NOTICES: ${problems.length} dependency licence problem(s):\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  const text = render(built, crates, npm)
  const name = relative(root, outFile)
  if (check) {
    const current = existsSync(outFile) ? readFileSync(outFile, 'utf8') : ''
    if (current !== text) {
      console.error(`${name} is out of date. Run \`npm run notices\` and commit the result.`)
      process.exit(1)
    }
    console.log(`${name} is up to date: ${built.length} built in, ${crates.length} crates, ${npm.length} npm packages.`)
    return
  }
  writeFileSync(outFile, text)
  console.log(`Wrote ${name}: ${built.length} built in, ${crates.length} crates, ${npm.length} npm packages, ${texts.size} licence texts.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
