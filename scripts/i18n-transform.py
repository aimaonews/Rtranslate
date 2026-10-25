# -*- coding: utf-8 -*-
"""
i18n 全量转换器 v2（问题 2）：文件级状态机，正确跟踪跨行调用。
跳过：注释、已接 t()/L()/ct()/ot()/tAuto() 的参数、数据块（TABS/TAB_DESCS/BUILTIN_*）、'译' 预览字符。
替换：'中文' → ot('key','中文')（options/popup/tab*）或 L('key','中文')（files/onboarding）。
"""
import io, json, re

CJK = re.compile(r'[\u4e00-\u9fff]')
SKIP_CALLS = {'t', 'tAuto', 'ct', 'ot', 'tabLabel', 'resolveUiLang', 'engineName', 'engineDesc', 'styleName', 'expertName', 'L'}
SKIP_LITERALS = {'译'}
SKIP_BLOCKS = ('const TABS', 'const TAB_DESCS', 'const BUILTIN_ENGINES', 'const BUILTIN_EXPERTS', 'const ENGINE_NAMES')

FILES = [
    ('src/options/main.ts',          'opt',             'ot', 'module'),
    ('src/options/tabExperts.ts',    'opt.experts',     'ot', 'ctx'),
    ('src/options/tabGlossaryLibs.ts','opt.glossaryLibs','ot', 'ctx'),
    ('src/options/tabHotkeys.ts',    'opt.hotkeys',     'ot', 'ctx'),
    ('src/options/tabTts.ts',        'opt.tts',         'ot', 'ctx'),
    ('src/options/tabWriting.ts',    'opt.writing',     'ot', 'ctx'),
    ('src/popup/main.ts',            'pop',             'ot', 'module'),
    ('src/files/main.ts',            'files',           'L',  None),
    ('src/onboarding/main.ts',       'ob',              'L',  None),
]

def find_skip_ranges(lines):
    """数据块行范围（含头尾行）"""
    ranges = []
    for i, line in enumerate(lines):
        for marker in SKIP_BLOCKS:
            if marker in line and '=' in line:
                depth = 0
                started = False
                j = i
                while j < len(lines):
                    # 粗算：忽略字符串内括号（数据块内无复杂字符串）
                    for ch in lines[j]:
                        if ch in '[{':
                            depth += 1; started = True
                        elif ch in ']}':
                            depth -= 1
                    if started and depth <= 0:
                        break
                    j += 1
                ranges.append((i, min(j, len(lines) - 1)))
                break
    return ranges

def scan_file(path):
    """返回 (lines, replacements, keys)。replacements: (line_idx, col_start, col_end, literal, key)"""
    src = io.open(path, encoding='utf-8').read()
    lines = src.split('\n')
    skip_ranges = find_skip_ranges(lines)
    def in_skip(i):
        return any(a <= i <= b for a, b in skip_ranges)

    keys = {}
    replacements = []
    counter = [0]

    in_block_comment = False
    call_stack = []          # 文件级：[funcName,...]
    pending_ident = None     # 最近看到的标识符（若紧跟 ( 则入栈）

    for i, line in enumerate(lines):
        j = 0
        n = len(line)
        while j < n:
            if in_block_comment:
                k = line.find('*/', j)
                if k == -1:
                    j = n
                    break
                in_block_comment = False
                j = k + 2
                continue
            two = line[j:j+2]
            if two == '/*':
                k = line.find('*/', j + 2)
                if k == -1:
                    in_block_comment = True
                    j = n
                    break
                j = k + 2
                continue
            if two == '//':
                break
            ch = line[j]
            if ch in ('"', "'", '`'):
                k = j + 1
                while k < n:
                    if line[k] == '\\':
                        k += 2
                        continue
                    if line[k] == ch:
                        break
                    k += 1
                literal = line[j:min(k + 1, n)]
                inner = literal[1:-1]
                enclosing = call_stack[-1] if call_stack else None
                if (CJK.search(inner) and inner not in SKIP_LITERALS
                        and enclosing not in SKIP_CALLS and not in_skip(i)):
                    if inner not in keys:
                        counter[0] += 1
                        keys[inner] = '%s.s%d' % (prefix_global, counter[0])
                    replacements.append((i, j, min(k + 1, n), literal, keys[inner]))
                j = min(k + 1, n)
                pending_ident = None
                continue
            m = re.match(r'[A-Za-z_$][\w$]*', line[j:]) if (ch.isalpha() or ch in '_$') else None
            if m:
                pending_ident = m.group(0)
                j += len(pending_ident)
                continue
            if ch == '(':
                call_stack.append(pending_ident)
                pending_ident = None
            elif ch == ')':
                if call_stack:
                    call_stack.pop()
                pending_ident = None
            elif ch == ',':
                pending_ident = None
            j += 1
    return lines, replacements, keys

prefix_global = ''
all_flat = {}
for path, prefix, wrap_fn, helper_kind in FILES:
    prefix_global = prefix
    lines, replacements, keys = scan_file(path)
    # 倒序替换
    by_line = {}
    for (i, a, b, literal, key) in replacements:
        by_line.setdefault(i, []).append((a, b, literal, key))
    for i, items in by_line.items():
        line = lines[i]
        for a, b, literal, key in sorted(items, key=lambda x: -x[0]):
            line = line[:a] + "%s('%s', %s)" % (wrap_fn, key, literal) + line[b:]
        lines[i] = line
    src = '\n'.join(lines)

    # 插入 ot 辅助
    if helper_kind == 'module':
        anchor = 'let config: Config'
        idx = src.find(anchor)
        assert idx > 0, path
        decl = "\n/** 当前界面语言文案（zh-CN 回退原文；auto 先解析为浏览器语言） */\nconst ot = (key: string, zh: string): string => t(key, resolveUiLang(config.uiLang), zh)"
        src = src[:idx + len(anchor)] + decl + src[idx + len(anchor):]
    elif helper_kind == 'ctx':
        m = re.search(r'(export function render\w+\(root: HTMLElement, ctx: \w+\): void \{)', src)
        assert m, path + ' render fn'
        src = src[:m.end()] + "\n  const ot = (key: string, zh: string): string => t(key, resolveUiLang(ctx.config.uiLang), zh)" + src[m.end():]

    io.open(path, 'w', encoding='utf-8', newline='\n').write(src)
    for zh, key in keys.items():
        all_flat[key] = zh
    print('%s: %d unique keys, %d call-sites replaced' % (path, len(keys), len(replacements)))

io.open('scripts/i18n-new-keys.json', 'w', encoding='utf-8').write(json.dumps(all_flat, ensure_ascii=False, indent=1))
print('\nTOTAL unique keys:', len(all_flat))
