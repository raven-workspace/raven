# Raven

Raven is a penetration tester's work surface: one engagement from first scan to the exam report. These are the words its code, docs and issues use for the Report.

## Report

**Report target**:
One unit of the report that gets its own page: a standalone machine, or the AD set's machines together.
_Avoid_: section (a target is one kind of section), host (an AD set target holds several)

**Placement plan**:
Raven's decision, made from the logged record alone, about where each log entry of a report target would go on a freshly drafted page. It never reads the owner's edits.
_Avoid_: draft plan, evidence map

**Role**:
What a log entry is in a placement plan: for example, it leads a step, or it isn't placed. Every entry of the target has exactly one.
_Avoid_: reason (a reason is why an entry proves something, not where it goes)

**Step**:
One numbered move in a report target's story, led by a single log entry (an access, a hop, a flag or a finding step) and followed by what illustrates it.
_Avoid_: block (a block is any piece of a page), entry (a step can hold several)

**Finding section**:
The part of a phase headed by one finding ("Initial access: <title>"), holding the steps that belong to that finding.
_Avoid_: finding group

**Draft**:
The page Raven builds from a placement plan before the owner edits it.
_Avoid_: plan (the plan is the decision; the draft is the page printed from it)

**Page**:
A report target's document as the owner has edited it. Whether an entry is "on the page" is always a question about the page, never the plan.
_Avoid_: draft (once edited, it is the owner's)

**Block source**:
Where a block on a page came from: a log entry and which part of it, a finding, a machine's facts, a phase heading, or a machine's Also tested list. It stays on the block as the owner edits, so Raven can follow the block back to what it shows.
_Avoid_: origin, ref, provenance

**Kept from the report**:
A log entry that may never reach the page, the evidence column or the PDF: a private entry, or one tied to an attempt the owner marked private or kept to themselves.
_Avoid_: hidden, private (private is one way to be kept from the report)
