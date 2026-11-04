import { describe, expect, it } from 'vitest'
import { detectPrompt, splitPaste } from '../../../engines/parse/logPaste'

const EW = '*Evil-WinRM* PS C:\\Users\\harriet\\Documents> '

describe('splitPaste', () => {
  it('single block', () => {
    expect(
      splitPaste("nxc winrm 172.31.162.97 -u harriet -p 'x'\nWINRM ... [+] ... (Pwn3d!)\n"),
    ).toEqual([
      {
        command: "nxc winrm 172.31.162.97 -u harriet -p 'x'",
        output: 'WINRM ... [+] ... (Pwn3d!)',
      },
    ])
  })

  it('single line paste', () => {
    expect(splitPaste('whoami')).toEqual([{ command: 'whoami', output: '' }])
  })

  it('evil-winrm session', () => {
    const text = [
      "evil-winrm -i 172.31.162.97 -u harriet -p 'x'",
      'Evil-WinRM shell v3.5',
      `${EW}whoami`,
      'vertex\\harriet',
      `${EW}whoami /priv`,
      'SeChangeNotifyPrivilege Enabled',
      'SeIncreaseWorkingSetPrivilege Enabled',
      EW,
    ].join('\n')
    const blocks = splitPaste(text)
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toEqual({
      command: "evil-winrm -i 172.31.162.97 -u harriet -p 'x'",
      output: 'Evil-WinRM shell v3.5',
    })
    expect(blocks[1]).toEqual({ shell: 'evil-winrm', command: 'whoami', output: 'vertex\\harriet' })
    expect(blocks[2].command).toBe('whoami /priv')
    expect(blocks[2].output).toContain('SeIncreaseWorkingSetPrivilege')
  })

  it('cmd prompt', () => {
    expect(splitPaste('C:\\Windows\\system32>whoami\nnt authority\\system')).toEqual([
      { shell: 'cmd', command: 'whoami', output: 'nt authority\\system' },
    ])
  })

  it('nmap output with # lines is one block', () => {
    const blocks = splitPaste('sudo nmap -sC -sV 10.0.0.5\n# Nmap 7.94 scan initiated\nPORT STATE SERVICE')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].output).toContain('# Nmap')
  })

  it('crlf', () => {
    expect(splitPaste('a\r\nb')).toEqual([{ command: 'a', output: 'b' }])
  })

  it('bare $ prompts split when another prompt kind is present', () => {
    const blocks = splitPaste('ssh bob@10.0.0.5\nbob@web:~$ id\nuid=1000(bob)\n$ pwd\n/home/bob')
    expect(blocks.map((b) => [b.shell, b.command])).toEqual([
      [undefined, 'ssh bob@10.0.0.5'],
      ['bob@web', 'id'],
      ['sh', 'pwd'],
    ])
  })

  it('returns [] for blank input', () => {
    expect(splitPaste('\n  \n')).toEqual([])
  })
})

describe('detectPrompt', () => {
  it('detects powershell and user@host', () => {
    expect(detectPrompt('PS C:\\x> dir')).toEqual({ shell: 'powershell', command: 'dir' })
    expect(detectPrompt('root@kali:/tmp# ls')).toEqual({ shell: 'root@kali', command: 'ls' })
  })
  it('returns null for plain text', () => {
    expect(detectPrompt('whoami')).toBeNull()
  })
})
