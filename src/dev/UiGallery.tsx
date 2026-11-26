import { useState, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { Button, Chip, Dialog, EmptyState, Field, Input, Kbd, labelClass, Panel, Select, Textarea } from "../ui";
import "./UiGallery.scss";

/** Dev-only (`/__ui`): every Ink component, plus the mockup-A host screen rebuilt from them. */
export default function UiGallery() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("exam-sim");

  return (
    <div data-testid="ui-gallery" className="ui-gallery">
      <h1 className="ui-gallery__title">Ink components</h1>
      <p className="ui-gallery__lede">Debug builds only. Compare with direction A in visual-directions.html (docs/specs/foundation.md §8 links it).</p>

      <div className="ui-gallery__grid">
        <Section title="Button">
          <div className="ui-gallery__run">
            <Button variant="primary">Create engagement</Button>
            <Button>Cancel</Button>
            <Button variant="danger">Delete</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </div>
          <div className="ui-gallery__run ui-gallery__run--next">
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
          <div className="ui-gallery__run">
            <Chip>Linux</Chip>
            <Chip variant="accent">user · srv11</Chip>
            <Chip>Privesc</Chip>
            <Chip>1 open thread</Chip>
            <Chip mono>10.10.0.0/24</Chip>
          </div>
        </Section>

        <Section title="Field · Input · Select">
          <div className="ui-gallery__stack">
            <Field label="Name" hint="Shown on the dashboard.">
              <Input placeholder="Mock exam" />
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
          <div className="ui-gallery__stack">
            <Field label="Output">
              <Textarea mono defaultValue={"find / -perm -4000 2>/dev/null\n/usr/bin/backupd"} />
            </Field>
            <span className={labelClass}>A section label</span>
            <p className="ui-gallery__keys">
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
              <Input autoFocus placeholder="Mock exam" />
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

      <h2 className={cx(labelClass, "ui-gallery__mockup-label")}>Mockup A, rebuilt from tokens</h2>
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
  const hosts = ["DC01", "MS01", "srv11", "srv12", "srv13"];
  const sec = (label: string, on: boolean) => (
    <div
      key={label}
      className={cx("mockup__nav-item", on && "mockup__nav-item--on")}
    >
      {label}
    </div>
  );
  return (
    <div className="mockup">
      <div className="mockup__side">
        {side.map((s) => sec(s, s === "Board"))}
        <div className={cx(labelClass, "mockup__hosts-label")}>Hosts</div>
        {hosts.map((h) => sec(h, h === "srv11"))}
      </div>
      <div className="mockup__main">
        <div className="mockup__header">
          <span className="mockup__name">srv11</span>
          <span className="mockup__ip">10.10.61.143</span>
          <Chip>Linux</Chip>
          <Chip variant="accent">user · srv11</Chip>
          <Chip>Privesc</Chip>
          <Chip>1 open thread</Chip>
        </div>
        <div className="mockup__panes">
          <Panel title="Services">
            {[
              ["22", "OpenSSH 8.2p1"],
              ["80", "Apache 2.4.41 · Pico"],
              ["3003", "CouchDB 3.1.1 ✓"],
              ["5432", "PostgreSQL 12"],
            ].map(([p, s]) => (
              <div key={p} className="mockup__service">
                <span>{p}</span>
                <span className={p === "3003" ? "mockup__accent" : undefined}>{s}</span>
              </div>
            ))}
          </Panel>
          <Panel>
            <div className="mockup__tabs">
              <span className="mockup__tab mockup__tab--on">Log</span>
              <span className="mockup__tab">Checklist</span>
              <span className="mockup__tab">Credentials</span>
              <span className="mockup__tab">Findings</span>
            </div>
            {[
              ["21:42", "Talk to 3003 directly", "nc -nv 10.10.61.143 3003", "The service answers without auth."],
              ["22:31", "SUID binaries", "find / -perm -4000 2>/dev/null", "backupd looks non-standard — investigate."],
            ].map(([t, title, cmd, obs]) => (
              <div key={t} className="mockup__entry">
                <span className="mockup__time">{t}</span>
                <div>
                  {title}
                  <div className="mockup__cmd">{cmd}</div>
                  <div className="mockup__obs">{obs}</div>
                </div>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}
