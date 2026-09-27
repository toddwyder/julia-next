#!/usr/bin/env python3
"""Install the supported trial board and eager sandbox option into the scaffold."""
from pathlib import Path
import sys

p = Path(sys.argv[1]).resolve() / 'src/mastra/index.ts'
t = p.read_text()
anchor = "import { Mastra } from '@mastra/core/mastra';"
addition = "import { createTrialBoard } from './trial/trial-board.mjs';"
if addition not in t:
    if t.count(anchor) != 1:
        raise SystemExit('Unexpected scaffold import; inspect before configuring')
    t = t.replace(anchor, anchor + '\n' + addition, 1)
anchor = 'export const factory = new MastraFactory({'
addition = "\n  boards: [createTrialBoard({ evidenceDir: '/var/lib/julia-factory/evidence/jul183' })],\n  sandboxStart: 'eager',"
if addition not in t:
    if t.count(anchor) != 1:
        raise SystemExit('Unexpected scaffold Factory constructor; inspect before configuring')
    t = t.replace(anchor, anchor + addition, 1)
p.write_text(t)
print('Configured supported trial board and eager sandbox start')
