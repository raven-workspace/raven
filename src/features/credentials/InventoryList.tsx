import { useEffect, useRef, type KeyboardEvent } from "react";
import { credName, identifyHash, isMachineAccount, isOwnerless, overallState, usernameLabel, type OverallState } from "../../engines/credentials";
import type { AccessGrant, CredAttempt, Credential, Username } from "../../types/credentials";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import { Chip, labelClass } from "../../ui";
import { cx } from "../../lib/cx";
import { revealRow } from "../../lib/revealRow";
import { ScrollArea } from "../../ui/shadcn/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "../../ui/shadcn/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/shadcn/table";
import { UsernamesList } from "./UsernamesList";
import { useInventoryKind, type InventoryKind } from "./useCredentialSelection";
import { hostLabel } from "../../lib/hostName";
import "./InventoryList.scss";

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
 * The tracks for each shape are in InventoryList.scss.
 */

/** ArrowUp/Down move focus between rows of the whole list; they never select. */
function moveRowFocus(e: KeyboardEvent<HTMLElement>, root: HTMLElement | null) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const rows = [...(root?.querySelectorAll<HTMLElement>("tr[data-cred-row]") ?? [])];
  const next = rows[rows.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1)];
  e.preventDefault();
  next?.focus();
}

function Group({ label, creds, crack, typed, ...ctx }: {
  label: string;
  creds: Credential[];
  /** Hashes: a hash-type column and crack status. */
  crack?: boolean;
  /** A mixed group: a Type column. */
  typed?: boolean;
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
    <section aria-label={label} className="inventory-list__group">
      <h3 className={labelClass}>{label} <span className="inventory-list__count">{creds.length}</span></h3>
      <Table className={cx("inventory-list__table", crack ? "inventory-list__table--crack" : typed && "inventory-list__table--typed")}>
        <TableHeader className="inventory-list__rows">
          <TableRow className="inventory-list__row">
            <TableHead scope="col">Credential</TableHead>
            {crack && <TableHead scope="col">Hash type</TableHead>}
            {typed && <TableHead scope="col">Type</TableHead>}
            <TableHead scope="col" className="inventory-list__scope">Scope</TableHead>
            <TableHead scope="col" className="inventory-list__source">Source</TableHead>
            <TableHead scope="col">State</TableHead>
            {crack && <TableHead scope="col">Crack status</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody className="inventory-list__rows">
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
                className="inventory-list__row inventory-list__item"
                onClick={() => ctx.onSelect(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    ctx.onSelect(c.id);
                  } else moveRowFocus(e, ctx.root.current);
                }}
              >
                <TableCell className="inventory-list__cell">
                  {isOwnerless(c) ? (
                    <span className="inventory-list__ownerless">
                      <Chip>owner unknown</Chip>
                      <span className="inventory-list__matched">
                        {matched.length > 0 ? `matched: ${matched.map((x) => usernameLabel(x)).join(", ")}` : "no user matched yet"}
                      </span>
                    </span>
                  ) : (
                    <span className="inventory-list__name" title={name}>{name}</span>
                  )}
                </TableCell>
                {crack && <TableCell className="inventory-list__value">{c.hashType ?? identifyHash(c.secret, "windows")[0]?.name ?? "unknown"}</TableCell>}
                {typed && <TableCell className="inventory-list__value">{c.type}</TableCell>}
                <TableCell className="inventory-list__scope inventory-list__cell inventory-list__value">
                  <span className="inventory-list__scope-value">{c.scope}</span>
                  {scopeHost && <span className="inventory-list__scope-host" title={scopeHost}>{scopeHost}</span>}
                </TableCell>
                <TableCell className="inventory-list__source inventory-list__cell inventory-list__value">
                  {c.source ? <span className="inventory-list__source-text" title={c.source}>{c.source}</span> : <span className="inventory-list__unknown">unknown</span>}
                </TableCell>
                <TableCell><StateChip state={overallState(c, ctx.hosts, ctx.servicesByHost, ctx.attempts)} /></TableCell>
                {crack && <TableCell><Chip variant={c.crackStatus === "uncrackable" ? "warn" : "default"}>{c.crackStatus ?? "uncracked"}</Chip></TableCell>}
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
  // The selected row stays in view inside the list's own scroller (never the page).
  useEffect(() => {
    const row = root.current?.querySelector("tr[aria-selected='true']");
    const viewport = root.current?.closest<HTMLElement>("[data-slot=scroll-area-viewport]");
    if (selectedId && row && viewport) revealRow(viewport, row);
  }, [selectedId]);
  const people = creds.filter((c) => !isMachineAccount(c));
  const ctx = { all, hosts, servicesByHost, attempts, selectedId, onSelect, root };
  const groups: { kind: InventoryKind; label: string; creds: Credential[]; crack?: boolean; typed?: boolean }[] = [
    { kind: "passwords", label: "Passwords", creds: people.filter((c) => c.type === "password") },
    { kind: "hashes", label: "Hashes", crack: true, creds: people.filter((c) => c.type === "hash") },
    { kind: "tickets", label: "Tickets, keys and tokens", typed: true, creds: people.filter((c) => c.type !== "password" && c.type !== "hash") },
    { kind: "machines", label: "Machine accounts", creds: creds.filter(isMachineAccount) },
  ];
  const present: { kind: InventoryKind; label: string; count: number }[] = [
    ...groups.filter((g) => g.creds.length > 0).map((g) => ({ kind: g.kind, label: g.label, count: g.creds.length })),
    ...(usernames.length > 0 ? [{ kind: "usernames" as const, label: "Usernames", count: usernames.length }] : []),
  ];
  const [requested, setKind] = useInventoryKind();
  // A stale or empty kind (nothing of that kind left) is All.
  const kind = present.some((k) => k.kind === requested) ? requested : "all";
  const show = (k: InventoryKind) => kind === "all" || kind === k;
  return (
    <div className="inventory-list">
      <div className="inventory-list__filter">
        <ToggleGroup type="single" aria-label="Show kind" value={kind} onValueChange={(v) => v && setKind(v as InventoryKind | "all")} className="inventory-list__kinds">
          <ToggleGroupItem value="all" className="inventory-list__kind">All</ToggleGroupItem>
          {present.map((k) => (
            <ToggleGroupItem key={k.kind} value={k.kind} className="inventory-list__kind">
              {k.label}
              <span className="inventory-list__kind-count">{k.count}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <ScrollArea className="inventory-list__scroll">
        <div ref={root} className="inventory-list__groups">
          {groups.filter((g) => show(g.kind)).map(({ kind: k, ...g }) => <Group key={k} {...g} {...ctx} />)}
          {show("usernames") && <UsernamesList eid={eid} usernames={usernames} grants={grants} hosts={hosts} />}
        </div>
      </ScrollArea>
    </div>
  );
}
