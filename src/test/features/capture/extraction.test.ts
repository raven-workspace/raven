import { beforeEach, describe, expect, it, vi } from "vitest";
import { interpretEntry, NOTHING_NEW, outputTicks, proveEntry, summarize, type PlacedInterpretation, type Proved, type Ticked } from "../../../features/capture/extraction";
import { syncChecklist } from "../../../features/checklist/sync";
import { api } from "../../../lib/api";
import type { ChecklistItem } from "../../../types/checklist";
import type { CredAttempt, Credential, Username } from "../../../types/credentials";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";
import type { CommandBlock, Extraction, LogEntry } from "../../../types/log";
import type { Service } from "../../../types/service";
import sam from "../../fixtures/interpret/secretsdump-sam.txt?raw";
import sudoL from "../../fixtures/interpret/sudo-l.txt?raw";
import { emptyRecord, filed } from "./filed";

// What an output proves and how the summary words what the store filed. The filing itself is the store's
// (extractions/filing.rs), tested in Rust.

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
const cred = (o: Partial<Credential> & { id: string }): Credential => ({
  engagementId: "e1", type: "password", username: "", domain: null, secret: "", hashType: null, scope: "domain",
  localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1, ...o,
});
const attempt = (o: Partial<CredAttempt> & { id: string; credId: string }): CredAttempt => ({
  engagementId: "e1", usernameId: null, hostId: "hC", service: "ssh", port: null, result: "valid", authMode: "domain", detail: null,
  logEntryId: "l1", at: 10, ...o,
});
let stored: { credentials: Credential[]; usernames: Username[]; checklist: ChecklistItem[]; extractions: Extraction[] };
/** The store's answer for E1 (domain corp.lan): equal spellings, and CORP with corp.lan. A stub, not the rule. */
const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const sameIn = (a: string | null | undefined, b: string | null | undefined) => lc(a) === lc(b) || new Set(["corp|corp.lan", "corp.lan|corp"]).has(`${lc(a)}|${lc(b)}`);

beforeEach(() => {
  vi.resetAllMocks();
  stored = { credentials: [], usernames: [], checklist: [], extractions: [] };
  m.credentialsList.mockImplementation(async () => structuredClone(stored.credentials));
  m.usernamesList.mockImplementation(async () => structuredClone(stored.usernames));
  m.sameDomains.mockImplementation(async (_e, pairs) => pairs.map(([a, b]) => sameIn(a, b)));
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([SRV12, WEB01]);
  m.servicesListEngagement.mockResolvedValue([service("s22", "hC", 22), service("s445", "hC", 445)]);
  m.checklistList.mockImplementation(async () => structuredClone(stored.checklist));
  m.checklistPut.mockImplementation(async (eid, items) => {
    for (const it of items) {
      stored.checklist = stored.checklist.filter((c) => !(c.ownerId === it.ownerId && c.goalId === it.goalId));
      stored.checklist.push({ ...it, engagementId: eid, updatedAt: 1 } as ChecklistItem);
    }
    return structuredClone(stored.checklist);
  });
  m.checklistApplyFacts.mockImplementation(async () => structuredClone(stored.checklist));
  m.checklistApplyCover.mockImplementation(async () => structuredClone(stored.checklist));
  m.extractionGet.mockImplementation(async (id) => structuredClone(stored.extractions.find((x) => x.logEntryId === id) ?? null));
});

const entryOf = (blocks: CommandBlock[], hostIds: string[] = []): LogEntry => ({
  id: "l1", engagementId: "e1", kind: "command", title: "t", titleEdited: false, ranOn: "Kali (VM)", hostIds, observations: null,
  returnedNothing: false, private: false, at: 10, createdAt: 10, updatedAt: 10, content: { kind: "command", blocks },
});

/** The proofs of an entry with these blocks, read against `hosts`. */
async function prove(blocks: CommandBlock[], hostIds: string[] = [], hosts: Host[] = [SRV12, WEB01]): Promise<{ r: PlacedInterpretation; proved: Proved | null }> {
  const entry = entryOf(blocks, hostIds);
  const r = interpretEntry(entry, hosts, "corp.lan", E1.scopeCidrs);
  return { r, proved: await proveEntry("e1", entry, r, { hosts, createdHostIds: [], scans: [], identity: null }) };
}

const SPRAY_CMD = "nxc ssh 10.10.1.5 -u users.txt -p 'SyntheticPw01' --continue-on-success";
const SPRAY = [
  "SSH         10.10.1.5       22     10.10.1.5        [*] SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.1",
  "SSH         10.10.1.5       22     10.10.1.5        [-] Sam.doe:SyntheticPw01",
  "SSH         10.10.1.5       22     10.10.1.5        [+] stan:SyntheticPw01  Linux - Shell access!",
  "SSH         10.10.1.5       22     10.10.1.5        [-] dina:SyntheticPw01",
].join("\n");
const NO_TICKS: Ticked = { ticks: [], lines: [], dcNames: new Set() };
const names = (hosts: Host[]) => (id: string | null | undefined) => hosts.find((h) => h.id === id)?.name ?? "";

describe("what an output proves", () => {
  it("an nxc spray: the valid pair is a credential to accept, the failed pairs with an unknown secret are tried pairs", async () => {
    const { proved } = await prove([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    const intake = proved!.proofs.intake!;
    expect(intake.credentials.map((c) => [c.input.username, c.input.secret, c.accepted])).toEqual([
      ["stan", "SyntheticPw01", true],
      ["Sam.doe", "SyntheticPw01", false],
      ["dina", "SyntheticPw01", false],
    ]);
    expect(intake.credentials[0]!.attempts).toEqual([expect.objectContaining({ hostId: "hC", service: "ssh", result: "valid" })]);
    // Proofs carry no engagement, entry or time: the store files them on the entry.
    expect(intake.credentials[0]!.attempts[0]).not.toHaveProperty("logEntryId");
    expect(intake.credentials[0]!.input).not.toHaveProperty("engagementId");
    expect(proved!.proofs.triedPairs.map((t) => [t.username, t.secret, t.hostId, t.service, t.secretKind])).toEqual([
      ["Sam.doe", "SyntheticPw01", "hC", "ssh", "password"],
      ["dina", "SyntheticPw01", "hC", "ssh", "password"],
    ]);
  });

  it("a pair the store holds already is an attempt on it, not a pending credential", async () => {
    stored.credentials = [cred({ id: "cStan", username: "stan", secret: "SyntheticPw01" })];
    const { proved } = await prove([{ command: "nxc ssh 10.10.1.6 -u stan -p 'SyntheticPw01'", output: "SSH  10.10.1.6  22  10.10.1.6  [+] stan:SyntheticPw01  Linux - Shell access!" }], ["hW"]);
    expect(proved!.proofs.intake!.attempts).toEqual([expect.objectContaining({ credId: "cStan", hostId: "hW", result: "valid" })]);
    expect(proved!.proofs.intake!.credentials).toEqual([]);
  });

  it("a --local-auth result: the username is the answering host's own account, keyed by that host for its attempts", async () => {
    stored.credentials = [cred({ id: "cJen", username: "jay", secret: "SyntheticPw01", scope: "local", localHostId: "hC" })];
    const out = [
      "SMB  10.10.1.6  445  WEB01  [+] WEB01\\jay:SyntheticPw01",
      "SMB  10.10.1.5  445  SRV12  [-] SRV12\\kim:SyntheticPw01 STATUS_LOGON_FAILURE",
    ].join("\n");
    const { proved } = await prove([{ command: "nxc smb 10.10.1.5-6 -u users.txt -p 'SyntheticPw01' --local-auth", output: out }]);
    const intake = proved!.proofs.intake!;
    // The store decides the scope: `.` with the host it answered from is that host's local account.
    expect(intake.usernames).toEqual([
      { key: "e1|jay|.|local:hW", input: { username: "jay", domain: ".", sourceHostId: "hW", source: "nxc" } },
      { key: "e1|kim|.|local:hC", input: { username: "kim", domain: ".", sourceHostId: "hC", source: "nxc" } },
    ]);
    // jay's secret is a local credential stored for SRV12: a result of that credential on WEB01 (password reuse).
    expect(intake.attempts).toEqual([
      expect.objectContaining({ credId: "cJen", hostId: "hW", result: "valid", authMode: "local" }),
      expect.objectContaining({ credId: "cJen", usernameKey: "e1|kim|.|local:hC", hostId: "hC", result: "failed" }),
    ]);
  });

  it("secretsdump of an unknown IP: a new host, the SAM hashes local to it, the machine account dropped", async () => {
    const { proved } = await prove([{ command: "impacket-secretsdump corp.lan/jay:Synth123!@10.10.1.9", output: sam }]);
    const { newHosts, credentials } = proved!.proofs;
    expect(newHosts).toEqual([{ key: "new-host:10.10.1.9", ip: "10.10.1.9" }]);
    const local = credentials.filter((c) => c.scope === "local");
    expect(local.length).toBeGreaterThan(0);
    expect(local.every((c) => c.localHostId === "new-host:10.10.1.9" && c.sourceHostId === "new-host:10.10.1.9")).toBe(true);
    expect(credentials.some((c) => c.username?.endsWith("$") || c.username?.includes("MACHINE"))).toBe(false);
  });

  it("a DC's $MACHINE.ACC is named after its host", async () => {
    const { proved } = await prove([{ command: "impacket-secretsdump corp.lan/jay:Synth123!@10.10.1.10", output: sam }], [], [DC01]);
    expect(proved!.proofs.newHosts).toEqual([]);
    expect(proved!.proofs.credentials).toContainEqual(expect.objectContaining({ username: "DC01$", secret: "000c000c000c000c000c000c000c000c", type: "hash" }));
  });

  it("hashcat cracks a captured NetNTLMv2 hash stored in another case", async () => {
    const captured = "jay::corp:1122334455667788:0123456789abcdef0123456789abcdef:0101000000000000aabbccdd00000000";
    stored.credentials = [cred({ id: "cN", type: "hash", username: "jay", domain: "corp", secret: captured, hashType: "NetNTLMv2" })];
    const { proved } = await prove([{ command: "hashcat -m 5600 responder.txt --show", output: `${captured.toUpperCase()}:Password1` }]);
    expect(proved!.proofs.cracks).toEqual([{ plaintext: "Password1", credentialIds: ["cN"], proofCredentials: [] }]);
  });

  it("a crack names a hash dumped in the same entry by its place in the proofs", async () => {
    const dump = "[*] Dumping Domain Credentials (domain\\uid:rid:lmhash:nthash)\ncorp.lan\\paul:1106:aad3b435b51404eeaad3b435b51404ee:0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f:::";
    const { proved } = await prove([
      { command: "impacket-secretsdump corp.lan/jay:Synth123!@10.10.1.5", output: dump },
      { command: "hashcat -m 1000 hashes.txt --show", output: "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f:Winter2000!" },
    ]);
    const at = proved!.proofs.credentials.findIndex((c) => c.username === "paul");
    expect(proved!.proofs.cracks).toEqual([{ plaintext: "Winter2000!", credentialIds: [], proofCredentials: [at] }]);
  });

  describe("john cracks", () => {
    const hashes = [
      cred({ id: "hNt", type: "hash", username: "jay", domain: "corp.lan", secret: "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f", hashType: "NTLM", crackStatus: "uncracked" }),
      cred({ id: "hTgs", type: "hash", username: "jay", domain: "corp.lan", secret: "$krb5tgs$23$*jay$CORP.LAN$http/web01*$aabbccdd$eeff0011", hashType: "Kerberoast TGS-REP (etype 23, RC4)", crackStatus: "uncracked" }),
    ];
    const show = "jay:Winter2000!\n\n1 password hash cracked, 0 left";
    const cracked = async (command: string, output = show) => (await prove([{ command, output }])).proved!.proofs.cracks.flatMap((k) => k.credentialIds);

    it("with --format, the user's hash of that type", async () => {
      stored.credentials = hashes;
      expect(await cracked("john --show --format=nt hashes.txt")).toEqual(["hNt"]);
    });

    it("without --format, nothing for a user with two hashes; with one, that one", async () => {
      stored.credentials = hashes;
      expect(await cracked("john --show hashes.txt")).toEqual([]);
      stored.credentials = [hashes[1]!];
      expect(await cracked("john --show hashes.txt")).toEqual(["hTgs"]);
    });

    const dcc2 = (id: string, domain: string, hex: string) =>
      cred({ id, type: "hash", username: "stan", domain, secret: `$DCC2$10240#stan#${hex}`, hashType: "DCC2", crackStatus: "uncracked" });
    const a = dcc2("hA", "CORP.LAN", "0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a");
    const b = dcc2("hB", "OTHER.LOCAL", "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b");
    const run = (line: string) => cracked("john --show --format=mscash2 dcc2.txt", `${line}\n\n1 password hash cracked, 0 left`);

    it("a DOMAIN/user or DOMAIN\\user prefix names the domain, as the store decides it", async () => {
      stored.credentials = [a];
      expect(await run("CORP.LAN/stan:Password1")).toEqual(["hA"]);
      expect(await run("CORP\\stan:Password1")).toEqual(["hA"]);
      stored.credentials = [a, b];
      expect(await run("OTHER.LOCAL/stan:Password1")).toEqual(["hB"]);
      stored.credentials = [a];
      expect(await run("ELSEWHERE.NET/stan:Password1")).toEqual([]);
    });
  });

  it("an IP change places the results on the known host and makes none", async () => {
    stored.credentials = [cred({ id: "cJen", username: "jay", domain: "corp.lan", secret: "Synth123!" })];
    const { proved } = await prove([{ command: "nxc smb 10.10.1.77 -u jay -p 'Synth123!'", output: "SMB  10.10.1.77  445  WEB01  [+] corp.lan\\jay:Synth123!" }]);
    expect(proved!.proofs.newHosts).toEqual([]);
    expect(proved!.proofs.intake!.attempts.map((a) => a.hostId)).toEqual(["hW"]);
    expect(proved!.plan!.ipChanges).toEqual([expect.objectContaining({ hostName: "web01", to: "10.10.1.77" })]);
  });

  it("results outside the engagement's scope prove no host and are dropped", async () => {
    const { r, proved } = await prove([
      { command: "nxc smb 10.20.0.9 -u jay -p 'Synth123!'", output: "SMB  10.20.0.9  445  GHOST  [+] corp.lan\\jay:Synth123!" },
      { command: "impacket-secretsdump corp.lan/jay:Synth123!@10.20.0.9", output: sam },
    ]);
    expect(proved!.proofs.newHosts).toEqual([]);
    expect(proved!.proofs.credentials.every((c) => c.scope === "domain" && c.localHostId === null)).toBe(true);
    expect(r.outOfScope).toBe(8);
  });

  it("sudo -l in a shell on another host proves vectors there", async () => {
    const { proved } = await prove([{ command: "sudo -l", output: sudoL, shell: "stan@web01" }], ["hC"]);
    expect(proved!.proofs.vectors).toEqual([
      { hostId: "hW", title: "sudo /usr/sbin/tcpdump as ALL (GTFOBins)" },
      { hostId: "hW", title: "sudo /usr/bin/gcc as ALL (GTFOBins)" },
    ]);
  });

  it("output that parses nothing proves nothing", async () => {
    expect((await prove([{ command: "ls -la", output: "total 0" }], ["hC"])).proved).toBeNull();
  });
});

describe("the summary of what the store filed", () => {
  it("a spray: the win, the failures (tried pairs included) and the tick", async () => {
    const { r, proved } = await prove([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    const stan = cred({ id: "c1", username: "stan", secret: "SyntheticPw01" });
    const f = filed({ credentials: [stan], attempts: [attempt({ id: "a1", credId: "c1" })], triedPairsAdded: 2, record: { createdCredentialIds: ["c1"] } });
    const ticked = await outputTicks("e1", r, (p) => proved!.hostOf(p, f));
    expect(ticked.ticks).toEqual([{ ownerId: "hC", goalId: "h-vuln-spray", parser: "nxc-results" }]);
    const summary = summarize({ r, plan: proved!.plan, filed: f, identityHostId: null, hostName: names([SRV12, WEB01]), ticked });
    expect(summary).toEqual({
      wins: ["stan:SyntheticPw01 works on SSH, Srv12"],
      counts: ["2 failed attempts recorded"],
      ticks: ["Ticked 'Spray usernames and found passwords across every login surface' on Srv12"],
    });
  });

  it("password reuse from a dump reads as reuse, never as works on OTHER", async () => {
    const { r, proved } = await prove([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    // jay's local password, stored for web01, found again in a dump on Srv12.
    const jay = cred({ id: "cJ", username: "jay", secret: "Synth123!", scope: "local", localHostId: "hW" });
    const reuse = attempt({ id: "a1", credId: "cJ", service: "other", authMode: "local", detail: "password reuse" });
    const other = attempt({ id: "a2", credId: "cJ", hostId: "hW", service: "other", authMode: "local" });
    const f = filed({ credentials: [jay], attempts: [reuse, other], record: { reprovedCredentialIds: ["cJ"] } });
    const summary = summarize({ r, plan: proved!.plan, filed: f, identityHostId: null, hostName: names([SRV12, WEB01]), ticked: NO_TICKS });
    // A real result on another service still reads as one.
    expect(summary.wins).toEqual(["jay:Synth123! reused on Srv12 (same password as web01)", "jay:Synth123! works on OTHER, web01"]);
  });

  it("a DC's machine account hash is a win; other hashes are counted", async () => {
    m.hostsList.mockResolvedValue([{ ...DC01, adSetEffective: true }]);
    m.servicesListEngagement.mockResolvedValue([service("s88", "hD", 88), service("s389", "hD", 389)]);
    const { r, proved } = await prove([{ command: "impacket-secretsdump corp.lan/jay:Synth123!@10.10.1.10", output: sam }], [], [DC01]);
    const created = proved!.proofs.credentials.map((c, i) => cred({ ...(c as Partial<Credential>), id: `c${i}` }));
    const f = filed({ credentials: created, record: { createdCredentialIds: created.map((c) => c.id) } });
    const ticked = await outputTicks("e1", r, (p) => proved!.hostOf(p, f));
    const summary = summarize({ r, plan: proved!.plan, filed: f, identityHostId: null, hostName: names([DC01]), ticked });
    expect(summary.wins).toContain("DC01$ hash: can DCSync");
    expect(summary.counts).toContain("9 hashes added");
  });

  it("words every kind of news in order", async () => {
    const { r, proved } = await prove([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    const hash = cred({ id: "cH", type: "hash", username: "paul", secret: "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f", crackStatus: "cracked" });
    const pw = cred({ id: "cP", username: "paul", secret: "Winter2000!", crackedFrom: "cH" });
    const jay = cred({ id: "cJ", username: "jay", secret: "Synth123!" });
    const f = filed({
      credentials: [hash, pw, jay],
      attempts: [attempt({ id: "a1", credId: "cJ", service: "smb", result: "admin" }), attempt({ id: "a2", credId: "cJ", hostId: "hW", result: "failed" })],
      cracked: [{ hashId: "cH", plaintext: "Winter2000!" }],
      vectors: [{ id: "v1", hostId: "hC", title: "SeImpersonatePrivilege abuse", status: "try", source: "auto", createdAt: 1, updatedAt: 1 }],
      scans: [{ hostId: "hN", services: 2, osSet: true }],
      identityChanged: true,
      triedPairsAdded: 1,
      record: { createdHostIds: ["hN"], createdCredentialIds: ["cP"], createdUsernameIds: ["u1", "u2"], credentialsBefore: [{ ...hash, crackStatus: "uncracked" }] },
    });
    const hostName = names([SRV12, WEB01, host({ id: "hN", name: "10.10.1.9" })]);
    expect(summarize({ r, plan: proved!.plan, filed: f, identityHostId: "hC", hostName, ticked: NO_TICKS })).toEqual({
      wins: ["jay:Synth123! works on SMB, Srv12 (admin)", "SeImpersonatePrivilege abuse on Srv12", "paul:Winter2000! cracked"],
      counts: [
        "New host 10.10.1.9",
        "2 failed attempts recorded",
        "2 usernames added",
        "2 services updated on 10.10.1.9",
        "OS set on 10.10.1.9",
        "Identity updated on Srv12",
      ],
      ticks: [],
    });
  });

  it("nothing filed and nothing kept out is 'Nothing new'", async () => {
    const { r, proved } = await prove([{ command: SPRAY_CMD, output: SPRAY }], ["hC"]);
    const f = filed({ record: { reprovedCredentialIds: ["c1"] } });
    expect(summarize({ r, plan: proved!.plan, filed: f, identityHostId: null, hostName: names([SRV12]), ticked: NO_TICKS })).toEqual(NOTHING_NEW);
  });

  it("results kept out, and a host that moved, are news even when nothing was filed", async () => {
    const out = "SMB  10.10.1.88  445  GHOST  [-] corp.lan\\jay:Nope1 STATUS_LOGON_FAILURE";
    const dropped = await prove([{ command: "nxc smb 10.10.1.88 -u jay -p 'Nope1'", output: out }]);
    expect(dropped.proved!.proofs.newHosts).toEqual([]);
    expect(dropped.proved!.proofs.triedPairs).toEqual([]);
    expect(summarize({ r: dropped.r, plan: dropped.proved!.plan, filed: filed(), identityHostId: null, hostName: names([]), ticked: NO_TICKS })).toEqual({
      wins: [], counts: ["1 result on hosts not in this engagement"], ticks: [],
    });
    const moved = await prove([{ command: "nxc smb 10.10.1.77 -u jay -p 'Synth123!'", output: "SMB  10.10.1.77  445  WEB01  [+] corp.lan\\jay:Synth123!" }]);
    const summary = summarize({ r: moved.r, plan: moved.proved!.plan, filed: filed(), identityHostId: null, hostName: names([]), ticked: NO_TICKS });
    expect(summary.counts).toEqual(["web01 answered on 10.10.1.77"]);
  });
});

describe("output ticks", () => {
  const entry = (id: string): LogEntry => ({ ...entryOf([{ command: "echo", output: "" }], ["hC"]), id, at: 5 });
  const extraction = (id: string, undoneAt: number | null): Extraction => ({
    logEntryId: id, engagementId: "e1", summary: { wins: [], counts: [], ticks: [] }, createdAt: 1, undoneAt,
    record: { ...emptyRecord(), outputTicks: [{ ownerId: "hC", goalId: "h-vuln-spray", parser: "nxc-results" }] },
  });
  // What each entry ticks, as the sync hands it to the store's conditional write (the write itself is tested in Rust
  // and by the store scenarios).
  const sent = () => m.checklistApplyEntryTicks.mock.calls.flatMap((c) => c[1]);
  const spray = { ownerId: "hC", goalId: "h-vuln-spray", commandId: "out:nxc-results" };

  beforeEach(() => {
    m.checklistApplyEntryTicks.mockImplementation(async () => structuredClone(stored.checklist));
  });

  it("editing an entry keeps its output ticks", async () => {
    stored.extractions.push(extraction("l9", null));
    await syncChecklist({ engagementId: "e1", change: { entity: "logEntry", id: "l9", change: "updated", entry: entry("l9") } });
    expect(sent()).toEqual([{ entryId: "l9", at: expect.any(Number), ticks: [spray] }]);
  });

  it("Tick from log rebuilds output ticks, except an undone extraction's", async () => {
    stored.extractions.push(extraction("l9", null), extraction("l8", 2));
    m.logList.mockResolvedValue([entry("l9"), { ...entry("l8"), hostIds: ["hW"] }]);
    m.extractionsList.mockImplementation(async () => structuredClone(stored.extractions));
    await syncChecklist({ engagementId: "e1", change: { entity: "log", id: "e1", change: "rebuilt" } });
    expect(sent()).toEqual([{ entryId: "l9", at: 5, ticks: [spray] }, { entryId: "l8", at: 5, ticks: [] }]);
  });

  it("an undone extraction's entry ticks nothing", async () => {
    stored.extractions.push(extraction("l9", 2));
    await syncChecklist({ engagementId: "e1", change: { entity: "logEntry", id: "l9", change: "updated", entry: entry("l9") } });
    await syncChecklist({ engagementId: "e1", change: { entity: "extraction", id: "l9", change: "undone" } });
    expect(sent()).toEqual([{ entryId: "l9", at: expect.any(Number), ticks: [] }, { entryId: "l9", at: expect.any(Number), ticks: [] }]);
  });
});
