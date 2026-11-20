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
