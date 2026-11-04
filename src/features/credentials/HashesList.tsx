import { useState, type FormEvent } from "react";
import { credLabel, getCrackingCommands, identifyHash } from "../../engines/credentials";
import type { Credential } from "../../types/credentials";
import { Button, Chip, Dialog, Field, Input, labelClass } from "../../ui";
import { MASK, MaskedSecret } from "./MaskedSecret";
import { useCredentialMutations } from "./queries";

/** Plaintext for a hash. The server records a linked password; the hash then folds into it. */
export function CrackDialog({ eid, hash, onClose }: { eid: string; hash: Credential; onClose: () => void }) {
  const { crack } = useCredentialMutations(eid);
  const [plaintext, setPlaintext] = useState("");
  const [error, setError] = useState<string>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (crack.isPending) return;
    if (plaintext === "") return setError("Enter the cracked password");
    setError(undefined);
    crack.mutate({ hashId: hash.id, plaintext }, { onSuccess: onClose, onError: (err) => setError(err.message) });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Crack ${credLabel(hash)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="crack-form" variant="primary" disabled={crack.isPending}>Save password</Button>
        </>
      }
    >
      <form id="crack-form" onSubmit={submit} noValidate>
        <Field label="Plaintext" error={error}>
          <Input autoFocus mono type="password" autoComplete="off" value={plaintext} onChange={(e) => setPlaintext(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function CopyCommand({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      aria-label={`Copy ${label} command`}
      onClick={() => void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })}
    >
      {copied ? "Copied" : `Copy ${label}`}
    </Button>
  );
}

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
    <li className="flex flex-col gap-1 border-b border-line py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12.5px] text-fg">{label}</span>
        <Chip>{hash.hashType ?? cand?.name ?? "unknown type"}</Chip>
        <Chip className={dead ? "border-warn text-warn" : undefined}>{hash.crackStatus ?? "uncracked"}</Chip>
        <MaskedSecret secret={hash.secret} label={`hash ${label}`} />
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" aria-label={`Crack ${label}`} onClick={onCrack}>Crack</Button>
          {dead ? (
            <Button size="sm" aria-label={`Reset ${label}`} onClick={() => setCrackStatus.mutate({ id: hash.id, status: "uncracked" })}>Reset</Button>
          ) : (
            <Button size="sm" aria-label={`Mark ${label} uncrackable`} onClick={() => setCrackStatus.mutate({ id: hash.id, status: "uncrackable" })}>Mark uncrackable</Button>
          )}
        </span>
      </div>
      {setCrackStatus.error && <p role="alert" className="m-0 text-xs text-warn">{setCrackStatus.error.message}</p>}
      {(cmds.hashcat || cmds.john) && (
        <div className="flex flex-col gap-1">
          {cmds.hashcat && (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-xs text-fg-2">{shown.hashcat}</code>
              <CopyCommand label="hashcat" text={cmds.hashcat} />
            </div>
          )}
          {cmds.john && (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-xs text-fg-2">{cmds.john}</code>
              <CopyCommand label="john" text={cmds.john} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function HashesList({ eid, hashes }: { eid: string; hashes: Credential[] }) {
  const [cracking, setCracking] = useState<Credential>();
  return (
    <section aria-label="Hashes" className="flex flex-col gap-1">
      <h3 className={`m-0 ${labelClass}`}>Hashes <span className="tabular-nums">{hashes.length}</span></h3>
      <ul className="m-0 list-none border-t border-line p-0">
        {hashes.map((h) => (
          <HashRow key={h.id} eid={eid} hash={h} onCrack={() => setCracking(h)} />
        ))}
      </ul>
      {cracking && <CrackDialog eid={eid} hash={cracking} onClose={() => setCracking(undefined)} />}
    </section>
  );
}
