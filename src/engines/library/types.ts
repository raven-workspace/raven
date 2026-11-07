export type LibraryOs = 'linux' | 'windows' | 'any';
export type RunFrom = 'attacker' | 'target';
export type ExamRule = 'banned' | 'metasploit';

export interface CommandMatcher {
  bins: string[];
  all?: string[];
  any?: string[];
  none?: string[];
}

export interface LibraryCommand {
  id: string;
  title: string;
  tool: string;
  template: string;
  os: LibraryOs;
  runFrom: RunFrom;
  goals: string[];
  why?: string;
  exam?: ExamRule;
  match?: CommandMatcher;
  source: 'oscp-notes' | 'raven' | 'operator' | 'field-manual';
  /** Field-manual entries only: the card's frontmatter `id` in the Field-Manual vault. */
  cardId?: string;
  /** Arsenal category slug (see categories.ts). Field-manual entries take their card's instead. */
  category?: string;
  tags?: string[];
  /** Built-ins only: lines that must / must not match `match` (tested). */
  matchExamples?: { hit: string[]; miss: string[] };
}

export interface CommandLibraryUser {
  added: (LibraryCommand & { updatedAt: string })[];
  edited: Record<string, Partial<LibraryCommand> & { updatedAt: string }>;
  /** id -> when it was retired. Retired iff present and later than `unretired[id]` (if any). */
  retired: Record<string, string>;
  /** id -> when it was restored. Lets a restore sync (retired merges per key, so its entry never goes away). */
  unretired?: Record<string, string>;
  /** goalId -> command ids */
  preferred: Record<string, { order: string[]; updatedAt: string }>;
}

export const EMPTY_LIBRARY_USER: CommandLibraryUser = {
  added: [],
  edited: {},
  retired: {},
  preferred: {},
};
