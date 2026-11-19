import re,sys,json
BN=re.compile(r'[ঀ-৿]')
LIT=r"(?:'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\")"
# literal + expr + literal ... (expr: anything without quotes/commas/semicolons, balanced-ish)
EXP=r"(?:[^'\";,+\n`]|\([^()'\"\n]*\))+?"
pat=re.compile(LIT+r"(?:\s*\+\s*"+EXP+r"\s*\+\s*"+LIT+r")+|"+LIT+r"\s*\+\s*"+EXP+r"(?=\s*[,;)\]}])|"+EXP+r"\s*\+\s*"+LIT)
tpl=re.compile(r'`((?:[^`\\]|\\.)*)`',re.S)
out={}
for f in sys.argv[1:]:
    t=open(f,encoding='utf-8').read()
    for line in t.split('\n'):
        if '+' not in line or not BN.search(line): continue
        for m in re.finditer(LIT+r"(?:\s*\+\s*[^'\"\n]+?\s*\+\s*"+LIT+r")+",line):
            s=m.group(0)
            parts=re.findall(LIT,s)
            lits=[p[1:-1] for p in parts]
            if not any(BN.search(x) for x in lits): continue
            # কতগুলো এক্সপ্রেশন মাঝে
            key='{}'.join(lits)
            key=re.sub(r'\s+',' ',key).strip()
            if key.count('{}')>3 or len(key)>300 or '<' in key: continue
            out.setdefault(key,f)
    for m in tpl.finditer(t):
        s=m.group(1)
        if '${' not in s or not BN.search(s) or '<' in s: continue
        k=re.sub(r'\$\{[^}]*\}','{}',s); k=re.sub(r'\s+',' ',k).strip()
        if len(k)<300: out.setdefault(k,f)
json.dump(out,sys.stdout,ensure_ascii=False,indent=0)
print(len(out),file=sys.stderr)
