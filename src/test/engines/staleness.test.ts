import { describe, expect, it } from "vitest";
import { ENTITY_TABLES, staleAfter, type Change, type Entity } from "../../engines/staleness";

const stale = (entity: Entity, change: Change) => [...staleAfter({ entity, change })].sort();
const ALL = (Object.keys(ENTITY_TABLES) as Entity[]).sort();

describe("staleness map", () => {
  it("a write leaves at least its own entity stale", () => {
    for (const entity of ALL) {
      for (const change of ["created", "updated", "deleted"] as const) expect(stale(entity, change)).toContain(entity);
    }
  });

  it("a plain update touches nothing else", () => {
    expect(stale("finding", "updated")).toEqual(["finding"]);
    expect(stale("tunnel", "updated")).toEqual(["tunnel"]);
    expect(stale("cleanupItem", "updated")).toEqual(["cleanupItem"]);
  });

  it("host deleted: everything on it cascades, everything linked to it loses the link", () => {
    expect(stale("host", "deleted")).toEqual(
      [
        "host",
        // Cascaded with it.
        "service", "note", "ruledOut", "tunnel", "hop", "interfaceDismissal", "accessGrant", "credAttempt",
        "triedPair", "hostIdentity", "vector", "payloadBuild",
        // Its checklist rows, cleared by the store by hand.
        "checklistItem",
        // Lose their link to it: entries and findings (link rows), credentials, usernames, attempts, cleanup, and the
        // engagement's Metasploit lock.
        "logEntry", "finding", "credential", "username", "failedAttempt", "cleanupItem", "engagement",
      ].sort(),
    );
  });

  it("engagement deleted: everything it holds goes", () => {
    expect(stale("engagement", "deleted")).toEqual(ALL);
  });

  it("log entry deleted: its extraction and attachments go, findings lose the step, the rest lose the link", () => {
    expect(stale("logEntry", "deleted")).toEqual(
      [
        "logEntry", "extraction", "attachment", "finding",
        "service", "hop", "accessGrant", "credAttempt", "triedPair", "failedAttempt", "cleanupItem", "hostIdentity",
        // The entry's checklist follow-up: ticks, board columns, the Metasploit lock.
        "checklistItem", "host", "engagement",
      ].sort(),
    );
  });

  it("log entry updated: the entry and its checklist follow-up", () => {
    expect(stale("logEntry", "updated")).toEqual(["checklistItem", "engagement", "host", "logEntry"]);
  });

  it("log entry created by hand (a screenshot): the entry and the engagement's latest activity", () => {
    expect(stale("logEntry", "created")).toEqual(["engagement", "logEntry"]);
  });

  it("entry saved through capture: what it files, its extraction and the follow-up", () => {
    expect(stale("logEntry", "saved")).toEqual(
      [
        "logEntry", "extraction", "host", "service", "hostIdentity", "vector", "ruledOut", "credential", "username",
        "credAttempt", "triedPair", "checklistItem", "engagement",
      ].sort(),
    );
  });

  it("extraction undone: what the save filed goes, with every cascade of a deleted host and credential", () => {
    const s = stale("extraction", "undone");
    for (const e of ["extraction", "host", "service", "credential", "username", "credAttempt", "triedPair", "hostIdentity", "vector", "checklistItem", "logEntry"] as const) {
      expect(s).toContain(e);
    }
    // The gaps the old hand list left: a filed host's undo takes its findings link, attempts, grants and cleanup.
    for (const e of ["finding", "failedAttempt", "accessGrant", "cleanupItem"] as const) expect(s).toContain(e);
  });

  it("credential writes refresh tried pairs (a stored credential's tried pairs are promoted away)", () => {
    expect(stale("credential", "created")).toEqual(["credential", "triedPair"]);
    expect(stale("credential", "updated")).toEqual(["credential", "triedPair"]);
    expect(stale("credential", "cracked")).toEqual(["credential", "triedPair"]);
  });

  it("credential deleted: its attempts cascade, credentials cracked from it lose the link", () => {
    expect(stale("credential", "deleted")).toEqual(["credAttempt", "credential"]);
  });

  it("credential converted: a username with a grant, and the credential goes", () => {
    expect(stale("credential", "converted")).toEqual(["accessGrant", "credAttempt", "credential", "username"]);
  });

  it("username deleted: its grants and attempts cascade", () => {
    expect(stale("username", "deleted")).toEqual(["accessGrant", "credAttempt", "username"]);
  });

  it("service: a verdict writes or removes its ruled-out item; a delete takes it and the finding link", () => {
    expect(stale("service", "updated")).toEqual(["ruledOut", "service"]);
    expect(stale("service", "deleted")).toEqual(["finding", "ruledOut", "service"]);
  });

  it("vector writes touch its ruled-out item", () => {
    expect(stale("vector", "updated")).toEqual(["ruledOut", "vector"]);
    expect(stale("vector", "deleted")).toEqual(["ruledOut", "vector"]);
  });

  it("finding deleted: its files go, attempts that named it lose the link", () => {
    expect(stale("finding", "deleted")).toEqual(["failedAttempt", "finding", "findingFile"]);
  });

  it("engagement created or its form saved: the scope may add hosts; a lock, status or timebox write does not", () => {
    expect(stale("engagement", "created")).toEqual(["engagement", "host"]);
    expect(stale("engagement", "saved")).toEqual(["engagement", "host"]);
    expect(stale("engagement", "updated")).toEqual(["engagement"]);
  });
});
