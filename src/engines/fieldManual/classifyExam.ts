import type { ExamRule } from '../library/types';

const METASPLOIT = /\bmsfconsole\b|\bmeterpreter\b|\buse\s+(?:exploit|auxiliary|post)\//i;
const MSFVENOM_METERPRETER = /\bmsfvenom\b[\s\S]*\bmeterpreter\b/i;
const BANNED_NOTE = /\b(?:banned|prohibited)\b/i;

/**
 * The exam rule for an imported command. `banned` when its card is `exam: prohibited` or its note says it is
 * banned or prohibited; `metasploit` when it drives Metasploit; otherwise none.
 */
export function classifyExam(template: string, cardExam?: string, note?: string): ExamRule | undefined {
  if (cardExam === 'prohibited' || (note && BANNED_NOTE.test(note))) return 'banned';
  if (METASPLOIT.test(template) || MSFVENOM_METERPRETER.test(template)) return 'metasploit';
  return undefined;
}
