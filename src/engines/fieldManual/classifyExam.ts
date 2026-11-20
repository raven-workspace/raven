import { isMetasploitLine } from '../checklist/examRules';
import type { ExamRule } from '../library/types';

/** A Meterpreter payload (staged `.../meterpreter/...` or stageless `meterpreter_reverse_*`) or a meterpreter prompt. */
export const METERPRETER = /meterpreter[/_]|^\s*meterpreter\s*>/i;
const BANNED_BINS = /^(?:sqlmap|sqlninja|nosqlmap|nessus|nessuscli|openvas|nexpose|gvm-.*)$/;

/** Wrapper commands that run the next word, and their options that take a value. */
const WRAPPERS: Record<string, Set<string>> = {
  sudo: new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U']),
  proxychains: new Set(['-f']),
  proxychains4: new Set(['-f']),
  time: new Set(['-f', '-o']),
  env: new Set(['-u', '-C', '-S']),
};

/** Drops leading wrapper commands (sudo, proxychains, time, env and their options) and a python interpreter. */
function stripWrappers(words: string[]): string[] {
  for (;;) {
    const opts = WRAPPERS[words[0] ?? ''];
    if (!opts) break;
    words.shift();
    while (words[0]?.startsWith('-')) {
      const w = words.shift()!;
      if (opts.has(w)) words.shift();
    }
  }
  if (/^python[\d.]*$/.test(words[0] ?? '')) words.shift();
  return words;
}

const nonCommentLines = (template: string): string[] => template.split('\n').filter((l) => !/^\s*#/.test(l));

/** Command words of each line segment, after any wrapper prefix; comment lines skipped. */
function commandSegments(template: string): string[][] {
  const out: string[][] = [];
  for (const line of nonCommentLines(template)) {
    for (const seg of line.split(/&&|\|\||[;|&`(]|\$\(/)) {
      const words = stripWrappers(seg.trim().split(/\s+/).filter((w) => w && !/^\w+=/.test(w)));
      if (words.length) out.push(words);
    }
  }
  return out;
}

const bin = (w: string): string => (w.split(/[\\/]/).pop() ?? w).toLowerCase().replace(/\.(?:py|exe)$/, '');

function runsBannedTool(template: string): boolean {
  return commandSegments(template).some((words) => {
    const b = bin(words[0]);
    if (BANNED_BINS.test(b)) return true;
    // Responder is allowed only as an analyse-mode listener; poisoning is the banned technique.
    return b === 'responder' && !words.some((w) => w === '--analyze' || /^-[a-zA-Z]*A[a-zA-Z]*$/.test(w));
  });
}

/**
 * The exam rule for an imported command. `banned` when its card is `exam: prohibited` or the command runs a
 * prohibited automatic tool (or Responder outside analyse mode); `metasploit` when a line spends the exam's
 * Metasploit use by the engine's own rule (`isMetasploitLine`: a module other than multi/handler) or uses a
 * Meterpreter payload. A multi/handler alone never counts. Only for vault-added commands: a matched built-in keeps
 * its own rule. The command's note is never read: its prose is not safe to keyword-match.
 */
export function classifyExam(template: string, cardExam?: string): ExamRule | undefined {
  if (cardExam === 'prohibited' || runsBannedTool(template)) return 'banned';
  const lines = nonCommentLines(template);
  if (lines.some((l) => isMetasploitLine(l) || METERPRETER.test(l))) return 'metasploit';
  return undefined;
}
