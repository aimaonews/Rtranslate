# -*- coding: utf-8 -*-
"""
修复 i18n-transform 遗留问题：模板字面量回退（含 ${expr}）在非中文界面显示字面 ${...}。
转换：ot('KEY', `a ${expr} b`) → fmt(ot('KEY', 'a {p1} b'), { p1: expr })
输出受影响键的新 zh 源（{pN} 形式）供重译。
"""
import io, json, re

FILES = [
    'src/options/main.ts', 'src/options/tabExperts.ts', 'src/options/tabGlossaryLibs.ts',
    'src/options/tabHotkeys.ts', 'src/options/tabTts.ts', 'src/options/tabWriting.ts',
    'src/popup/main.ts', 'src/files/main.ts', 'src/onboarding/main.ts',
]
# 匹配 ot('KEY', `...`) 或 L('KEY', `...`)（单行，模板字面量内无反引号）
CALL_RE = re.compile(r"\b(ot|L)\('([^']+)',\s*`([^`]*)`\)")
INTERP_RE = re.compile(r'\$\{([^}]*)\}')

new_keys = {}   # key -> zh with {pN}
for path in FILES:
    s = io.open(path, encoding='utf-8').read()
    changed = False

    def convert(m):
        global new_keys
        fn, key, tmpl = m.group(1), m.group(2), m.group(3)
        parts = []
        names = []
        last = 0
        for i, im in enumerate(INTERP_RE.finditer(tmpl), 1):
            parts.append(tmpl[last:im.start()])
            names.append('p%d' % i)
            last = im.end()
        parts.append(tmpl[last:])
        zh = ''
        for i, seg in enumerate(parts):
            zh += seg
            if i < len(names):
                zh += '{%s}' % names[i]
        new_keys[key] = zh
        exprs = ', '.join('%s: %s' % (n, e) for n, e in zip(names, INTERP_RE.findall(tmpl)))
        return "fmt(%s('%s', '%s'), { %s })" % (fn, key, zh.replace("'", "\\'"), exprs)

    s2 = CALL_RE.sub(convert, s)
    if s2 != s:
        # 确保 fmt 已导入
        if 'fmt' not in re.search(r"import \{[^}]*\} from '\.\./shared/i18n'", s2).group(0):
            s2 = re.sub(r"import \{ t", "import { fmt, t", s2, count=1)
        changed = True
        io.open(path, 'w', encoding='utf-8', newline='\n').write(s2)
        print(path, 'converted')

io.open('scripts/i18n-fix-keys.json', 'w', encoding='utf-8').write(json.dumps(new_keys, ensure_ascii=False, indent=1))
print('\naffected keys:', len(new_keys), '→ scripts/i18n-fix-keys.json')
