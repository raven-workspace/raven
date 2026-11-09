# Lab checklist: Payloads 2b-C + pre-lab batch (one session)

Tick as you go. Each line: do this → you should see that. Order follows a normal box.

## Set-up
- [ ] Settings: LHOST = your tun0, port 4444 → status strip shows `LHOST <tun0>:4444` on one line, no "0/0" while it loads.
- [ ] Add the lab hosts; open one → hint row at the bottom reads `J next step · H stuck · F finding · L capture · ⌥1–3 tabs`.
- [ ] Collapse the sidebar (⌘B) on a host with a thread → the thread dot stays on that host's rail icon.

## Recon
- [ ] On a host, press `J` → focus lands on the first To-do/Doing step (the Next tab, or the full checklist if this stage has none open).
- [ ] Log nmap output; delete a service you'd marked dead end → its "ruled out" entry goes too.
- [ ] Log page: a command run against 3+ hosts → two host chips plus `+N`.

## Foothold
- [ ] `P` on a web host → drawer opens on the best fit; ↵ copies it. Misfits are marked ("Needs X", "Failed here before"), not folded away.
- [ ] Paste into: try **Uploaded file**, **Jenkins / Groovy console**, **Node code**, **Java code** → each gives a payload that works as pasted (Uploaded file: the file to save + the URL to hit).
- [ ] Shell list on Linux → perl, socat (TTY), BusyBox nc `-e`, awk are there; on Windows → ConPtyShell and PowerShell TLS.
- [ ] Pick a bind shell → the listener block is **Connect with** `nc <target> <port>`.
- [ ] Listener chip → penelope, rlwrap nc, socat TTY, ncat `--ssl`, msfconsole multi/handler; the one the payload needs is picked.
- [ ] `⌥B` Callbacks blocked → bind shells first, reverse ones marked "needs a callback". Two failed callbacks on a host → amber "Callbacks failed here twice".
- [ ] `⌥F` Filter on a Linux injection context → base64 / `${IFS}` / hex wrappers, with parts saying what each avoids.
- [ ] `⌥T` Tools → tick nc missing → nc payloads drop with "Needs nc"; a row set to "from your log" goes back to what the log says.
- [ ] Port chip → **Other…** → type 8443, ↵ → field opens under the chip, port is 8443 for this host only; 99999 shows "1–65535" and won't set.
- [ ] Pick OS Linux after pasting from cmd.exe → the cmd.exe paste override drops (Web shell `?cmd=` would stay).
- [ ] Tab / ⇧Tab in the drawer → focus wraps inside it, never the page behind.
- [ ] msfvenom → staged + stageless Meterpreter (Win x64, Linux x64, PHP) and Windows shell staged; listener is multi/handler. The WAR shows once, any OS.
- [ ] Nishang / powercat → the prepare step copies from `/usr/share/nishang/Shells/…` and `/usr/share/windows-resources/powercat/…`. **Check both exist on your Kali.**
- [ ] Copy rev.ps1 or an msfvenom file, then change LHOST → the block opens with amber **Rebuild first: built with … now …**; trigger is held until you copy the rebuild.
- [ ] Throwaway exam-sim engagement: a Meterpreter payload with no lock → info line "Using Meterpreter here makes this your Metasploit machine"; ⌘↵ (copy and log) → strip shows Metasploit locked to that host. On another host → amber "Metasploit is locked to <host>" and copy goes through the guard.
- [ ] SQL injection (`⌥3`) on a DB host → copy step 1 → it folds to "1. Break the query · copied" and focus moves to step 2; fill "Columns found" → that step folds with your value; ↵ on a fold reopens it.
- [ ] Log a payload that fails with PowerShell "not recognized as a cmdlet" → that payload is marked "Failed here before". Edit the log entry → payload id can be cleared.

## Privesc
- [ ] Log `id -a` output → Who am I fills in, like `id`.
- [ ] Upgrade (`⌥6`) → steps run in order and paste cleanly.
- [ ] Transfer: copy with `{FILE}` empty → hint says press **⌘↵** again (not ↵).

## Post-ex / creds
- [ ] `L`, paste `DOMAIN\user:pass` → key line "Adds 1 credential for <host>: DOMAIN\user." and **Add as credential** on; Save → it's in Credentials, Undo removes it. `⌘J` keeps it a note only.
- [ ] Credentials: a user granted and tested working on one host → counted once in Host credentials.
- [ ] Mark a host root → board puts it in Post-exploitation even before proof is ticked.
- [ ] `L` with a screenshot → file name reads "Saved as …" under Caption; in the Log, a caption equal to the title isn't repeated.

## Wrap-up
- [ ] Finding (`F`): type a CVE and close within a second → reopen, the lookup finishes. Failed save after close → error shows when the draft comes back. A 3.0 vector → click 3.1 to convert.
- [ ] Finding services list: tab through ports → focus rings aren't clipped, nothing under the scrollbar.

## If something's off
Take a screenshot (⌘⇧4, include the hint row), and jot: host, which drawer/tab, the exact keys you pressed in order, and what you expected. One line per issue in a note is enough; I'll fix from that.
