export type HostRef = { ip: string } | { hostId: string } | { ranOn: true }; // ranOn = the entry's tagged/target host

export interface FoundCredential {
  username: string
  domain: string | null
  type: 'password' | 'hash'
  secret: string
  hashType: string | null
  scope: 'domain' | 'local'
  host: HostRef | null
  source: string
  machine?: boolean
}

export interface FoundAttempt {
  username: string
  domain: string | null
  secret: string
  secretKind: 'password' | 'hash'
  host: HostRef
  service: string
  result: 'admin' | 'valid' | 'failed' | 'errored'
  authMode: 'domain' | 'local'
}

export interface FoundCrack {
  hash: string
  plaintext: string
  username?: string
  /** john's `--format` (lowercased), set when the entry is placed: narrows a `user:password` line to one hash type. */
  format?: string
}

export interface FoundUsername {
  username: string
  domain: string | null
  host: HostRef | null
  source: string
}

export interface FoundVector {
  host: HostRef
  title: string
}

export interface FoundTick {
  host: HostRef | 'engagement'
  goalId: string
  parser: string
}

export interface Interpretation {
  parsers: string[]
  credentials: FoundCredential[]
  attempts: FoundAttempt[]
  cracks: FoundCrack[]
  usernames: FoundUsername[]
  vectors: FoundVector[]
  ticks: FoundTick[]
}

export interface InterpretInput {
  command: string
  output: string
  /** The output before ANSI stripping; set by interpret() for parsers that read colour (PEAS). */
  raw?: string
}

export interface Parser {
  id: string
  detect(i: InterpretInput): boolean
  parse(i: InterpretInput): Omit<Interpretation, 'parsers'>
}

const frozen = <T>(): T[] => Object.freeze([]) as unknown as T[]

// Frozen so no caller can mutate the shared constant; interpret() hands out fresh arrays.
export const EMPTY: Interpretation = {
  parsers: frozen(),
  credentials: frozen(),
  attempts: frozen(),
  cracks: frozen(),
  usernames: frozen(),
  vectors: frozen(),
  ticks: frozen(),
}
