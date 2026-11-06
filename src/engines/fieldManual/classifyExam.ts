import type { ExamRule } from '../library/types';

const METASPLOIT = /\bmsfconsole\b|\bmeterpreter\b|\buse\s+(?:exploit|auxiliary|post)\//i;
const MSFVENOM_METERPRETER = /\bmsfvenom\b[\s\S]*\bmeterpreter\b/i;
const BANNED_BINS = /^(?:sqlmap|sqlninja|nosqlmap|nessus|nessuscli|openvas|nexpose|gvm-.*)$/;

/** Command words of each line segment (after an optional sudo / python), comment lines skipped. */
function commandSegments(template: string): string[][] {
  const out: string[][] = [];
  for (const line of template.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    for (const seg of line.split(/&&|\|\||[;|&`(]|\$\(/)) {
      const words = seg.trim().split(/\s+/).filter((w) => w && !/^\w+=/.test(w));
      if (words[0] === 'sudo') {
        words.shift();
        while (words[0]?.startsWith('-')) words.shift();
      }
      if (/^python[\d.]*$/.test(words[0] ?? '')) words.shift();
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
    return b === 'responder' && !words.some((w) => w === '-A' || w === '--analyze');
  });
}

/**
 * The exam rule for an imported command. `banned` when its card is `exam: prohibited` or the command runs a
 * prohibited automatic tool (or Responder outside analyse mode); `metasploit` when it drives Metasploit.
 * `note` is accepted for compatibility and ignored: its prose is not safe to keyword-match.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function classifyExam(template: string, cardExam?: string, _note?: string): ExamRule | undefined {
  if (cardExam === 'prohibited' || runsBannedTool(template)) return 'banned';
  if (METASPLOIT.test(template) || MSFVENOM_METERPRETER.test(template)) return 'metasploit';
  return undefined;
}
