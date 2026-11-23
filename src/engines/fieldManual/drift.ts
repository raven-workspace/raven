import { COMPUTED_TOKENS } from '../checklist/fill';
import { resolveTemplate } from '../checklist/template';
import type { ChecklistGoal } from '../checklist/types';
import type { LibraryCommand } from '../library/types';
import type { ParsedCard } from './parseCard';
import type { PlaybookItem } from './parsePlaybook';
import type { ToolkitEntry } from './parseToolkit';
import { escapeRegExp } from '../regex';

export interface Drift {
  /** Playbook items no Raven step mirrors. */
  noStep: PlaybookItem[];
  /** Steps whose playbook text is no longer in its file (gone or reworded). */
  reworded: { goalId: string; text: string }[];
  /** Steps with no `playbook` field. */
  ravenOnlySteps: string[];
  /** Tokens Raven cannot fill, with the number of commands using each; `manual` = fine, you type these. */
  unfillable: { token: string; count: number; manual: boolean }[];
  /** Raven-source commands whose template is in no card. */
  ravenOnlyCommands: string[];
  /** Toolkit files no card command mentions (informational). */
  toolkitUnused: string[];
}

/** Arsenal-import spec §7 "stay manual": the user types these. */
export const MANUAL_TOKENS: ReadonlySet<string> = new Set([
  'FILE', 'SCRIPT', 'OUTPUT', 'SHARE', 'SPN', 'PARAM', 'NEW_USER', 'NEW_PASS', 'KALI_PASS',
  'LOCAL_PORT', 'LISTEN_PORT', 'BIND_PORT', 'TARGET_PORT', 'EDB_ID', 'DOMAIN_SID',
]);

/** Manual list, or Raven's `FILL_<X>` prefix ("you fill this in"), or `FILL_` plus a manual name. */
const isManual = (token: string): boolean => {
  const t = token.toUpperCase();
  return MANUAL_TOKENS.has(t) || t.startsWith('FILL_');
};

const COMPUTED = new Set<string>(COMPUTED_TOKENS);
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const base = (path: string): string => path.split('/').pop() ?? path;
/** The numbered playbooks (00 - Off-the-Bat … 06 - Lateral Movement); `99 - Im Stuck`, routines and the rest are not steps. */
const isStepPlaybook = (path: string): boolean => /^0\d /.test(base(path));
const UPPER_SNAKE = /^[A-Z][A-Z0-9_]*$/;

/** True when `file` appears in `text` as a whole name, not as part of a longer one (GodPotato-NET4.exe vs -NET40.exe). */
const mentions = (text: string, file: string): boolean =>
  new RegExp(`(?<![\\w.-])${escapeRegExp(file)}(?![\\w-]|\\.\\w)`).test(text);

/** `{TOKEN}`s in a template the fill engine neither knows nor computes. */
function unfilledTokens(template: string): Set<string> {
  const out = new Set<string>();
  // With an empty context only built-in tokens get a canonical name; the rest are unknown.
  for (const r of resolveTemplate(template, {}).ranges) {
    if (r.canonical === null && template[r.start] === '{' && UPPER_SNAKE.test(r.raw) && !COMPUTED.has(r.raw)) out.add(r.raw);
  }
  return out;
}

/**
 * What the vault and Raven disagree on (arsenal-import spec §5). Step mapping is exact (file name plus parsePlaybook text,
 * whitespace collapsed); there is no fuzzy matching.
 */
export function computeDrift(
  goals: ChecklistGoal[],
  playbook: PlaybookItem[],
  commands: LibraryCommand[],
  cards: ParsedCard[],
  toolkit: ToolkitEntry[],
): Drift {
  const key = (file: string, text: string) => `${base(file)}\n${norm(text)}`;
  const steps = playbook.filter((i) => isStepPlaybook(i.file));
  const mapped = new Set(goals.flatMap((g) => (g.playbook ?? []).map((p) => key(p.file, p.text))));
  const inVault = new Set(steps.map((i) => key(i.file, i.text)));

  const counts = new Map<string, number>();
  for (const c of commands) for (const t of unfilledTokens(c.template)) counts.set(t, (counts.get(t) ?? 0) + 1);

  const blocks = cards.flatMap((c) => c.blocks.map((b) => norm(b.template)));
  const blockText = blocks.join('\n');
  const cardTemplates = new Set(blocks);

  return {
    noStep: steps.filter((i) => !mapped.has(key(i.file, i.text))),
    reworded: goals.flatMap((g) =>
      (g.playbook ?? [])
        .filter((p) => isStepPlaybook(p.file) && !inVault.has(key(p.file, p.text)))
        .map((p) => ({ goalId: g.id, text: p.text })),
    ),
    ravenOnlySteps: goals.filter((g) => !g.playbook?.length).map((g) => g.id),
    unfillable: [...counts]
      .map(([token, count]) => ({ token, count, manual: isManual(token) }))
      .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token)),
    ravenOnlyCommands: commands.filter((c) => c.source === 'raven' && !cardTemplates.has(norm(c.template))).map((c) => c.id),
    toolkitUnused: [...new Set(toolkit.map((t) => t.file))].filter((f) => !mentions(blockText, f)),
  };
}
