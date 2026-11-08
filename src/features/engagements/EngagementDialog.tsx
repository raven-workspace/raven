import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import type { Engagement, EngagementInput, EngagementKind } from "../../types/engagement";
import { dropPendingNotes } from "../notes/useNotesStore";
import { Button, Dialog, Field, Input, Textarea } from "../../ui";
import {
  DEFAULT_TIMEBOX_MINUTES,
  fromDateInput,
  fromDateTimeInput,
  parseScope,
  toDateInput,
  toDateTimeInput,
} from "./format";

const KINDS: { value: EngagementKind; label: string }[] = [
  { value: "exam-sim", label: "Exam sim" },
  { value: "lab", label: "Lab" },
  { value: "client", label: "Client" },
];

type FieldName =
  | "name"
  | "kind"
  | "client"
  | "subLabel"
  | "scopeCidrs"
  | "domain"
  | "startsAt"
  | "endsAt"
  | "timeboxStart"
  | "timeboxMinutes";

interface Draft {
  name: string;
  kind: EngagementKind;
  client: string;
  subLabel: string;
  startsAt: string;
  endsAt: string;
  scope: string;
  domain: string;
  timeboxStart: string;
  hours: string;
  minutes: string;
}

function draftFrom(e: Engagement | undefined): Draft {
  const tb = e?.timeboxMinutes ?? DEFAULT_TIMEBOX_MINUTES;
  return {
    name: e?.name ?? "",
    kind: e?.kind ?? "exam-sim",
    client: e?.client ?? "",
    subLabel: e?.subLabel ?? "",
    startsAt: toDateInput(e?.startsAt ?? null),
    endsAt: toDateInput(e?.endsAt ?? null),
    scope: e?.scopeCidrs.join("\n") ?? "",
    domain: e?.domain ?? "",
    timeboxStart: toDateTimeInput(e?.timeboxStart ?? null),
    hours: String(Math.floor(tb / 60)),
    minutes: String(tb % 60),
  };
}

const orNull = (s: string) => (s.trim() === "" ? null : s.trim());
const sentence = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * Builds the input. A date the user didn't touch keeps its stored value, so
 * editing doesn't round a timestamp to the minute (or day).
 */
function toInput(
  d: Draft,
  initial: Draft,
  e: Engagement | undefined,
): EngagementInput | { error: FieldName; msg: string } {
  const keep = <T,>(key: keyof Draft, stored: T | null | undefined, parse: (v: string) => T | null): T | null =>
    e && d[key] === initial[key] ? (stored ?? null) : parse(d[key]);

  const exam = d.kind === "exam-sim";
  let timeboxMinutes: number | null = null;
  if (exam) {
    const h = d.hours.trim() === "" ? 0 : Number(d.hours);
    const m = d.minutes.trim() === "" ? 0 : Number(d.minutes);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59) {
      return { error: "timeboxMinutes", msg: "Use whole hours and 0–59 minutes" };
    }
    timeboxMinutes = h * 60 + m;
  }
  return {
    name: d.name.trim(),
    kind: d.kind,
    client: d.kind === "client" ? orNull(d.client) : null,
    subLabel: orNull(d.subLabel),
    scopeCidrs: parseScope(d.scope),
    domain: orNull(d.domain),
    startsAt: keep("startsAt", e?.startsAt, fromDateInput),
    endsAt: keep("endsAt", e?.endsAt, fromDateInput),
    timeboxStart: exam ? keep("timeboxStart", e?.timeboxStart, fromDateTimeInput) : null,
    timeboxMinutes,
  };
}

/** Exam sim / Lab / Client, as a radio group of joined buttons. */
function KindPicker({
  value,
  onChange,
  labelId,
}: {
  value: EngagementKind;
  onChange: (k: EngagementKind) => void;
  labelId: string;
}) {
  const move = (e: KeyboardEvent, i: number) => {
    const d =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = KINDS[(i + d + KINDS.length) % KINDS.length]!;
    onChange(next.value);
    const group = (e.currentTarget as HTMLElement).parentElement;
    group?.querySelector<HTMLElement>(`[data-kind="${next.value}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="grid w-fit grid-flow-col rounded-sm border border-line-2">
      {KINDS.map((k, i) => {
        const on = k.value === value;
        return (
          <button
            key={k.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-kind={k.value}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(k.value)}
            onKeyDown={(e) => move(e, i)}
            className={cx(
              "h-8 cursor-default px-3 text-body transition-colors duration-100",
              i > 0 && "border-l border-line-2",
              on ? "bg-surface-hi text-fg shadow-[inset_0_-1px_0_var(--accent)]" : "text-muted-2 hover:text-fg",
            )}
          >
            {k.label}
          </button>
        );
      })}
    </div>
  );
}

export interface EngagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this engagement; create when absent. */
  engagement?: Engagement;
}

export function EngagementDialog({ open, onOpenChange, engagement }: EngagementDialogProps) {
  // Mounted only while open, so every open starts from a fresh draft.
  if (!open) return null;
  return <EngagementForm engagement={engagement} onClose={() => onOpenChange(false)} />;
}

function EngagementForm({ engagement, onClose }: { engagement: Engagement | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const [initial] = useState(() => draftFrom(engagement));
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<FieldName | "form", string>>>({});
  const [deleting, setDeleting] = useState(false);
  const kindLabelId = useId();
  const formId = useId();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: (input: EngagementInput) =>
      engagement ? api.engagementUpdate(engagement.id, input) : api.engagementCreate(input),
    onSuccess: (saved) => {
      qc.setQueryData(["engagement", saved.id], saved);
      void qc.invalidateQueries({ queryKey: ["engagements"] });
      void qc.invalidateQueries({ queryKey: ["engagement", saved.id] });
      // The scope may add hosts.
      void qc.invalidateQueries({ queryKey: ["hosts", saved.id] });
      void qc.invalidateQueries({ queryKey: ["progress"] });
      onClose();
    },
    onError: (err) => {
      const field = (err as { field?: string }).field;
      const msg = sentence(err.message);
      setErrors(field ? { [field === "scope" ? "scopeCidrs" : field]: msg } : { form: msg });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    if (d.name.trim() === "") {
      setErrors({ name: "Give it a name" });
      return;
    }
    const input = toInput(d, initial, engagement);
    if ("error" in input) {
      setErrors({ [input.error]: input.msg });
      return;
    }
    setErrors({});
    save.mutate(input);
  }

  const exam = d.kind === "exam-sim";
  const err = (f: FieldName) => errors[f];
  // Errors for fields this kind hides would be invisible: show them as form errors.
  const hidden =
    (!exam && (errors.timeboxStart || errors.timeboxMinutes)) || (d.kind !== "client" && errors.client) || errors.kind;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={engagement ? "Edit engagement" : "New engagement"}
      size="lg"
      footer={
        <>
          {engagement && (
            <Button variant="quiet-danger" className="mr-auto" onClick={() => setDeleting(true)}>
              Delete engagement
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={save.isPending}>
            {engagement ? "Save" : "Create engagement"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid gap-4">
        <Field label="Name" error={err("name")}>
          <Input autoFocus value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Mock exam A" />
        </Field>

        <div className="grid gap-2">
          <span id={kindLabelId} className="block text-meta text-muted-2">
            Kind
          </span>
          <KindPicker value={d.kind} onChange={(k) => set("kind", k)} labelId={kindLabelId} />
        </div>

        {d.kind === "client" && (
          <Field label="Client" error={err("client")}>
            <Input value={d.client} onChange={(e) => set("client", e.target.value)} placeholder="Acme Corp" />
          </Field>
        )}

        <Field label="Sub-label" hint="Short context, e.g. AD + 3 standalone, assumed breach" error={err("subLabel")}>
          <Input value={d.subLabel} onChange={(e) => set("subLabel", e.target.value)} />
        </Field>

        {exam && (
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Timebox start" hint="Leave empty until you start" error={err("timeboxStart")}>
              <Input
                type="datetime-local"
                mono
                value={d.timeboxStart}
                onChange={(e) => set("timeboxStart", e.target.value)}
              />
            </Field>
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-2 p-0 text-meta text-muted-2">
                Duration
              </legend>
              <div className="grid grid-flow-col items-center justify-start gap-2">
                <div className="w-16">
                  <Input
                    type="number"
                    mono
                    min={0}
                    aria-label="Hours"
                    aria-invalid={err("timeboxMinutes") ? true : undefined}
                    value={d.hours}
                    onChange={(e) => set("hours", e.target.value)}
                  />
                </div>
                <span className="text-meta text-muted">h</span>
                <div className="w-16">
                  <Input
                    type="number"
                    mono
                    min={0}
                    max={59}
                    aria-label="Minutes"
                    aria-invalid={err("timeboxMinutes") ? true : undefined}
                    value={d.minutes}
                    onChange={(e) => set("minutes", e.target.value)}
                  />
                </div>
                <span className="text-meta text-muted">m</span>
              </div>
              {err("timeboxMinutes") && <p className="m-0 text-meta text-warn">{err("timeboxMinutes")}</p>}
            </fieldset>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" error={err("startsAt")}>
            <Input type="date" mono value={d.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
          </Field>
          <Field label="End date" error={err("endsAt")}>
            <Input type="date" mono value={d.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
          </Field>
        </div>

        <Field label="Scope" hint="One CIDR or IP per line" error={err("scopeCidrs")}>
          <Textarea
            mono
            rows={3}
            value={d.scope}
            onChange={(e) => set("scope", e.target.value)}
            placeholder={"10.10.61.0/24\n10.10.10.5"}
          />
        </Field>

        <Field label="Domain" error={err("domain")}>
          <Input mono value={d.domain} onChange={(e) => set("domain", e.target.value)} placeholder="mock.exam" />
        </Field>

        {(errors.form || hidden) && <p className="m-0 text-meta text-warn">{errors.form ?? hidden}</p>}
      </form>
      {engagement && deleting && (
        <DeleteDialog engagement={engagement} onClose={() => setDeleting(false)} />
      )}
    </Dialog>
  );
}

/** The confirm step: typing the name is the guard. Deleting leaves for the dashboard. */
function DeleteDialog({ engagement: e, onClose }: { engagement: Engagement; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const del = useMutation({
    mutationFn: () => api.engagementDelete(e.id),
    onSuccess: () => {
      // Its notes are gone: unsaved text for them can never be saved.
      dropPendingNotes(e.id);
      qc.removeQueries({ queryKey: ["engagement", e.id] });
      void qc.invalidateQueries({ queryKey: ["engagements"] });
      void navigate("/");
    },
  });
  const match = typed === e.name;
  const confirm = () => match && !del.isPending && del.mutate();

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Delete engagement"
      description="This removes it and everything in it. It can't be undone; backups still hold older copies."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={!match || del.isPending} onClick={confirm}>
            Delete engagement
          </Button>
        </>
      }
    >
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          confirm();
        }}
      >
        <Field
          label={
            <>
              Type the engagement name to confirm: <span className="text-fg-2">{e.name}</span>
            </>
          }
          error={del.isError ? del.error.message : undefined}
        >
          <Input
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(ev) => setTyped(ev.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}
