"""The two graph seats, chosen from Linear labels and backup lines (JUL-130)."""

import re

ROLES = {'builder': 'builder', 'reviewer': 'adversary'}
SETTINGS_LABEL = 'graph-settings'


def label_for(labels: list[str], role: str, effort: bool = False) -> str | None:
    prefix = f'{ROLES[role]}-effort-' if effort else f'{ROLES[role]}-'
    return next((name for name in labels if name.startswith(prefix) and
                 (not effort or name in (prefix + 'low', prefix + 'medium', prefix + 'high')) and
                 (effort or not name.startswith(f'{ROLES[role]}-effort-'))), None)


def backups(description: str, role: str) -> list[str]:
    match = re.search(rf'^{role} backups:\s*(.*)$', description, re.I | re.M)
    return [item.strip() for item in match.group(1).split(',') if item.strip()] if match else []


def effective(settings: dict, card: dict) -> dict:
    """A card's explicit labels or backup line take precedence over Settings."""
    choices = {}
    for role in ROLES:
        model = label_for(card['labels'], role) or label_for(settings['labels'], role)
        effort = label_for(card['labels'], role, True) or label_for(settings['labels'], role, True)
        choices[role] = {'model': model, 'effort': effort.rsplit('-', 1)[-1] if effort else 'medium',
                         'backups': backups(card['description'], role) if re.search(
                             rf'^{role} backups:', card['description'], re.I | re.M) else backups(settings['description'], role)}
    return choices


def quota(reason: str | None) -> bool:
    return bool(reason and re.search(r'\b(quota|rate[ -]?limit|usage[ -]?limit)\b', reason, re.I))


def next_pair(choices: dict, current: dict, exhausted: dict, role: str, resolve) -> dict | None:
    """Try the role's ordered backups, then the partner's ordered backups for a legal pair."""
    other = 'reviewer' if role == 'builder' else 'builder'
    for candidate in choices[role]['backups']:
        if candidate in exhausted[role]:
            continue
        for partner in [current[other], *choices[other]['backups']]:
            if partner in exhausted[other]:
                continue
            labels = {role: candidate, other: partner}
            try:
                return resolve(labels['builder'], labels['reviewer'])
            except ValueError:
                continue  # unsupported model or same maker
    return None
