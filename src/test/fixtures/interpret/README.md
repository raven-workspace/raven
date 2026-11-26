# Interpreter fixtures

Each `.txt` file is real tool output captured in a lab, anonymised before it enters the repo.

## Sources

- the owner's lab notes (outside the repo) (markdown code blocks)
- a Raven backup (outside the repo) (`machines[].logEntries[].blocks[].output`)

## Anonymisation rules

- IPs become `10.10.x.x`.
- Users, hosts and domains become stock names: `zoe`, `omar`, `DC01`, `corp.lan`.
- Hashes and passwords become synthetic values of the same shape (same length and character set).
- Keep every structural line: headers, banners, column layout.
- Real data never enters the repo.

## Unverified parsers

lsassy, kerbrute, rpcclient/lookupsid and pspy have no real samples. Their fixtures are written from each tool's documented format and the parser carries `// unverified: no real sample yet (owner collects in next lab)`.

## PEAS fixtures

`linpeas-plain.txt` and `winpeas-plain.txt` keep the section structure and line formats of real PEAS runs (trimmed to the sections the parser reads, plus a few noise sections), with every host, user, date and secret replaced by stock values. The real runs had no GTFOBins SUID/sudo/capability hit, no token privilege of interest and no unquoted service, so those lines (`/usr/bin/find`, `sudo vim`, `python3.10 cap_setuid`, `SeImpersonatePrivilege`, `AlwaysInstallElevated`, `AcmeSyncSvc` unquoted) are written in PEAS's documented format. `linpeas-ansi.txt` is the plain fixture with PEAS's documented colour codes added by hand (`ESC[1;31;103m` red-on-yellow for 95% vectors, plain red/green/cyan elsewhere), because no coloured capture exists. The winPEAS section headers keep the mis-decoded glyphs of the saved console output.
