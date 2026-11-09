import { BIND_SHELLS } from "./bindShells";
import { CODE_SHELLS } from "./codeShells";
import { REVERSE_SHELLS } from "./reverseShells";
import { UPLOAD_SHELLS } from "./uploadShells";
import type { PayloadDef } from "./types";

export const SHELLS: PayloadDef[] = [...REVERSE_SHELLS, ...BIND_SHELLS, ...UPLOAD_SHELLS, ...CODE_SHELLS];
