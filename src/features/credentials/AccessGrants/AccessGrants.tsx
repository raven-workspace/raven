import { useState } from "react";
import type { AccessGrant, AccessGrantInput, AccessLevel, Username } from "../../../types/credentials";
import type { Host } from "../../../types/host";
import { X } from "@phosphor-icons/react";
import { Button, Chip, ChipSet, Dialog, Field, IconButton, Input, Select } from "../../../ui/index";
import { ConfirmDelete } from "../../checklist/ConfirmDelete/ConfirmDelete";
import { usernameLabel } from "../../../engines/credentials/index";
import { useAccessGrantMutations } from "../queries";
import { hostLabel } from "../../../lib/hostName";
import "./AccessGrants.scss";

export const LEVEL_LABEL: Record<AccessLevel, string> = { user: "user", admin: "admin", system: "SYSTEM / root" };
export const LEVEL_OPTIONS = (Object.keys(LEVEL_LABEL) as AccessLevel[]).map((value) => ({ value, label: LEVEL_LABEL[value] }));


export interface AccessDraft {
  hostId: string;
  level: AccessLevel;
  via: string;
}
export const EMPTY_ACCESS: AccessDraft = { hostId: "", level: "user", via: "" };

/** Host, level and via: the fields of an access grant. */
export function AccessFields({ value, onChange, hosts, errors = {} }: {
  value: AccessDraft;
  onChange: (v: AccessDraft) => void;
  hosts: Host[];
  errors?: Partial<Record<"hostId" | "via", string>>;
}) {
  return (
    <div className="access-fields">
      <Field label="Access on host" error={errors.hostId}>
        <Select
          placeholder="Pick a host"
          options={hosts.map((h) => ({ value: h.id, label: hostLabel(h) }))}
          value={value.hostId || undefined}
          onValueChange={(hostId) => onChange({ ...value, hostId })}
        />
      </Field>
      <Field label="Access level">
        <Select options={LEVEL_OPTIONS} value={value.level} onValueChange={(level) => onChange({ ...value, level: level as AccessLevel })} />
      </Field>
      <Field label="Access via" error={errors.via}>
        <Input value={value.via} onChange={(e) => onChange({ ...value, via: e.target.value })} placeholder="webshell" />
      </Field>
    </div>
  );
}

/** A username's grants as small removable chips with the access route beside them. */
export function AccessGrantTags({ eid, username, grants, hosts }: {
  eid: string;
  username: Username;
  grants: AccessGrant[];
  hosts: Host[];
}) {
  const { remove } = useAccessGrantMutations(eid);
  const [removing, setRemoving] = useState<AccessGrant>();
  if (grants.length === 0) return null;
  const name = usernameLabel(username);
  return (
    <>
      <div role="group" aria-label={`Access as ${name}`}>
        <ChipSet>
          {grants.map((g) => {
            const host = hostLabel(hosts.find((h) => h.id === g.hostId));
            return (
              <div key={g.id} className="access-grant-tag">
                <Chip variant="accent">{LEVEL_LABEL[g.level]} on {host}</Chip>
                {g.via ? <span className="access-grant-tag__via">via {g.via}</span> : <span aria-hidden />}
                <IconButton icon={X} label={`Remove access as ${name} on ${host}`} onClick={() => setRemoving(g)} />
              </div>
            );
          })}
        </ChipSet>
      </div>
      {removing && (
        <ConfirmDelete
          title={`Remove ${LEVEL_LABEL[removing.level]} access as ${name}?`}
          pending={remove.isPending}
          error={remove.error?.message}
          label="Remove access"
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => remove.mutate(removing.id, { onSuccess: () => setRemoving(undefined) })}
        />
      )}
    </>
  );
}

/**
 * Records access on a host: the host, the level and how it was gained. Shared by "Add access" on a username and
 * "Convert to access-only" on a credential; `onSubmit` runs the mutation and reports a failure through `onError`.
 */
export function AccessGrantDialog({ title, description, action, hosts, pending, onSubmit, onClose }: {
  title: string;
  description?: string;
  action: string;
  hosts: Host[];
  pending: boolean;
  onSubmit: (grant: AccessGrantInput, onError: (message: string) => void) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AccessDraft>(EMPTY_ACCESS);
  const [errors, setErrors] = useState<{ hostId?: string; via?: string; form?: string }>({});
  const save = () => {
    const errs = {
      ...(draft.hostId === "" ? { hostId: "Choose a host" } : {}),
      ...(draft.via.trim() === "" ? { via: "Say how access was gained" } : {}),
    };
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSubmit({ hostId: draft.hostId, level: draft.level, via: draft.via.trim() }, (form) => setErrors({ form }));
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={title}
      {...(description ? { description } : {})}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending} onClick={save}>{action}</Button>
        </>
      }
    >
      <AccessFields value={draft} onChange={setDraft} hosts={hosts} errors={errors} />
      {errors.form && <p role="alert" className="access-grant-dialog__error">{errors.form}</p>}
    </Dialog>
  );
}
