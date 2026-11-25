import type { LibraryCommand } from './types';
import type { CardMeta } from './types';

/** The vault's category folders, in the order the Arsenal lists them. */
export const CATEGORIES: readonly string[] = [
  'AV-Evasion',
  'Active-Directory',
  'Client-Side-Attacks',
  'Enumeration',
  'Exploitation',
  'Password-Attacks',
  'Pivoting',
  'Post-Exploitation',
  'PrivEsc-Linux',
  'PrivEsc-Windows',
  'Shells-and-Transfers',
  'Web',
];

const LABELS: Record<string, string> = {
  'Shells-and-Transfers': 'Shells & transfers',
  'PrivEsc-Linux': 'PrivEsc Linux',
  'PrivEsc-Windows': 'PrivEsc Windows',
};

/** Display name for a category slug: words, never folder slugs. */
export const categoryLabel = (slug: string): string =>
  LABELS[slug] ?? (slug.replace(/[-_]+/g, ' ').trim() || 'Other');

/** Alternative search terms per category. Never shown as categories themselves. */
export const CATEGORY_ALIASES: Record<string, string[]> = {
  Pivoting: ['lateral movement', 'tunneling', 'port forwarding'],
  'PrivEsc-Linux': ['privilege escalation', 'privesc'],
  'PrivEsc-Windows': ['privilege escalation', 'privesc'],
  'Shells-and-Transfers': ['file transfer', 'reverse shell'],
  'Password-Attacks': ['cracking', 'spraying'],
};

/** A command's category: its card's, else its own, else "Other". */
export const categoryOf = (c: LibraryCommand, cards: CardMeta[]): string => {
  if (c.cardId) {
    const card = cards.find((k) => k.id === c.cardId);
    if (card) return card.category;
  }
  return c.category ?? 'Other';
};

/** CATEGORIES plus any card category not already listed, sorted by label. */
export const allCategories = (cards: CardMeta[]): string[] => {
  const set = new Set<string>(CATEGORIES);
  for (const k of cards) if (k.category) set.add(k.category);
  return [...set].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));
};

/** Tags every command with `fallback`, except ids listed per category in `overrides`. */
export const withCategory = (
  commands: LibraryCommand[],
  fallback: string,
  overrides: Record<string, string[]> = {},
): LibraryCommand[] => {
  const byId = new Map<string, string>();
  for (const [category, ids] of Object.entries(overrides)) for (const id of ids) byId.set(id, category);
  const known = new Set(commands.map((c) => c.id));
  for (const id of byId.keys()) if (!known.has(id)) throw new Error(`category override for unknown command ${id}`);
  return commands.map((c) => ({ ...c, category: byId.get(c.id) ?? fallback }));
};
