import re,sys,json
BN=re.compile(r'[ঀ-৿]')
pats=[re.compile(r"'((?:[^'\\\n]|\\.)*)'"),re.compile(r'"((?:[^"\\\n]|\\.)*)"'),re.compile(r'`((?:[^`\\]|\\.)*)`',re.S),re.compile(r'>([^<>{}]+)<')]
def norm(s): return re.sub(r'\s+',' ',s).strip()
out={}
for f in sys.argv[1:]:
    t=open(f,encoding='utf-8').read()
    t=re.sub(r'^\s*//.*$','',t,flags=re.M)
    t=re.sub(r'<!--.*?-->','',t,flags=re.S)
    for p in pats:
        for m in p.finditer(t):
            s=m.group(1)
            if not BN.search(s): continue
            if p.pattern.startswith('`'):
                parts=re.split(r'\$\{[^}]*\}|<[^>]+>',s)
            elif p.pattern.startswith('>'):
                parts=re.split(r'\{[^}]*\}',s)
            else: parts=[s]
            for x in parts:
                x=norm(x.replace("\\'","'").replace('\\"','"').replace('\\n',' '))
                if BN.search(x) and len(x)<400: out.setdefault(x,f)
print(len(out),file=sys.stderr)
json.dump(out,sys.stdout,ensure_ascii=False,indent=0)
