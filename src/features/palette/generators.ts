import type { GeneratorId } from "../../engines/payloads/types";

/** Generators the palette and Arsenal browse offer next to commands and cards. Each one opens in Payloads. */
export const GENERATORS: { id: GeneratorId; title: string; category: string }[] = [
  { id: "transfer", title: "Transfer a file", category: "Shells-and-Transfers" },
];
