"""Checks every verbatim block in the extract against the original repo, byte for byte.
Usage: python3 verify.py <extract dir> <repo dir>"""
import os, re, sys

OUT, REPO = sys.argv[1], sys.argv[2]
pat = re.compile(r'@@ VERBATIM (\S+):(\d+)-(\d+) \|')
checked = failed = 0
for root, _, files in os.walk(OUT):
    if 'originals' in root: continue
    for name in files:
        p = os.path.join(root, name)
        if name in ('MANIFEST.tsv', 'README.md', 'verify.py'): continue
        lines = open(p, encoding='utf-8', newline='').read().split('\n')
        i = 0
        while i < len(lines):
            m = pat.search(lines[i])
            if not m: i += 1; continue
            src, a, b = m.group(1), int(m.group(2)), int(m.group(3))
            n = b - a + 1
            got = lines[i + 1:i + 1 + n]
            want = open(os.path.join(REPO, src), encoding='utf-8', newline='').read().split('\n')[a - 1:b]
            end_ok = '@@ END VERBATIM' in lines[i + 1 + n]
            checked += 1
            if got != want or not end_ok:
                failed += 1
                print('MISMATCH', p, src, a, b)
            i += n + 2
print('blocks checked: %d, mismatches: %d' % (checked, failed))
sys.exit(1 if failed else 0)
