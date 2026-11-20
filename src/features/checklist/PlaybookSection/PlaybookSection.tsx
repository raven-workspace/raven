import { useState, type ReactNode } from "react";
import { Collapse, DisclosureCaret } from "../../../ui/index";
import "./PlaybookSection.scss";

/** A collapsible group of goals with a heading and its trigger text. */
export function PlaybookSection({
  title,
  opensWhen,
  defaultOpen,
  children,
}: {
  title: string;
  opensWhen: string;
  /** Open because its trigger has fired; a hand toggle overrides it. */
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? defaultOpen;
  return (
    <section aria-label={title} className="playbook-section">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setManual(!open)}
        className="playbook-section__toggle"
      >
        <DisclosureCaret open={open} className="playbook-section__caret" />
        <span className="playbook-section__title">{title}</span>
      </button>
      <p className="playbook-section__opens">Opens when {opensWhen}</p>
      <Collapse open={open}><ul className="playbook-section__list">{children}</ul></Collapse>
    </section>
  );
}
