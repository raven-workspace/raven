import re, subprocess, sys
for _ in range(3):
    out=subprocess.run(['npx','tsc','-b'],capture_output=True,text=True).stdout
    errs=re.findall(r"^(\S+)\((\d+),\d+\): error TS6133: '(\w+)' is declared but its value is never read", out, re.M)
    if not errs: break
    byfile={}
    for f,l,n in errs: byfile.setdefault(f,[]).append((int(l),n))
    for f,items in byfile.items():
        lines=open(f).read().split('\n')
        for l,n in items:
            line=lines[l-1]
            if not line.startswith('import'): print("skip",f,l,n); continue
            m=re.match(r'^import (\w+)?(?:, )?(?:\{([^}]*)\})? from (.*)$', line)
            if not m: print("noparse",f,line); continue
            default,named,src=m.groups()
            names=[x.strip() for x in (named or '').split(',') if x.strip()]
            if default==n: default=None
            names=[x for x in names if x not in (n, 'type '+n)]
            if not default and not names: lines[l-1]=None; continue
            parts=[]
            if default: parts.append(default)
            if names: parts.append('{ '+', '.join(names)+' }')
            lines[l-1]='import '+', '.join(parts)+' from '+src
        open(f,'w').write('\n'.join(x for x in lines if x is not None))
print(subprocess.run(['npx','tsc','-b'],capture_output=True,text=True).stdout[:3000])
