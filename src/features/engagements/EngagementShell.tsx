import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import { isFreeKey, useEscapeTo, useKeydown, useNow } from "../../lib/keys";
import type { Engagement, EngagementStatus } from "../../types/engagement";
import { Button, Chip, Dialog, EmptyState, Field, Input, Kbd, labelClass } from "../../ui";
import { TimeBar } from "./ActiveCard";
import { EngagementDialog } from "./EngagementDialog";
import {
  EMPTY_PROGRESS,
  KIND_LABEL,
  dateRange,
  formatDuration,
  hasTimebox,
  progressLine,
  scopeSummary,
  timeLeft,
  timeboxElapsed,
} from "./format";

const SECTIONS = [
  { id: "board", label: "Board", empty: "Board arrives in build step 2" },
  { id: "log", label: "Log", empty: "Log arrives in a later build step" },
  { id: "credentials", label: "Credentials", empty: "Credentials arrive in a later build step" },
  { id: "findings", label: "Findings", empty: "Findings arrive in a later build step" },
  { id: "checklist", label: "Engagement checklist", empty: "The engagement checklist arrives in a later build step" },
  { id: "report", label: "Report", empty: "Report arrives in phase 3" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function EngagementShell() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["engagement", id],
    queryFn: () => api.engagementGet(id),
    initialData: () => qc.getQueryData<Engagement[]>(["engagements"])?.find((e) => e.id === id),
  });
  const [section, setSection] = useState<SectionId>("board");

  useEscapeTo("/");
  useKeydown((e) => {
    if (!isFreeKey(e)) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= SECTIONS.length) {
      e.preventDefault();
      setSection(SECTIONS[n - 1]!.id);
    }
  });

  if (query.isError) {
    const missing = (query.error as { code?: string }).code === "not_found";
    return (
      <div className="px-8 py-6">
        <EmptyState
          title={missing ? "Engagement not found" : "Couldn't load this engagement"}
          body={missing ? "It may have been deleted." : query.error.message}
          action={
            <Link to="/" className="text-[13px] text-fg-2 hover:text-fg">
              Back to engagements
            </Link>
          }
        />
      </div>
    );
  }
  if (!query.data) return null;
  const e = query.data;
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="grid h-full min-h-0 grid-cols-[200px_1fr]">
      <Sidebar section={section} onSection={setSection} />
      <div className="flex min-h-0 min-w-0 flex-col">
        <EngagementHeader engagement={e} />
        <StatusStrip engagement={e} />
        <main className="min-h-0 flex-1 overflow-auto px-6 py-5">
          <EmptyState
            title={current.empty}
            body={
              section === "board"
                ? "Hosts will sit here in columns by stage: Enumerate, Foothold, Privesc, Loot / pivot, Done."
                : undefined
            }
          />
        </main>
      </div>
    </div>
  );
}

function Sidebar({ section, onSection }: { section: SectionId; onSection: (s: SectionId) => void }) {
  const hostsId = useId();
  return (
    <nav
      aria-label="Engagement"
      className="flex min-h-0 flex-col gap-px overflow-y-auto border-r border-line px-3 py-3.5"
    >
      {SECTIONS.map((s, i) => {
        const on = s.id === section;
        return (
          <button
            key={s.id}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => onSection(s.id)}
            className={cx(
              "flex h-[30px] cursor-default items-center justify-between rounded-sm px-2 text-left text-[13px] transition-colors duration-100",
              on
                ? "bg-surface-hi text-fg shadow-[inset_2px_0_0_var(--accent)]"
                : "text-muted-2 hover:bg-surface hover:text-fg",
            )}
          >
            <span className="truncate">{s.label}</span>
            <span aria-hidden className="font-mono text-[10.5px] text-faint">
              {i + 1}
            </span>
          </button>
        );
      })}
      <h2 id={hostsId} className="m-0 mt-5 mb-1.5 px-2 text-[10.5px] font-semibold uppercase tracking-label text-faint">
        Hosts
      </h2>
      <p aria-labelledby={hostsId} className="m-0 px-2 text-xs text-faint">
        No hosts yet
      </p>
    </nav>
  );
}

function EngagementHeader({ engagement: e }: { engagement: Engagement }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = scopeSummary(e.scopeCidrs);
  const archived = e.status === "archived";

  const setStatus = useMutation({
    mutationFn: (status: EngagementStatus) => api.engagementSetStatus(e.id, status),
    onSuccess: (saved) => {
      setError(null);
      qc.setQueryData(["engagement", saved.id], saved);
      void qc.invalidateQueries({ queryKey: ["engagements"] });
    },
    onError: (err) => setError(err.message),
  });

  return (
    <header className="flex shrink-0 flex-col gap-1 border-b border-line px-6 pt-4 pb-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="m-0 truncate text-xl font-semibold tracking-[-0.01em] text-fg">{e.name}</h1>
        <Chip>{KIND_LABEL[e.kind]}</Chip>
        {e.subLabel && <Chip>{e.subLabel}</Chip>}
        {archived && <Chip>archived</Chip>}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate(archived ? "active" : "archived")}
          >
            {archived ? "Unarchive" : "Archive"}
          </Button>
          <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        </div>
      </div>
      {(e.client || scope || e.domain) && (
        <p className="m-0 flex flex-wrap items-baseline gap-x-3 text-xs text-muted">
          {e.client && <span className="text-muted-2">{e.client}</span>}
          {scope && <span className="font-mono text-[11.5px]">{e.scopeCidrs.join("  ")}</span>}
          {e.domain && <span className="font-mono text-[11.5px]">{e.domain}</span>}
        </p>
      )}
      {error && <p className="m-0 text-xs text-warn">{error}</p>}
      <EngagementDialog open={editing} onOpenChange={setEditing} engagement={e} />
      {deleting && (
        <DeleteDialog
          engagement={e}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            qc.removeQueries({ queryKey: ["engagement", e.id] });
            void qc.invalidateQueries({ queryKey: ["engagements"] });
            void navigate("/");
          }}
        />
      )}
    </header>
  );
}

function DeleteDialog({
  engagement: e,
  onClose,
  onDeleted,
}: {
  engagement: Engagement;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const del = useMutation({ mutationFn: () => api.engagementDelete(e.id), onSuccess: onDeleted });
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
              Type the engagement name to confirm:{" "}
              <span className="normal-case tracking-normal text-fg-2">{e.name}</span>
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

function StatusStrip({ engagement: e }: { engagement: Engagement }) {
  const now = useNow();
  return (
    <div
      role="status"
      aria-label="Engagement status"
      className="flex h-9 shrink-0 items-center gap-5 border-b border-line px-6 text-xs text-muted-2"
    >
      {hasTimebox(e) ? (
        <TimeboxStatus start={e.timeboxStart} minutes={e.timeboxMinutes} now={now} />
      ) : (
        <span>{dateRange(e.startsAt, e.endsAt, now)}</span>
      )}
      <span className="text-fg-2">{progressLine(EMPTY_PROGRESS)}</span>
      <span className="ml-auto flex items-center gap-1.5 text-faint">
        <Kbd>1</Kbd>–<Kbd>6</Kbd> sections <Kbd className="ml-2">esc</Kbd> engagements
      </span>
    </div>
  );
}

function TimeboxStatus({ start, minutes, now }: { start: number | null; minutes: number; now: number }) {
  const left = timeLeft(start, minutes, now);
  const over = left === "Time's up";
  return (
    <span className="flex items-center gap-2.5">
      <span className={labelClass}>Timebox</span>
      <span className={cx("font-mono text-[12px]", over ? "text-warn" : "text-fg")}>{left}</span>
      <span className="w-24">
        <TimeBar fraction={timeboxElapsed(start, minutes, now)} over={over} />
      </span>
      <span className="text-faint">of {formatDuration(minutes)}</span>
    </span>
  );
}
