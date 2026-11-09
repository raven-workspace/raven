import { useState } from "react";
import { credLabel, credName, getCrackingCommands, identifyHash, isMachineAccount } from "../../engines/credentials";
import type { Credential } from "../../types/credentials";
import { Button, Chip, CommandBlock, labelClass } from "../../ui";
import { CrackDialog } from "./DockWork";
import { MASK, MaskedSecret } from "./MaskedSecret";
import { useCredentialMutations } from "./queries";

function HashRow({ eid, hash, onCrack }: { eid: string; hash: Credential; onCrack: () => void }) {
  const { setCrackStatus } = useCredentialMutations(eid);
  const label = credLabel(hash);
  const candidates = identifyHash(hash.secret, "windows");
  // The stored type wins over the top guess, so the command matches what the user chose.
  const cand = candidates.find((c) => c.name === hash.hashType) ?? candidates[0];
  const cmds = getCrackingCommands(hash.secret, cand);
  // The displayed command is built from the mask, never from the hash, so nothing can leak.
  const shown = getCrackingCommands(MASK, cand);
  const dead = hash.crackStatus === "uncrackable";
  return (
    <li className="col-span-full grid grid-cols-subgrid items-center gap-y-2 border-b border-line py-2">
      <span className="truncate font-mono text-code text-fg" title={credName(hash)}>{credName(hash)}</span>
      <span className="text-meta text-muted">{hash.hashType ?? cand?.name ?? "unknown type"}</span>
      <span><Chip variant={dead ? "warn" : "default"}>{hash.crackStatus ?? "uncracked"}</Chip></span>
      <MaskedSecret secret={hash.secret} label={`secret for ${label}`} />
      <span className="justify-self-end">
        <Button size="sm" aria-label={`Crack ${label}`} onClick={onCrack}>Crack</Button>
      </span>
      <span className="justify-self-end">
        {dead ? (
          <Button size="sm" aria-label={`Reset ${label}`} onClick={() => setCrackStatus.mutate({ id: hash.id, status: "uncracked" })}>Reset</Button>
        ) : (
          <Button size="sm" aria-label={`Mark ${label} uncrackable`} onClick={() => setCrackStatus.mutate({ id: hash.id, status: "uncrackable" })}>Mark uncrackable</Button>
        )}
      </span>
      {setCrackStatus.error && <p role="alert" className="col-span-full m-0 text-meta text-warn">{setCrackStatus.error.message}</p>}
      {(cmds.hashcat || cmds.john) && (
        <div className="col-span-full grid gap-1">
          {cmds.hashcat && <CommandBlock text={shown.hashcat ?? ""} copyText={cmds.hashcat} copyLabel="Copy hashcat command" />}
          {cmds.john && <CommandBlock text={cmds.john} copyText={cmds.john} copyLabel="Copy john command" />}
        </div>
      )}
    </li>
  );
}

export function HashesList({ eid, hashes: all }: { eid: string; hashes: Credential[] }) {
  // Machine-account passwords are machine-generated: not worth cracking.
  const hashes = all.filter((h) => !isMachineAccount(h));
  const [cracking, setCracking] = useState<Credential>();
  return (
    <section aria-label="Hashes" className="grid grid-cols-[minmax(0,1fr)] gap-1">
      <h3 className={`m-0 ${labelClass}`}>Hashes <span className="tabular-nums">{hashes.length}</span></h3>
      <ul className="m-0 grid list-none grid-cols-[minmax(16ch,2fr)_max-content_max-content_max-content_max-content_max-content] gap-x-3 border-t border-line p-0">
        {hashes.map((h) => (
          <HashRow key={h.id} eid={eid} hash={h} onCrack={() => setCracking(h)} />
        ))}
      </ul>
      {cracking && <CrackDialog eid={eid} hash={cracking} onClose={() => setCracking(undefined)} />}
    </section>
  );
}
