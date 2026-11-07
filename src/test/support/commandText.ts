/**
 * A text matcher for a command block: the command renders one span per word, so match the whole `<pre>` text.
 * `findByText(commandText("nmap -sV 10.0.0.5"))`, or a RegExp for part of it.
 */
export const commandText = (want: string | RegExp) => (_: string, el: Element | null): boolean => {
  if (el?.tagName !== "PRE") return false;
  const text = el.textContent ?? "";
  return typeof want === "string" ? text === want : want.test(text);
};
