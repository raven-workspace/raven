import { useState, type ReactNode } from "react";
import { Button, Chip, Dialog, EmptyState, Field, Input, Kbd, Label, labelClass, Panel, Select, Textarea } from "../ui";

/** Dev-only (`/__ui`): every Ink component, plus the mockup-A host screen rebuilt from them. */
export default function UiGallery() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("exam-sim");

  return (
    <div data-testid="ui-gallery" className="h-full overflow-auto px-6 py-5">
      <h1 className="m-0 mb-1 text-xl font-semibold tracking-[-0.01em] text-fg">Ink components</h1>
      <p className="m-0 mb-6 text-muted">Debug builds only. Compare with direction A in docs/design/visual-directions.html.</p>

      <div className="grid max-w-[980px] grid-cols-2 gap-3">
        <Section title="Button">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Create engagement</Button>
            <Button>Cancel</Button>
            <Button variant="danger">Delete</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm">
              Save
            </Button>
            <Button size="sm">Archive</Button>
            <Button variant="danger" size="sm">
              Remove
            </Button>
          </div>
        </Section>

        <Section title="Chip">
          <div className="flex flex-wrap items-center gap-2">
            <Chip>Linux</Chip>
            <Chip variant="accent">user · vega</Chip>
            <Chip>Privesc</Chip>
            <Chip>1 open thread</Chip>
            <Chip mono>10.10.0.0/24</Chip>
          </div>
        </Section>

        <Section title="Field · Input · Select">
          <div className="flex flex-col gap-3">
            <Field label="Name" hint="Shown on the dashboard.">
              <Input placeholder="Mock exam A" />
            </Field>
            <Field label="Scope" error="10.10.0.300/24 is not a valid CIDR.">
              <Input mono defaultValue="10.10.0.300/24" />
            </Field>
            <Field label="Kind">
              <Select
                value={kind}
                onValueChange={setKind}
                options={[
                  { value: "exam-sim", label: "Exam sim" },
                  { value: "lab", label: "Lab" },
                  { value: "client", label: "Client" },
                ]}
              />
            </Field>
            <Field label="Disabled">
              <Input disabled value="read only" />
            </Field>
          </div>
        </Section>

        <Section title="Textarea · Label · Kbd">
          <div className="flex flex-col gap-3">
            <Field label="Output">
              <Textarea mono defaultValue={"find / -perm -4000 2>/dev/null\n/usr/bin/backupd"} />
            </Field>
            <Label>A standalone label</Label>
            <p className="m-0 text-[13px] text-muted-2">
              Quick capture <Kbd>⌘</Kbd> <Kbd>K</Kbd> · close <Kbd>esc</Kbd>
            </p>
          </div>
        </Section>

        <Section title="Dialog">
          <Button variant="primary" onClick={() => setOpen(true)}>
            Open dialog
          </Button>
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title="New engagement"
            description="Exam sims start a 23h45m timebox."
            footer={
              <>
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setOpen(false)}>
                  Create
                </Button>
              </>
            }
          >
            <Field label="Name">
              <Input autoFocus placeholder="Mock exam A" />
            </Field>
          </Dialog>
        </Section>

        <Section title="EmptyState">
          <EmptyState
            title="No engagements yet"
            body="Create one for an exam sim, a lab or a client job."
            action={<Button variant="primary">Create engagement</Button>}
          />
        </Section>
      </div>

      <h2 className={`${labelClass} mt-8 mb-2`}>Mockup A, rebuilt from tokens</h2>
      <MockupA />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <Panel title={title}>{children}</Panel>;
}

/** The host screen from visual-directions.html direction A, using only Ink tokens and components. */
function MockupA() {
  const side = ["Board", "Log", "Credentials", "Findings", "Engagement checklist", "Report"];
  const hosts = ["DC01", "MS01", "Vega", "Quartz", "Onyx"];
  const sec = (label: string, on: boolean) => (
    <div
      key={label}
      className={
        on
          ? "mb-px rounded-sm bg-surface-hi px-2 py-[5px] text-fg shadow-[inset_2px_0_0_var(--accent)]"
          : "mb-px rounded-sm px-2 py-[5px] text-muted-2"
      }
    >
      {label}
    </div>
  );
  return (
    <div className="grid h-[430px] max-w-[980px] grid-cols-[190px_1fr] overflow-hidden rounded border border-line-2 text-[13px]">
      <div className="border-r border-line px-3 py-3.5">
        {side.map((s) => sec(s, s === "Board"))}
        <div className={`${labelClass} mx-2 mt-4 mb-1.5 text-faint`}>Hosts</div>
        {hosts.map((h) => sec(h, h === "Vega"))}
      </div>
      <div className="grid min-h-0 grid-rows-[auto_1fr] gap-3 px-[18px] py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xl font-semibold tracking-[-0.01em] text-fg">Vega</span>
          <span className="font-mono text-xs text-muted">172.31.166.143</span>
          <Chip>Linux</Chip>
          <Chip variant="accent">user · vega</Chip>
          <Chip>Privesc</Chip>
          <Chip>1 open thread</Chip>
        </div>
        <div className="grid min-h-0 grid-cols-[240px_1fr] gap-3">
          <Panel title="Services">
            {[
              ["22", "OpenSSH 8.2p1"],
              ["80", "Apache 2.4.41 · Pico"],
              ["3003", "CouchDB 3.1.1 ✓"],
              ["5432", "PostgreSQL 12"],
            ].map(([p, s]) => (
              <div key={p} className="grid grid-cols-[42px_1fr] gap-1.5 py-[3px] font-mono text-[12.5px]">
                <span>{p}</span>
                <span className={p === "3003" ? "text-accent" : undefined}>{s}</span>
              </div>
            ))}
          </Panel>
          <Panel>
            <div className="mb-2.5 flex gap-[18px]">
              <span className="border-b border-accent pb-1 text-fg">Log</span>
              <span className="text-muted">Checklist</span>
              <span className="text-muted">Credentials</span>
              <span className="text-muted">Findings</span>
            </div>
            {[
              ["21:42", "Talk to 3003 directly", "nc -nv 172.31.166.143 3003", "The service answers without auth."],
              ["22:31", "SUID binaries", "find / -perm -4000 2>/dev/null", "backupd looks non-standard — investigate."],
            ].map(([t, title, cmd, obs]) => (
              <div key={t} className="grid grid-cols-[58px_1fr] gap-2.5 border-b border-line py-2">
                <span className="font-mono text-[11px] text-faint">{t}</span>
                <div>
                  {title}
                  <div className="mt-[3px] font-mono text-xs text-muted-2">{cmd}</div>
                  <div className="mt-[3px] text-[12.5px] text-muted">{obs}</div>
                </div>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}
