import { beforeEach, describe, expect, it, vi } from "vitest";
import { credKey } from "../../../engines/credentials";
import { applyInterpretation, interpretEntry, NOTHING_NEW } from "../../../features/capture/applyInterpretation";
import { saveCapture, type CaptureEdits } from "../../../features/capture/saveCapture";
import { afterEntrySaved } from "../../../features/checklist/ticks";
import { api } from "../../../lib/api";
import type { ChecklistItem } from "../../../types/checklist";
import type { CredAttempt, Credential, CredentialInput, TriedPair, Username } from "../../../types/credentials";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";
import type { HostIdentity, PrivescVector } from "../../../types/hostFacts";
import type { CommandBlock, Extraction, ExtractionRecord, ExtractionSummary, LogEntry } from "../../../types/log";
import type { Service } from "../../../types/service";
import sam from "../../fixtures/interpret/secretsdump-sam.txt?raw";
import sudoL from "../../fixtures/interpret/sudo-l.txt?raw";

vi.mock("../../../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.1.0/24"], domain: "corp.lan",
  startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active", createdAt: 1, updatedAt: 1,
  lastActivityAt: null, lastRanOn: "Kali (VM)", msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};
const host = (over: Partial<Host> & Pick<Host, "id" | "name">): Host => ({
  engagementId: "e1", ip: null, os: "linux", boardColumn: "information-gathering", boardManual: false, dualHomed: false,
  boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1, ...over,
});
const SRV12 = host({ id: "hC", name: "Srv12", ip: "10.10.1.5" });
const WEB01 = host({ id: "hW", name: "web01", ip: "10.10.1.6" });
const DC01 = host({ id: "hD", name: "DC01", ip: "10.10.1.10", os: "windows" });
const service = (id: string, hostId: string, port: number): Service => ({
  id, hostId, port, protocol: "tcp", state: "open", nmapService: null, nmapVersion: null, confirmedProduct: null,
  confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1,
});

/** A stateful backend with the Rust rules the save path relies on (dedupe on create, no-downgrade upserts). */
interface Db {
  hosts: Host[];
  services: Service[];
  credentials: Credential[];
  usernames: Username[];
  attempts: CredAttempt[];
  tried: TriedPair[];
  vectors: PrivescVector[];
  checklist: ChecklistItem[];
  identity: HostIdentity | null;
  extractions: Extraction[];
}
let db: Db;
let seq = 0;
let clock = 1000;
const nextId = (p: string) => `${p}${++seq}`;
const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
/**
 * The store's answer for E1 (domain corp.lan): equal spellings, and CORP with corp.lan. A stub of what the store
 * says, not the rule: that is tested in Rust (credentials.rs `same_domain`).
 */
const STORE_SAME = new Set(["corp|corp.lan", "corp.lan|corp"]);
const sameIn = (a: string | null | undefined, b: string | null | undefined) => lc(a) === lc(b) || STORE_SAME.has(`${lc(a)}|${lc(b)}`);
const RANK: Record<string, number> = { admin: 3, valid: 2, failed: 1, errored: 0 };
const cred = (o: Partial<Credential> & { id: string }): Credential => ({
  engagementId: "e1", type: "password", username: "", domain: null, secret: "", hashType: null, scope: "domain",
  localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1, ...o,
});

function upsertAttempt(a: CredAttempt): CredAttempt {
  const i = db.attempts.findIndex(
    (o) => o.credId === a.credId && (o.usernameId ?? "") === (a.usernameId ?? "") && o.hostId === a.hostId && o.service === a.service && o.authMode === a.authMode,
  );
  if (i < 0) {
    db.attempts.push(a);
    return a;
  }
  const old = db.attempts[i]!;
  if (a.at < old.at || (a.at === old.at && RANK[a.result]! < RANK[old.result]!)) return old;
  db.attempts[i] = { ...old, result: a.result, at: a.at, logEntryId: a.logEntryId, port: a.port ?? old.port };
  return db.attempts[i]!;
}

function setupBackend(seed: Partial<Db> = {}) {
  seq = 0;
  db = {
    hosts: [SRV12, WEB01], services: [service("s22", "hC", 22), service("s445", "hC", 445)], credentials: [], usernames: [], attempts: [], tried: [], vectors: [],
    checklist: [], identity: null, extractions: [], ...structuredClone(seed),
  };
  const copy = <T>(x: T) => async () => structuredClone(x);
  m.engagementGet.mockImplementation(async () => E1);
  m.hostsList.mockImplementation(async () => structuredClone(db.hosts));
  m.hostCreate.mockImplementation(async (eid, input) => {
    const h = host({ id: nextId("h"), name: input.name, ip: input.ip ?? null, os: null, engagementId: eid });
    db.hosts.push(h);
    return h;
  });
  m.hostUpdate.mockImplementation(async (id, input) => {
    const i = db.hosts.findIndex((h) => h.id === id);
    db.hosts[i] = { ...db.hosts[i]!, os: input.os ?? null };
    return db.hosts[i]!;
  });
  m.hostSyncBoard.mockImplementation(async (id) => db.hosts.find((h) => h.id === id)!);
  m.servicesListEngagement.mockImplementation(async () => structuredClone(db.services));
  m.servicesList.mockImplementation(async (hostId) => structuredClone(db.services.filter((s) => s.hostId === hostId)));
  m.servicesUpsertScan.mockImplementation(async (hostId, ports) =>
    ports.map((p) => {
      const old = db.services.find((s) => s.hostId === hostId && s.port === p.port);
      if (old) return old;
      const s = { ...service(nextId("s"), hostId, p.port), nmapService: p.service };
      db.services.push(s);
      return s;
    }),
  );
  m.credentialsList.mockImplementation(async () => structuredClone(db.credentials));
  m.credentialCreate.mockImplementation(async (eid, input: CredentialInput) => {
    const c = cred({
      id: nextId("c"), engagementId: eid, type: input.type, username: input.username ?? "", domain: input.domain ?? null,
      secret: input.secret ?? "", hashType: input.hashType ?? null, scope: input.scope ?? "domain",
      localHostId: input.localHostId ?? null, sourceHostId: input.sourceHostId ?? null, source: input.source ?? null,
      crackStatus: input.type === "hash" ? "uncracked" : null, fromSecretId: input.fromSecretId ?? null, createdAt: clock, updatedAt: clock,
    });
    const found = db.credentials.find(
      (x) => credKey({ ...x, domain: null }) === credKey({ ...c, domain: null }) && x.localHostId === c.localHostId && sameIn(x.domain, c.domain),
    );
    if (found) return { credential: found, existed: true };
    db.credentials.push(c);
    return { credential: c, existed: false };
  });
  m.sameDomains.mockImplementation(async (_eid, pairs) => pairs.map(([a, b]) => sameIn(a, b)));
  m.credentialUpdate.mockImplementation(async (id, input) => {
    const i = db.credentials.findIndex((c) => c.id === id);
    db.credentials[i] = { ...db.credentials[i]!, fromSecretId: input.fromSecretId ?? db.credentials[i]!.fromSecretId, updatedAt: clock };
    return db.credentials[i]!;
  });
  m.credentialCrack.mockImplementation(async (hashId, plaintext) => {
    const i = db.credentials.findIndex((c) => c.id === hashId);
    const hash = db.credentials[i]!;
    db.credentials[i] = { ...hash, crackStatus: "cracked", updatedAt: clock };
    const pw = cred({ ...hash, id: nextId("c"), type: "password", secret: plaintext, hashType: null, crackStatus: null, crackedFrom: hashId, createdAt: clock, updatedAt: clock });
    db.credentials.push(pw);
    return pw;
  });
  m.usernamesList.mockImplementation(async () => structuredClone(db.usernames));
  m.usernameCreate.mockImplementation(async (eid, input) => {
    const found = db.usernames.find((u) => lc(u.username) === lc(input.username) && sameIn(u.domain, input.domain));
    if (found) return found;
    const u: Username = { id: nextId("u"), engagementId: eid, username: input.username, domain: input.domain ?? null, sourceHostId: input.sourceHostId ?? null, source: input.source ?? null, createdAt: clock };
    db.usernames.push(u);
    return u;
  });
  m.credAttemptsList.mockImplementation(async () => structuredClone(db.attempts));
  m.credAttemptsUpsert.mockImplementation(async (eid, inputs) =>
    inputs.map((i) =>
      upsertAttempt({
        id: nextId("a"), engagementId: eid, credId: i.credId, usernameId: i.usernameId ?? null, hostId: i.hostId, service: i.service,
        port: i.port ?? null, result: i.result, authMode: i.authMode ?? "domain", detail: i.detail ?? null, logEntryId: i.logEntryId ?? null, at: i.at ?? clock,
      }),
    ),
  );
  m.credAttemptsRekey.mockImplementation(async () => []);
  m.triedPairsList.mockImplementation(async () => structuredClone(db.tried));
  m.triedPairsUpsert.mockImplementation(async (eid, inputs) =>
    inputs.map((i) => {
      const found = db.tried.find(
        (t) => lc(t.username) === lc(i.username) && sameIn(t.domain, i.domain) && t.secret === i.secret && t.hostId === i.hostId && t.service === i.service && t.authMode === (i.authMode ?? "domain"),
      );
      if (found) return found;
      const t: TriedPair = {
        id: nextId("t"), engagementId: eid, username: i.username, domain: i.domain ?? null, secret: i.secret, secretKind: i.secretKind,
        hostId: i.hostId, service: i.service, authMode: i.authMode ?? "domain", logEntryId: i.logEntryId ?? null, at: i.at ?? clock,
      };
      db.tried.push(t);
      return t;
    }),
  );
  m.triedPairPromote.mockImplementation(async (_eid, username, domain, secret) => {
    const n = db.tried.length;
    db.tried = db.tried.filter((t) => !(lc(t.username) === lc(username) && sameIn(t.domain, domain) && t.secret === secret));
    return n - db.tried.length;
  });
  m.vectorsList.mockImplementation(async (hostId) => structuredClone(db.vectors.filter((v) => v.hostId === hostId)));
  m.vectorUpsert.mockImplementation(async (hostId, input) => {
    const found = db.vectors.find((v) => v.hostId === hostId && v.title === input.title);
    if (found) return found;
    const v: PrivescVector = { id: nextId("v"), hostId, title: input.title, status: input.status, source: input.source, createdAt: clock, updatedAt: clock };
    db.vectors.push(v);
    return v;
  });
  m.hostIdentityGet.mockImplementation(async () => structuredClone(db.identity));
  m.hostIdentitySet.mockImplementation(async (input) => (db.identity = { ...input, updatedAt: clock }));
  m.checklistList.mockImplementation(copy(db.checklist));
  m.checklistList.mockImplementation(async () => structuredClone(db.checklist));
  m.checklistPut.mockImplementation(async (eid, items) => {
    for (const it of items) {
      db.checklist = db.checklist.filter((c) => !(c.ownerId === it.ownerId && c.goalId === it.goalId));
      db.checklist.push({ ...it, engagementId: eid, updatedAt: clock } as ChecklistItem);
    }
    return structuredClone(db.checklist);
  });
  m.checklistApplyFacts.mockImplementation(async () => structuredClone(db.checklist));
  m.checklistApplyCover.mockImplementation(async () => structuredClone(db.checklist));
  m.extractionGet.mockImplementation(async (id) => structuredClone(db.extractions.find((x) => x.logEntryId === id) ?? null));
  m.extractionSave.mockImplementation(async (logEntryId, engagementId, summary, record) => {
    const x: Extraction = { logEntryId, engagementId, summary, record, createdAt: clock, undoneAt: null };
    db.extractions.push(x);
    return x;
  });
  m.logCreate.mockImplementation(async (eid, input) => ({
    id: nextId("l"), engagementId: eid, kind: input.content.kind, title: input.title, titleEdited: input.titleEdited ?? false,
    ranOn: input.ranOn, hostIds: input.hostIds, observations: input.observations, returnedNothing: input.returnedNothing,
    private: input.private, content: input.content, at: ++clock, createdAt: clock, updatedAt: clock,
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  clock = 1000;
  setupBackend();
});

/** Saves a command entry the way Add to log does. */
async function save(blocks: CommandBlock[], hostIds: string[] = [], ranOn = "Kali (VM)"): Promise<{ entry: LogEntry; summary: ExtractionSummary | null }> {
  clock++;
  const content = { kind: "command" as const, blocks };
  const edits: CaptureEdits = {
    kind: "command", title: "t", titleEdited: false, hostIds, ranOn, observations: "", returnedNothing: false, private: false, content,
  };
  return saveCapture({
    engagementId: "e1",
    draft: { kind: "command", title: "t", hostIds, ranOn, content, unknownScopeIps: [], scan: null },
    edits,
    image: null,
    hosts: structuredClone(db.hosts),
    draftInput: { text: "", image: null, kind: "command", hosts: db.hosts.map((h) => ({ id: h.id, name: h.name, ip: h.ip, column: h.boardColumn })), scope: E1.scopeCidrs, domain: "corp.lan", machines: ["Kali (VM)"], lastRanOn: null },
  });
}

const SPRAY_CMD = "nxc ssh 10.10.1.5 -u users.txt -p 'SyntheticPw01' --continue-on-success";
const SPRAY = [
  "SSH         10.10.1.5       22     10.10.1.5        [*] SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.1",
  "SSH         10.10.1.5       22     10.10.1.5        [-] Sam.doe:SyntheticPw01",
  "SSH         10.10.1.5       22     10.10.1.5        [+] stan:SyntheticPw01  Linux - Shell access!",
  "SSH         10.10.1.5       22     10.10.1.5        [-] dina:SyntheticPw01",
].join("\n");

describe("applyInterpretation", () => {
  it("nxc spray: valid pair becomes a credential and win line; failed unknown-secret pairs become tried pairs and a count", async () => {
    const { entry, summary } = await save([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    expect(db.credentials).toEqual([expect.objectContaining({ username: "stan", secret: "SyntheticPw01", type: "password" })]);
    expect(db.tried.map((t) => [t.username, t.secret, t.hostId, t.service, t.logEntryId])).toEqual([
      ["Sam.doe", "SyntheticPw01", "hC", "ssh", entry.id],
      ["dina", "SyntheticPw01", "hC", "ssh", entry.id],
    ]);
    // Failed pairs never become credentials.
    expect(db.credentials.some((c) => c.username !== "stan")).toBe(false);
    expect(summary?.wins).toEqual(["stan:SyntheticPw01 works on SSH, Srv12"]);
    expect(summary?.counts).toContain("2 failed attempts recorded");
    expect(summary?.ticks).toEqual(["Ticked 'Spray usernames and found passwords across every login surface' on Srv12"]);
    expect(m.triedPairPromote).toHaveBeenCalledWith("e1", "stan", null, "SyntheticPw01");
    expect(db.extractions).toHaveLength(1);
    expect(db.extractions[0]!.summary).toEqual(summary);
  });

  it("a valid pair later promotes its tried pair", async () => {
    await save([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    expect(db.tried.map((t) => t.username)).toEqual(["Sam.doe", "dina"]);
    const later = "SSH         10.10.1.5       22     10.10.1.5        [+] dina:SyntheticPw01  Linux - Shell access!";
    const { summary } = await save([{ command: "nxc ssh 10.10.1.5 -u dina -p 'SyntheticPw01'", output: later }], ["hC"]);
    expect(db.credentials.map((c) => c.username)).toEqual(["stan", "dina"]);
    expect(m.triedPairPromote).toHaveBeenLastCalledWith("e1", "dina", null, "SyntheticPw01");
    expect(db.tried.map((t) => t.username)).toEqual(["Sam.doe"]);
    expect(summary?.wins).toEqual(["dina:SyntheticPw01 works on SSH, Srv12"]);
  });

  it("secretsdump on an unknown IP creates the host and lists 'New host'", async () => {
    const { summary } = await save([{ command: "impacket-secretsdump corp.lan/jay:Synth123!@10.10.1.9", output: sam }]);
    const created = db.hosts.find((h) => h.ip === "10.10.1.9");
    expect(created).toBeDefined();
    expect(m.hostCreate).toHaveBeenCalledWith("e1", { name: "10.10.1.9", ip: "10.10.1.9" });
    expect(summary?.counts).toContain("New host 10.10.1.9");
    // SAM hashes are local to the dumped host; the machine account is dropped (the host's name isn't known).
    const local = db.credentials.filter((c) => c.scope === "local");
    expect(local.length).toBeGreaterThan(0);
    expect(local.every((c) => c.localHostId === created!.id)).toBe(true);
    expect(db.credentials.some((c) => c.username.endsWith("$") || c.username.includes("MACHINE"))).toBe(false);
    expect(db.extractions[0]!.record.createdHostIds).toEqual([created!.id]);
  });

  it("a DC's machine account hash is a win; $MACHINE.ACC is named after its host", async () => {
    setupBackend({ hosts: [{ ...DC01, adSetEffective: true }], services: [service("s88", "hD", 88), service("s389", "hD", 389)] });
    const { summary } = await save([{ command: "impacket-secretsdump corp.lan/jay:Synth123!@10.10.1.10", output: sam }]);
    expect(db.credentials).toContainEqual(expect.objectContaining({ username: "DC01$", secret: "000c000c000c000c000c000c000c000c", type: "hash" }));
    expect(summary?.wins).toContain("DC01$ hash: can DCSync");
    expect(summary?.counts).toContain("9 hashes added");
  });

  it("a re-dump records the stored rows it proved again (interpreters-and-payloads interpreters-and-payloads spec §3.2)", async () => {
    setupBackend({ hosts: [DC01] });
    const dump = { command: "impacket-secretsdump corp.lan/jay:Synth123!@10.10.1.10", output: sam };
    await save([dump]);
    const first = db.extractions[0]!.record;
    expect(first.createdCredentialIds.length).toBeGreaterThan(0);
    expect(first.reprovedCredentialIds).toEqual([]);
    await save([dump]);
    const second = db.extractions[1]!.record;
    expect(second.createdCredentialIds).toEqual([]);
    expect([...second.reprovedCredentialIds].sort()).toEqual([...first.createdCredentialIds].sort());
  });

  it("hashcat cracks a captured NetNTLMv2 hash stored in another case", async () => {
    const captured = "jay::corp:1122334455667788:0123456789abcdef0123456789abcdef:0101000000000000aabbccdd00000000";
    setupBackend({ credentials: [cred({ id: "cN", type: "hash", username: "jay", domain: "corp", secret: captured, hashType: "NetNTLMv2" })] });
    const out = `${captured.toUpperCase()}:Password1`;
    const { summary } = await save([{ command: "hashcat -m 5600 responder.txt --show", output: out }]);
    expect(m.credentialCrack).toHaveBeenCalledWith("cN", "Password1");
    expect(summary?.wins).toContain("jay:Password1 cracked");
  });

  it("same paste twice files nothing new", async () => {
    await save([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    const snapshot = structuredClone({ c: db.credentials, t: db.tried, u: db.usernames, n: db.attempts.length });
    const { summary } = await save([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    expect(summary).toEqual(NOTHING_NEW);
    expect(db.credentials).toEqual(snapshot.c);
    expect(db.tried).toEqual(snapshot.t);
    expect(db.usernames).toEqual(snapshot.u);
    expect(db.attempts).toHaveLength(snapshot.n);
    // Still stored, so the entry shows it.
    expect(db.extractions).toHaveLength(2);
    expect(db.extractions[1]!.summary).toEqual(NOTHING_NEW);
  });

  it("mixed paste: nxc spray then sudo -l files both on the right hosts", async () => {
    const { summary } = await save(
      [
        { command: SPRAY_CMD, output: SPRAY },
        { command: "sudo -l", output: sudoL, shell: "stan@web01" },
      ],
      ["hC"],
    );
    expect(db.attempts.filter((a) => a.result === "valid").map((a) => a.hostId)).toEqual(["hC"]);
    expect(db.vectors.map((v) => [v.hostId, v.title])).toEqual([
      ["hW", "sudo /usr/sbin/tcpdump as ALL (GTFOBins)"],
      ["hW", "sudo /usr/bin/gcc as ALL (GTFOBins)"],
    ]);
    expect(summary?.wins).toEqual([
      "stan:SyntheticPw01 works on SSH, Srv12",
      "sudo /usr/sbin/tcpdump as ALL (GTFOBins) on web01",
      "sudo /usr/bin/gcc as ALL (GTFOBins) on web01",
    ]);
  });

  it("the extraction is stored after the board sync (R7)", async () => {
    await save([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    const last = (f: { mock: { invocationCallOrder: number[] } }) => Math.max(0, ...f.mock.invocationCallOrder);
    expect(m.extractionSave).toHaveBeenCalledTimes(1);
    expect(m.extractionSave.mock.invocationCallOrder[0]).toBeGreaterThan(last(m.checklistPut));
    expect(m.extractionSave.mock.invocationCallOrder[0]).toBeGreaterThan(last(m.checklistApplyCover));
    // The output tick was written with the entry as evidence before the extraction existed.
    expect(db.checklist.find((c) => c.ownerId === "hC" && c.goalId === "h-vuln-spray")).toMatchObject({ status: "done" });
  });

  it("output that parses nothing stores no extraction and has no summary", async () => {
    const { summary } = await save([{ command: "ls -la", output: "total 0" }], ["hC"]);
    expect(summary).toBeNull();
    expect(m.extractionSave).not.toHaveBeenCalled();
  });

  it("the record lists every created id and before-snapshot", async () => {
    setupBackend({
      credentials: [
        cred({ id: "cJen", username: "jay", domain: "corp.lan", secret: "Synth123!" }),
        cred({ id: "cH", type: "hash", username: "paul", domain: "corp.lan", secret: "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f", hashType: "NTLM", crackStatus: "uncracked" }),
      ],
      attempts: [{ id: "aOld", engagementId: "e1", credId: "cJen", usernameId: null, hostId: "hC", service: "smb", port: 445, result: "failed", authMode: "domain", detail: null, logEntryId: null, at: 5 }],
      identity: { hostId: "hC", username: "corp\\jay", privileges: [], groups: [], entryId: null, updatedAt: 1 },
    });
    const blocks: CommandBlock[] = [
      {
        command: "nxc smb 10.10.1.5 -u jay dina -p 'Synth123!' 'Guess1'",
        output: [
          "SMB  10.10.1.5  445  SRV12  [+] corp.lan\\jay:Synth123! (Pwn3d!)",
          "SMB  10.10.1.5  445  SRV12  [-] corp.lan\\dina:Guess1 STATUS_LOGON_FAILURE",
        ].join("\n"),
      },
      { command: "hashcat -m 1000 hashes.txt --show", output: "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f:Winter2000!" },
      { command: "whoami /priv", output: "PRIVILEGES INFORMATION\n----------------------\n\nPrivilege Name                Description                    State\n============================= ============================== ========\nSeImpersonatePrivilege        Impersonate a client after authentication Enabled\n", shell: "evil-winrm" },
    ];
    const { entry, summary } = await save(blocks, ["hC"]);
    const record: ExtractionRecord = db.extractions[0]!.record;
    const pw = db.credentials.find((c) => c.crackedFrom === "cH")!;
    expect(record.createdCredentialIds).toEqual([pw.id]);
    expect(record.credentialsBefore).toEqual([expect.objectContaining({ id: "cH", crackStatus: "uncracked" })]);
    expect(record.attemptsBefore).toEqual([expect.objectContaining({ id: "aOld", result: "failed", logEntryId: null })]);
    expect(record.createdUsernameIds).toEqual(db.usernames.map((u) => u.id));
    expect(db.usernames.map((u) => u.username)).toEqual(["jay", "dina"]);
    expect(record.createdTriedPairIds).toEqual(db.tried.map((t) => t.id));
    expect(db.tried).toEqual([expect.objectContaining({ username: "dina", secret: "Guess1", logEntryId: entry.id })]);
    expect(record.identityBefore).toEqual([{ hostId: "hC", identity: expect.objectContaining({ username: "corp\\jay", privileges: [] }) }]);
    expect(record.createdVectorIds).toEqual(db.vectors.map((v) => v.id));
    expect(db.vectors.map((v) => v.title)).toEqual(["SeImpersonatePrivilege abuse"]);
    expect(record.outputTicks).toContainEqual({ ownerId: "hC", goalId: "h-vuln-spray", parser: "nxc-results" });
    expect(record.createdHostIds).toEqual([]);
    expect(summary?.wins).toEqual([
      "jay:Synth123! works on SMB, Srv12 (admin)",
      "SeImpersonatePrivilege abuse on Srv12",
      "paul:Winter2000! cracked",
    ]);
    expect(summary?.counts).toEqual(expect.arrayContaining(["1 failed attempt recorded", "2 usernames added", "Identity updated on Srv12"]));
  });

  it("records a scan's created services and the OS it filled", async () => {
    const { summary } = await saveCapture({
      engagementId: "e1",
      draft: {
        kind: "command", title: "t", hostIds: ["hC"], ranOn: "Kali (VM)", unknownScopeIps: [],
        content: { kind: "command", blocks: [{ command: "nmap 10.10.1.5", output: "" }] },
        scan: {
          hostId: "hC",
          ports: [
            { port: 22, protocol: "tcp", state: "open", service: "ssh", version: "" },
            { port: 80, protocol: "tcp", state: "open", service: "http", version: "" },
          ],
          os: "linux",
        },
      },
      edits: { kind: "command", title: "t", titleEdited: false, hostIds: ["hC"], ranOn: "Kali (VM)", observations: "", returnedNothing: false, private: false, content: { kind: "command", blocks: [{ command: "nmap 10.10.1.5", output: "" }] } },
      image: null,
      hosts: [{ ...SRV12, os: null }],
    });
    const record = db.extractions[0]!.record;
    // Port 22 was already a service; only 80 is new.
    expect(record.createdServiceIds).toEqual(db.services.filter((s) => s.port === 80).map((s) => s.id));
    expect(record.hostOsBefore).toEqual([{ hostId: "hC", os: null }]);
    expect(summary?.counts).toEqual(["1 service updated on Srv12", "OS set on Srv12"]);
  });

  it("an IP change files on the known host and says so", async () => {
    const out = "SMB  10.10.1.77  445  WEB01  [+] corp.lan\\jay:Synth123!";
    const { summary } = await save([{ command: "nxc smb 10.10.1.77 -u jay -p 'Synth123!'", output: out }]);
    expect(db.hosts.some((h) => h.ip === "10.10.1.77")).toBe(false);
    expect(db.attempts.map((a) => a.hostId)).toEqual(["hW"]);
    expect(summary?.counts).toContain("web01 answered on 10.10.1.77");
  });

  it("failed-only lines on an unknown IP make no host and are counted", async () => {
    const out = "SMB  10.10.1.88  445  GHOST  [-] corp.lan\\jay:Nope1 STATUS_LOGON_FAILURE";
    const { summary } = await save([{ command: "nxc smb 10.10.1.88 -u jay -p 'Nope1'", output: out }]);
    expect(m.hostCreate).not.toHaveBeenCalled();
    expect(db.tried).toEqual([]);
    // Nothing filed, but what was kept out is news.
    expect(summary).toEqual({ wins: [], counts: ["1 result on hosts not in this engagement"], ticks: [] });
  });

  it("results on an IP outside the engagement's scope make no host and are counted (R23)", async () => {
    const out = "SMB  10.20.0.9  445  GHOST  [+] corp.lan\\jay:Synth123!";
    const { summary } = await save([
      { command: "nxc smb 10.20.0.9 -u jay -p 'Synth123!'", output: out },
      { command: "impacket-secretsdump corp.lan/jay:Synth123!@10.20.0.9", output: sam },
    ]);
    expect(m.hostCreate).not.toHaveBeenCalled();
    expect(db.hosts.some((h) => h.ip === "10.20.0.9")).toBe(false);
    // The SAM hashes are local to the out-of-scope host: dropped. Only the cached domain hashes (no host) are filed.
    expect(db.credentials.every((c) => c.scope === "domain" && c.localHostId === null)).toBe(true);
    expect(db.attempts).toEqual([]);
    const outside = summary?.counts.find((c) => c.endsWith("outside this engagement's scope"));
    expect(outside).toBe("8 results outside this engagement's scope");
  });

  it("a failed read after filing still leaves an exact record", async () => {
    let reads = 0;
    m.triedPairsList.mockImplementation(async () => {
      // The second read is the one after filing.
      if (++reads === 2) throw new Error("db busy");
      return structuredClone(db.tried);
    });
    const err = await save([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]).catch((e: unknown) => e);
    expect(err).toMatchObject({ message: expect.stringContaining("Raven couldn't file what it found") });
    const record = db.extractions[0]!.record;
    expect(record.createdCredentialIds).toEqual(db.credentials.map((c) => c.id));
    expect(record.createdTriedPairIds).toEqual(db.tried.map((t) => t.id));
    expect(record.createdTriedPairIds).toHaveLength(2);
    expect(record.createdAttemptIds).toEqual(db.attempts.map((a) => a.id));
    expect(record.createdUsernameIds).toEqual(db.usernames.map((u) => u.id));
  });

  it("a credential takes over its tried pairs' failures before they go (R24)", async () => {
    // dina failed on Srv12 (a tried pair), then works on web01.
    await save([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    const pair = db.tried.find((t) => t.username === "dina")!;
    const later = "SSH         10.10.1.6       22     10.10.1.6        [+] dina:SyntheticPw01  Linux - Shell access!";
    await save([{ command: "nxc ssh 10.10.1.6 -u dina -p 'SyntheticPw01'", output: later }], ["hW"]);
    const dina = db.credentials.find((c) => c.username === "dina")!;
    const attempts = db.attempts.filter((a) => a.credId === dina.id).map((a) => [a.hostId, a.service, a.result, a.logEntryId, a.at]);
    expect(attempts).toEqual(
      expect.arrayContaining([
        ["hC", "ssh", "failed", pair.logEntryId, pair.at],
        ["hW", "ssh", "valid", expect.any(String), expect.any(Number)],
      ]),
    );
    expect(db.tried.some((t) => t.username === "dina")).toBe(false);
    const failedOnA = db.attempts.find((a) => a.credId === dina.id && a.hostId === "hC")!;
    expect(db.extractions[1]!.record.createdAttemptIds).toContain(failedOnA.id);
  });

  it("a credential takes over only the tried pairs the store puts in its domain", async () => {
    const pair = (id: string, domain: string): TriedPair => ({
      id, engagementId: "e1", username: "jay", domain, secret: "Synth999!", secretKind: "password", hostId: "hC", service: "ssh",
      authMode: "domain", logEntryId: null, at: 1,
    });
    setupBackend({ tried: [pair("tNetbios", "CORP"), pair("tOther", "corp.local")] });
    const hit = "SMB         10.10.1.5       445    SRV12            [+] corp.lan\\jay:Synth999!";
    await save([{ command: "nxc smb 10.10.1.5 -u jay -p 'Synth999!'", output: hit }], ["hC"]);
    const jay = db.credentials.find((c) => c.username === "jay")!;
    expect(jay.domain).toBe("corp.lan");
    // CORP is the engagement's domain spelled the NetBIOS way; corp.local is another domain.
    expect(m.sameDomains).toHaveBeenCalledWith("e1", expect.arrayContaining([["CORP", "corp.lan"], ["corp.local", "corp.lan"]]));
    expect(db.attempts.filter((a) => a.credId === jay.id && a.result === "failed").map((a) => [a.hostId, a.service])).toEqual([["hC", "ssh"]]);
    expect(db.tried.map((t) => t.id)).toEqual(["tOther"]);
  });

  it("a dumped credential the store holds in another spelling is proved again, not created", async () => {
    setupBackend({ hosts: [DC01] });
    const header = "[*] Dumping Domain Credentials (domain\\uid:rid:lmhash:nthash)\n[*] Using the DRSUAPI method to get NTDS.DIT secrets\n";
    const dump = (out: string) => save([{ command: "impacket-secretsdump corp.lan/jay:Synth123!@10.10.1.10", output: header + out }]);
    await dump("corp.lan\\paul:1106:aad3b435b51404eeaad3b435b51404ee:00140014001400140014001400140014:::");
    const paul = db.credentials.find((c) => c.username === "paul")!;
    // Stored under the NetBIOS name; the next dump prints the FQDN.
    expect(paul.domain).toBe("corp.lan");
    paul.domain = "CORP";
    await dump("corp.lan\\paul:1106:aad3b435b51404eeaad3b435b51404ee:00140014001400140014001400140014:::");
    expect(db.credentials.filter((c) => c.username === "paul").map((c) => c.id)).toEqual([paul.id]);
    expect(db.extractions[1]!.record.createdCredentialIds).toEqual([]);
    expect(db.extractions[1]!.record.reprovedCredentialIds).toEqual([paul.id]);
  });

  describe("john cracks", () => {
    const hashes = [
      cred({ id: "hNt", type: "hash", username: "jay", domain: "corp.lan", secret: "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f", hashType: "NTLM", crackStatus: "uncracked" }),
      cred({ id: "hTgs", type: "hash", username: "jay", domain: "corp.lan", secret: "$krb5tgs$23$*jay$CORP.LAN$http/web01*$aabbccdd$eeff0011", hashType: "Kerberoast TGS-REP (etype 23, RC4)", crackStatus: "uncracked" }),
    ];
    const show = "jay:Winter2000!\n\n1 password hash cracked, 0 left";

    it("with --format, the user's hash of that type is cracked", async () => {
      setupBackend({ credentials: hashes });
      await save([{ command: "john --show --format=nt hashes.txt", output: show }]);
      expect(db.credentials.find((c) => c.id === "hNt")!.crackStatus).toBe("cracked");
      expect(db.credentials.find((c) => c.id === "hTgs")!.crackStatus).toBe("uncracked");
    });

    it("without --format, a user with two hashes cracks nothing; with one, that one", async () => {
      setupBackend({ credentials: hashes });
      await save([{ command: "john --show hashes.txt", output: show }]);
      expect(m.credentialCrack).not.toHaveBeenCalled();
      setupBackend({ credentials: [hashes[1]!] });
      await save([{ command: "john --show hashes.txt", output: show }]);
      expect(db.credentials.find((c) => c.id === "hTgs")!.crackStatus).toBe("cracked");
    });
  });

  describe("john cracks with a DOMAIN prefix", () => {
    const dcc2 = (id: string, domain: string, hex: string) =>
      cred({ id, type: "hash", username: "stan", domain, secret: `$DCC2$10240#stan#${hex}`, hashType: "DCC2", crackStatus: "uncracked" });
    const a = dcc2("hA", "CORP.LAN", "0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a");
    const b = dcc2("hB", "OTHER.LOCAL", "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b");
    const status = (id: string) => db.credentials.find((c) => c.id === id)!.crackStatus;
    const run = (output: string) => save([{ command: "john --show --format=mscash2 dcc2.txt", output: `${output}\n\n1 password hash cracked, 0 left` }]);

    it("DOMAIN/user cracks the user's hash in that domain", async () => {
      setupBackend({ credentials: [a] });
      await run("CORP.LAN/stan:Password1");
      expect(status("hA")).toBe("cracked");
    });

    it("DOMAIN\\user does too, and a NetBIOS prefix matches the FQDN", async () => {
      setupBackend({ credentials: [a] });
      await run("CORP\\stan:Password1");
      expect(status("hA")).toBe("cracked");
    });

    it("the prefix picks the right one of two same-named users", async () => {
      setupBackend({ credentials: [a, b] });
      await run("OTHER.LOCAL/stan:Password1");
      expect(status("hB")).toBe("cracked");
      expect(status("hA")).toBe("uncracked");
    });

    it("a prefix naming another domain files nothing", async () => {
      setupBackend({ credentials: [a] });
      await run("ELSEWHERE.NET/stan:Password1");
      expect(m.credentialCrack).not.toHaveBeenCalled();
    });
  });

  it("the store returns the FQDN username already listed for a NetBIOS user, which is proved again", async () => {
    setupBackend({ usernames: [{ id: "uJ", engagementId: "e1", username: "jay", domain: "corp.lan", sourceHostId: null, source: null, createdAt: 1 }] });
    const entry: LogEntry = {
      id: "lX", engagementId: "e1", kind: "command", title: "t", titleEdited: false, ranOn: null, hostIds: ["hC"], observations: null,
      returnedNothing: false, private: false, at: 5, createdAt: 5, updatedAt: 5,
      content: { kind: "command", blocks: [{ command: "kerbrute userenum users.txt", output: "2026/01/01 00:00:00 >  [+] VALID USERNAME:\t jay@CORP" }] },
    };
    const r = interpretEntry(entry, db.hosts);
    const applied = await applyInterpretation("e1", entry, r, { hosts: db.hosts, createdHostIds: [], scans: [], identity: null });
    expect(m.usernameCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ username: "jay", domain: "CORP" }));
    expect(db.usernames.map((u) => u.id)).toEqual(["uJ"]);
    expect(applied.record.createdUsernameIds).toEqual([]);
    // Listed again: another entry's Undo keeps it.
    expect(applied.record.reprovedUsernameIds).toEqual(["uJ"]);
  });

  it("a re-roast records the stored hash and username it proved again, so undoing the first keeps them (interpreters-and-payloads interpreters-and-payloads spec §3.2)", async () => {
    const roast = (hex: string) => [
      "SMB         10.10.1.5       445    SRV12            [-] corp.lan\\drew:SynthWrong01 STATUS_LOGON_FAILURE",
      `$krb5tgs$23$*svc_sql$CORP.LAN$corp.lan/svc_sql*$${hex}$${hex}${hex}`,
    ].join("\n");
    const cmd = "nxc smb 10.10.1.5 -u drew -p 'SynthWrong01' --kerberoasting out";
    await save([{ command: cmd, output: roast("aaaa1111") }], ["hC"]);
    const a = db.extractions[0]!.record;
    const hash = db.credentials.find((c) => c.username === "svc_sql")!;
    const drew = db.usernames.find((u) => u.username === "drew")!;
    expect(a.createdCredentialIds).toEqual([hash.id]);
    expect(a.createdUsernameIds).toEqual([drew.id]);

    await save([{ command: cmd, output: roast("bbbb2222") }], ["hC"]);
    const b = db.extractions[1]!.record;
    expect(b.createdCredentialIds).toEqual([]);
    expect(b.reprovedCredentialIds).toEqual([hash.id]);
    expect(b.reprovedUsernameIds).toEqual([drew.id]);
    // Undoing A keeps what another live extraction created or proved again (extractions.rs `undo`).
    const kept = new Set(db.extractions.slice(1).flatMap((x) => [...x.record.createdCredentialIds, ...x.record.reprovedCredentialIds, ...x.record.createdUsernameIds, ...x.record.reprovedUsernameIds]));
    expect(a.createdCredentialIds.every((id) => kept.has(id))).toBe(true);
    expect(a.createdUsernameIds.every((id) => kept.has(id))).toBe(true);
  });
});

describe("an nxc pair that matches a stored credential", () => {
  const win = (ip: string) => `SSH         ${ip}       22     ${ip}        [+] stan:SyntheticPw01  Linux - Shell access!`;

  it("is recorded as re-proved, not created (interpreters-and-payloads interpreters-and-payloads spec §3.2)", async () => {
    await save([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    const stan = db.credentials.find((c) => c.username === "stan")!;
    await save([{ command: "nxc ssh 10.10.1.6 -u stan -p 'SyntheticPw01'", output: win("10.10.1.6") }], ["hW"]);
    const b = db.extractions[1]!.record;
    expect(db.credentials).toHaveLength(1);
    expect(b.createdCredentialIds).toEqual([]);
    expect(b.reprovedCredentialIds).toEqual([stan.id]);
  });

  it("is not re-proved when the same save created it", async () => {
    await save([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    const a = db.extractions[0]!.record;
    expect(a.createdCredentialIds).toHaveLength(1);
    expect(a.reprovedCredentialIds).toEqual([]);
  });
});

describe("output ticks", () => {
  const entryOf = (id: string): LogEntry => ({
    id, engagementId: "e1", kind: "command", title: "t", titleEdited: false, ranOn: null, hostIds: ["hC"], observations: null,
    returnedNothing: false, private: false, at: 5, createdAt: 5, updatedAt: 5,
    content: { kind: "command", blocks: [{ command: "echo", output: "" }] },
  });
  const extraction = (id: string, undoneAt: number | null): Extraction => ({
    logEntryId: id, engagementId: "e1", summary: { wins: [], counts: [], ticks: [] }, createdAt: 1, undoneAt,
    record: {
      createdHostIds: [], createdServiceIds: [], servicesBefore: [], hostOsBefore: [], identityBefore: [], createdCredentialIds: [],
      credentialsBefore: [], createdUsernameIds: [], createdAttemptIds: [], attemptsBefore: [], createdTriedPairIds: [], createdVectorIds: [],
      outputTicks: [{ ownerId: "hC", goalId: "h-vuln-spray", parser: "nxc-results" }], reprovedCredentialIds: [], reprovedUsernameIds: [],
    },
  });
  const evidence = () => db.checklist.find((c) => c.ownerId === "hC" && c.goalId === "h-vuln-spray");

  it("editing an entry keeps its output ticks", async () => {
    db.extractions.push(extraction("l9", null));
    await afterEntrySaved("e1", entryOf("l9"), "l9");
    expect(evidence()).toMatchObject({ status: "done", evidence: [{ entryId: "l9", commandId: "out:nxc-results" }] });
  });

  it("Tick from log rebuilds output ticks, except an undone extraction's", async () => {
    db.extractions.push(extraction("l9", null), extraction("l8", 2));
    m.logList.mockResolvedValue([entryOf("l9"), { ...entryOf("l8"), hostIds: ["hW"] }]);
    m.extractionsList.mockImplementation(async () => structuredClone(db.extractions));
    const { loadTickContext, tickFromLog } = await import("../../../features/checklist/ticks");
    await tickFromLog("e1", await loadTickContext("e1"));
    expect(evidence()).toMatchObject({ status: "done", evidence: [{ entryId: "l9", commandId: "out:nxc-results" }] });
  });

  it("an undone extraction's entry ticks nothing", async () => {
    db.extractions.push(extraction("l9", null));
    await afterEntrySaved("e1", entryOf("l9"), "l9");
    db.extractions[0]!.undoneAt = 2;
    await afterEntrySaved("e1", entryOf("l9"), "l9");
    expect(evidence()?.status ?? "todo").toBe("todo");
  });
});
