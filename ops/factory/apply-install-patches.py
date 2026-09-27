#!/usr/bin/env python3
"""Apply the removable auth-workos 1.6.5 patch, rejecting unknown inputs."""
import hashlib
import json
from pathlib import Path
import sys

app = Path(sys.argv[1]).resolve()
package = app / 'node_modules/@mastra/auth-workos'
if json.loads((package / 'package.json').read_text())['version'] != '1.6.5':
    raise SystemExit('Unsupported auth-workos version: review upstream and remove/update the patch')

original_hash = '0e36ef9c0aab8063be3e9cd8c650f83fcf6681cccc476b8680835204ead9c098'
old = '''\t\t\tif (auth.user) {
\t\t\t\tlet memberships;
\t\t\t\tif (this.fetchMemberships) try {
\t\t\t\t\tmemberships = await this.getMemberships(auth.user.id);
\t\t\t\t} catch {}
\t\t\t\treturn {
\t\t\t\t\t...mapWorkOSUserToEEUser(auth.user),
\t\t\t\t\tworkosId: auth.user.id,
\t\t\t\t\torganizationId: auth.organizationId,
\t\t\t\t\tmemberships
\t\t\t\t};
\t\t\t}'''
new = old.replace('let memberships;', 'let organizationId = auth.organizationId;\n\t\t\t\tlet memberships;').replace(
    'memberships = await this.getMemberships(auth.user.id);',
    'memberships = await this.getMemberships(auth.user.id);\n\t\t\t\t\torganizationId ??= this.getSingleMembershipOrganizationId(memberships);'
).replace('organizationId: auth.organizationId,', 'organizationId,')

targets = [package / 'dist/index.js']
output = app / '.mastra/output/node_modules/@mastra/auth-workos/dist/index.js'
if output.exists():
    targets.append(output)

# Validate all targets before modifying any of them. Applying twice is harmless.
changes = []
for target in targets:
    data = target.read_bytes()
    text = data.decode()
    if text.count(new) == 1:
        restored = text.replace(new, old, 1).encode()
        if hashlib.sha256(restored).hexdigest() != original_hash:
            raise SystemExit(f'Unexpected already-patched content: {target}')
        print(f'Already patched: {target}')
        continue
    if hashlib.sha256(data).hexdigest() != original_hash or text.count(old) != 1:
        raise SystemExit(f'Unexpected package content: {target}')
    changes.append((target, text.replace(old, new, 1).encode()))
for target, data in changes:
    target.write_bytes(data)
    print(f'Patched {target}; sha256={hashlib.sha256(data).hexdigest()}')

# Julia keeps mirrored .claude skills for other clients. Factory's local skill
# resolver rejects their duplicate names; use our canonical .agents directory.
factory = app / 'node_modules/@mastra/factory'
if json.loads((factory / 'package.json').read_text())['version'] != '0.17.2':
    raise SystemExit('Unsupported Factory version: review the canonical skill-root patch')
skill_hash = '05dfd4656c6c58385fe2b03b561ef9bb432a9a5679658ef011eb36d5f7a6d5f2'
skill_old = '\t\t\t".claude/skills",\n\t\t\t".agents/skills"'
skill_new = '\t\t\t".agents/skills"'
skill_targets = [factory / 'dist/workspace.js']
skill_output = app / '.mastra/output/node_modules/@mastra/factory/dist/workspace.js'
if skill_output.exists():
    skill_targets.append(skill_output)
skill_changes = []
for target in skill_targets:
    data = target.read_bytes()
    text = data.decode()
    if skill_old not in text and text.count(skill_new) == 1:
        restored = text.replace(skill_new, skill_old, 1).encode()
        if hashlib.sha256(restored).hexdigest() != skill_hash:
            raise SystemExit(f'Unexpected already-patched skill source: {target}')
        print(f'Already patched skill roots: {target}')
        continue
    if hashlib.sha256(data).hexdigest() != skill_hash or text.count(skill_old) != 1:
        raise SystemExit(f'Unexpected skill source: {target}')
    skill_changes.append((target, text.replace(skill_old, skill_new, 1).encode()))
for target, data in skill_changes:
    target.write_bytes(data)
    print(f'Patched canonical skill roots: {target}')
