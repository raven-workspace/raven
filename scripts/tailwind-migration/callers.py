import os,re,sys,json
names=sys.argv[1].split(',')
def tags(s,name):
    for m in re.finditer(r'<'+name+r'\b(?![\w.])',s):
        i=m.end(); depth=0
        while i<len(s):
            c=s[i]
            if c=='{': depth+=1
            elif c=='}': depth-=1
            elif depth==0 and c=='>': break
            i+=1
        yield s[m.start():i+1], s.count('\n',0,m.start())+1
res=[]
for d,_,fs in os.walk('src'):
    if d.startswith('src/test') or d.startswith('src/ui/shadcn'): continue
    for f in fs:
        if not f.endswith('.tsx'): continue
        p=os.path.join(d,f); s=open(p).read()
        for n in names:
            for t,line in tags(s,n):
                for a in re.finditer(r'\bclassName=("([^"]*)"|\{(?:[^{}]|\{[^{}]*\})*\})',t):
                    props=dict(re.findall(r'\b(variant|size|tone|gap|align|mono|active)=(?:"([^"]*)"|\{([^}]*)\})',t) and [(k,v or w) for k,v,w in re.findall(r'\b(variant|size|tone|gap|align|mono|active)=(?:"([^"]*)"|\{([^}]*)\})',t)])
                    res.append({"c":n,"file":f"{p}:{line}","static":a.group(2),"raw":a.group(1)[:120],"props":props})
json.dump(res,sys.stdout)
