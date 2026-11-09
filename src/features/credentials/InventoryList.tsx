import { useRef, type KeyboardEvent } from "react";
import { credName, isMachineAccount, isOwnerless, overallState, usernameLabel, type OverallState } from "../../engines/credentials";
import type { AccessGrant, CredAttempt, Credential, Username } from "../../types/credentials";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import { Chip, labelClass } from "../../ui";
import { ScrollArea } from "../../ui/shadcn/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/shadcn/table";
import { hostLabel } from "./AccessGrants";
import { UsernamesList } from "./UsernamesList";

const STATE_LABEL: Record<OverallState, string> = {
  admin: "admin",
  valid: "valid",
  untested: "untested",
  dead: "dead",
  "not-sprayable": "not sprayable",
};

/** Accent only for access that works; warn for dead. */
export function StateChip({ state }: { state: OverallState }) {
  const variant = state === "admin" || state === "valid" ? "accent" : state === "dead" ? "warn" : "default";
  return <Chip variant={variant}>{STATE_LABEL[state]}</Chip>;
}

/*
 * Column policy (DESIGN.md Tables and lists): credential, type, scope, source, state, and for hashes crack status.
 * The pane decides, not the window: under 900px of pane Source drops, under 700px Scope too. Rows are subgrids.
 * Hidden columns are display:none, so each template lists exactly the visible tracks.
 */
const TABLE = "grid gap-x-3";
const TRACKS =
  "grid-cols-[minmax(20ch,3fr)_max-content_max-content] " +
  "@[700px]:grid-cols-[minmax(20ch,3fr)_max-content_max-content_max-content] " +
  "@[900px]:grid-cols-[minmax(20ch,3fr)_max-content_max-content_minmax(10ch,2fr)_max-content]";
const TRACKS_CRACK =
  "grid-cols-[minmax(20ch,3fr)_max-content_max-content_max-content] " +
  "@[700px]:grid-cols-[minmax(20ch,3fr)_max-content_max-content_max-content_max-content] " +
  "@[900px]:grid-cols-[minmax(20ch,3fr)_max-content_max-content_minmax(10ch,2fr)_max-content_max-content]";
const ROW = "col-span-full grid grid-cols-subgrid items-start";
const SHOW_SCOPE = "hidden @[700px]:block";
const SHOW_SOURCE = "hidden @[900px]:block";
const BAR = "shadow-[inset_2px_0_0_var(--accent)]";

/** ArrowUp/Down move focus between rows of the whole list; they never select. */
function moveRowFocus(e: KeyboardEvent<HTMLElement>, root: HTMLElement | null) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const rows = [...(root?.querySelectorAll<HTMLElement>("tr[data-cred-row]") ?? [])];
  const next = rows[rows.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1)];
  e.preventDefault();
  next?.focus();
}

function Group({ label, creds, crack, ...ctx }: {
  label: string;
  creds: Credential[];
  crack?: boolean;
  all: Credential[];
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  attempts: CredAttempt[];
  selectedId?: string;
  onSelect: (id: string) => void;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  if (creds.length === 0) return null;
  const hostName = (hid: string | null) => (hid ? hostLabel(ctx.hosts.find((h) => h.id === hid)) : "");
  return (
    <section aria-label={label} className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <h3 className={`m-0 ${labelClass}`}>{label} <span className="tabular-nums">{creds.length}</span></h3>
      <Table className={`${TABLE} ${crack ? TRACKS_CRACK : TRACKS}`}>
        <TableHeader className="contents">
          <TableRow className={ROW}>
            <TableHead scope="col">Credential</TableHead>
            <TableHead scope="col">Type</TableHead>
            <TableHead scope="col" className={SHOW_SCOPE}>Scope</TableHead>
            <TableHead scope="col" className={SHOW_SOURCE}>Source</TableHead>
            <TableHead scope="col">State</TableHead>
            {crack && <TableHead scope="col">Crack status</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody className="contents">
          {creds.map((c) => {
            const selected = c.id === ctx.selectedId;
            const name = credName(c);
            const matched = isOwnerless(c) ? ctx.all.filter((x) => x.fromSecretId === c.id) : [];
            const scopeHost = c.scope === "local" ? hostName(c.localHostId) : "";
            return (
              <TableRow
                key={c.id}
                data-cred-row
                tabIndex={0}
                aria-selected={selected}
                data-state={selected ? "selected" : undefined}
                className={`${ROW} cursor-pointer`}
                onClick={() => ctx.onSelect(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    ctx.onSelect(c.id);
                  } else moveRowFocus(e, ctx.root.current);
                }}
              >
                <TableCell className={`min-w-0 ${selected ? BAR : ""}`}>
                  {isOwnerless(c) ? (
                    <span className="grid justify-items-start gap-1">
                      <Chip>owner unknown</Chip>
                      <span className="text-meta text-muted">
                        {matched.length > 0 ? `matched: ${matched.map((x) => usernameLabel(x)).join(", ")}` : "no user matched yet"}
                      </span>
                    </span>
                  ) : (
                    <span className="block truncate font-mono text-code text-fg" title={name}>{name}</span>
                  )}
                </TableCell>
                <TableCell className="text-fg-2">{c.type}</TableCell>
                <TableCell className={`${SHOW_SCOPE} min-w-0 text-fg-2`}>
                  <span className="whitespace-nowrap">{c.scope}</span>
                  {scopeHost && <span className="block max-w-[24ch] truncate text-meta text-muted" title={scopeHost}>{scopeHost}</span>}
                </TableCell>
                <TableCell className={`min-w-0 ${SHOW_SOURCE} text-fg-2`}>
                  {c.source && <span className="block truncate" title={c.source}>{c.source}</span>}
                </TableCell>
                <TableCell><StateChip state={overallState(c, ctx.hosts, ctx.servicesByHost, ctx.attempts)} /></TableCell>
                {crack && <TableCell>{c.crackStatus && <Chip variant={c.crackStatus === "cracked" ? "accent" : "default"}>{c.crackStatus}</Chip>}</TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

/** Everything we hold, grouped by kind. `creds` is the folded, shown list; `all` is the raw list for matched users. */
export function InventoryList({ eid, creds, all, hosts, servicesByHost, attempts, usernames, grants, selectedId, onSelect }: {
  eid: string;
  creds: Credential[];
  all: Credential[];
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  attempts: CredAttempt[];
  usernames: Username[];
  grants: AccessGrant[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const people = creds.filter((c) => !isMachineAccount(c));
  const ctx = { all, hosts, servicesByHost, attempts, selectedId, onSelect, root };
  return (
    <ScrollArea className="h-full min-h-0 [&_[data-slot=scroll-area-viewport]>div]:block!">
      <div ref={root} className="@container grid grid-cols-[minmax(0,1fr)] gap-6">
        <Group label="Passwords" creds={people.filter((c) => c.type === "password")} {...ctx} />
        <Group label="Hashes" crack creds={people.filter((c) => c.type === "hash")} {...ctx} />
        <Group label="Tickets, keys and tokens" creds={people.filter((c) => c.type !== "password" && c.type !== "hash")} {...ctx} />
        <Group label="Machine accounts" creds={creds.filter(isMachineAccount)} {...ctx} />
        <UsernamesList eid={eid} usernames={usernames} grants={grants} hosts={hosts} />
      </div>
    </ScrollArea>
  );
}
