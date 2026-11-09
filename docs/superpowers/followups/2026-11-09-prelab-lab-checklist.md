# Lab checklist: Payloads 2b-C + pre-lab batch (one session)
Tick as you go. Each line: do this → you should see that.

## Set-up
- [ ] Look at the title bar on the board, a host and Settings → wordmark at the far left, controls at the far right, every screen.
- [ ] Set LHOST to tun0 in Settings → status strip shows `LHOST <tun0>:4444` on one line.
- [ ] Open a host → bottom hint row reads `J next step · H stuck · F finding · L capture · ⌥1–3 tabs`.

## Recon
- [ ] Press `J` on a host → focus jumps to the first To-do/Doing step.
- [ ] Open the Arsenal or Payloads drawer, press `J`, `H`, `F` → nothing happens behind the drawer.
- [ ] Delete a service you marked dead end → its "ruled out" entry goes too.

## Foothold
- [ ] `P` on a web host → best fit is on top; ↵ copies it.
- [ ] Look at the misfits → marked "Needs X" / "Failed here before", not folded away.
- [ ] Paste into **Uploaded file** → the file to save, then the URL to hit.
- [ ] Paste into **Jenkins / Groovy**, **Node code**, **Java code** → each gives a shell that runs as pasted.
- [ ] Paste into PowerShell prompt, pick **PowerShell TcpListener bind (-e)** → one `powershell … -e …` line that runs as pasted.
- [ ] Pick a bind shell → the second block is **Connect with** `nc <target> <port>`.
- [ ] Open the Listener chip → penelope, rlwrap nc, socat TTY, ncat `--ssl`, multi/handler; the one the payload needs is picked.
- [ ] `⌥B` (callbacks blocked) → bind shells first, reverse shells marked "needs a callback".
- [ ] `⌥F` (filter) on a Linux injection context → base64, `${IFS}` and hex wrappers to choose from.
- [ ] `⌥T` (tools), tick nc missing → nc payloads drop with "Needs nc".
- [ ] Port chip → **Other…** → 8443 ↵ → field opens under the chip; port is 8443 for this host.
- [ ] msfvenom → Meterpreter staged and stageless are listed; listener is multi/handler.
- [ ] Nishang / powercat → prepare step copies from `/usr/share/nishang/…` and `/usr/share/windows-resources/powercat/…`. Check both exist on Kali.
- [ ] Copy rev.ps1, then change LHOST → amber **Rebuild first: built with … now …** on top.
- [ ] Exam-sim engagement, no lock yet: pick a Meterpreter payload → "Using Meterpreter here makes this your Metasploit machine".
- [ ] Press ⌘↵ on it → status strip shows Metasploit locked to that host.
- [ ] Same payload on another host → amber "Metasploit is locked to <host>".
- [ ] SQL injection (`⌥3`): copy step 1 → it folds to "1. Break the query · copied" and step 2 gets focus.
- [ ] Log a payload that fails with "not recognized as a cmdlet" → it's marked "Failed here before" next time.

## Privesc
- [ ] Log `id -a` output → Who am I fills in.
- [ ] Transfer with `{FILE}` empty, copy → hint says press **⌘↵** again.

## Post-ex / creds
- [ ] `L`, paste `DOMAIN\user:pass` → "Adds 1 credential for <host>…" with **Add as credential** on.
- [ ] Save it → it's in Credentials; Undo removes it.
- [ ] Mark a host root → board shows it in Post-exploitation.
- [ ] `L` with a screenshot → file name shows as "Saved as …"; in the Log the caption isn't repeated.

## Wrap-up
- [ ] Finding: type a CVE and close within a second, reopen → the NVD lookup finishes.

## If something's off
Screenshot it (include the hint row) and note the host, which drawer or tab, and the keys you pressed in order. One line per issue is enough.
