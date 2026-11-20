export const IN_USE_SPEC = {
  userUnits: new Map([
    ['julia-studio.service', 'Live Mastra Studio on :4111'],
    ['card-machine-studio.service', 'Card Machine Mastra Studio on :4112'],
    ['datasette-viewer.service', 'Datasette read-only viewer on :8801 opened by Todd'],
    ['julia-disk-check.timer', 'Daily server resource check alerting Todd on JUL-276'],
    ['julia-disk-check.service', 'Daily server resource check service'],
    ['dbus.service', 'Ubuntu user D-Bus session bus'],
    ['dbus.socket', 'Ubuntu user D-Bus socket'],
    ['gnome-keyring-daemon.service', 'Ubuntu user keyring daemon'],
    ['at-spi-dbus-bus.service', 'Ubuntu accessibility bus'],
    ['gpg-agent.service', 'Ubuntu GnuPG agent'],
    ['dirmngr.service', 'Ubuntu GnuPG certificate manager'],
    ['keyboxd.service', 'Ubuntu GnuPG keybox daemon'],
    ['pk-debconf-helper.service', 'Ubuntu debconf helper'],
    ['gcr-ssh-agent.service', 'Ubuntu GCR SSH agent'],
    ['snapd.session-agent.service', 'Ubuntu snapd session agent'],
    ['systemd-tmpfiles-clean.timer', 'Ubuntu daily user tmpfiles cleanup timer'],
    ['systemd-tmpfiles-clean.service', 'Ubuntu daily user tmpfiles cleanup service'],
    ['launchpadlib-cache-clean.timer', 'Ubuntu Launchpadlib cache cleanup timer'],
    ['launchpadlib-cache-clean.service', 'Ubuntu Launchpadlib cache cleanup service'],
  ]),
  systemUnits: new Map([
    ['julia-dashboard.service', 'Live Julia dashboard on :4313 opened by Todd'],
    ['julia-dashboard-update.timer', 'Updates julia-dashboard from main every 5 minutes'],
    ['julia-dashboard-update.service', 'Updates julia-dashboard from main'],
    ['julia-dashboard-watchdog.timer', 'Watches julia-dashboard /api/health every minute'],
    ['julia-dashboard-watchdog.service', 'Probes julia-dashboard /api/health'],
    ['julia-dashboard-sweep.timer', 'Sweeps model prices for the dashboard'],
    ['julia-dashboard-sweep.service', 'Sweeps model prices for the dashboard'],
    ['tailscaled.service', 'Tailscale network daemon'],
  ]),
  checkouts: new Map([
    ['/home/ubuntu/julia-builder', 'julia-studio.service WorkingDirectory'],
    ['/home/ubuntu/julia-flow-repo', 'julia-studio.service FLOW_REPO and julia-disk-check.service'],
    ['/home/ubuntu/julia-dashboard', 'julia-dashboard.service checkout (main worktree)'],
    ['/home/ubuntu/julia-mastra', 'Parent git repository for /home/ubuntu/julia-dashboard worktree'],
    ['/home/ubuntu/card-machine', 'card-machine-studio.service WorkingDirectory and FLOW_REPO'],
  ]),
  scratchFixed: new Map([
    ['cards', 'Container for active card worktrees (empty when no card is running)'],
    ['com.agilebits.op.1000', '1Password CLI daemon runtime socket for active services'],
    ['node-compile-cache', 'Node.js compile cache used by active services'],
  ]),
  flowStudioFixed: new Map([
    ['state.db', 'Studio workflow state database'],
    ['state.db-wal', 'Studio workflow state WAL'],
    ['state.db-shm', 'Studio workflow state SHM'],
    ['trace.duckdb', 'Studio observability trace database'],
    ['trace.duckdb.wal', 'Studio observability trace WAL'],
    ['build', 'Studio scratch subfolder'],
    ['landing', 'Studio scratch subfolder'],
    ['reports', 'Studio scratch subfolder'],
    ['retro', 'Studio scratch subfolder'],
  ]),
  mastracodeFixed: new Map([
    ['mastra.db', 'Datasette read-only viewer database (datasette-viewer.service)'],
    ['mastra.db-wal', 'Datasette database WAL'],
    ['mastra.db-shm', 'Datasette database SHM'],
    ['settings.json', 'Mastra Code configuration'],
    ['auth.json', 'Mastra Code provider credentials'],
    ['observability.duckdb', 'Mastra Code observability store'],
    ['observability.duckdb.tmp', 'Mastra Code observability temp dir'],
    ['locks', 'Mastra Code lock directory'],
    ['patches', 'Mastra Code patch directory'],
  ]),
  homeDisallowed: new Set(['dist', '%ln']),
  maxIdleTraceMb: 500,
};

function classifyProcess(proc, activeCards) {
  const cmd = proc.cmd ?? '';
  if (proc.isSelfOrAncestor) {
    return { allowed: true, usedBy: 'Current inspection/cleanup process chain' };
  }
  if (proc.serviceUnit && (IN_USE_SPEC.userUnits.has(proc.serviceUnit) || IN_USE_SPEC.systemUnits.has(proc.serviceUnit))) {
    return { allowed: true, usedBy: proc.serviceUnit };
  }
  if (/^\/usr\/lib\/systemd\/systemd --user\b/.test(cmd) || /^\(sd-pam\)$/.test(cmd)) {
    return { allowed: true, usedBy: 'Ubuntu user systemd session' };
  }
  if (/^\/usr\/bin\/dbus-daemon --session\b/.test(cmd) || /gnome-keyring-daemon|at-spi-bus-launcher|at-spi2-registryd/.test(cmd)) {
    return { allowed: true, usedBy: 'Ubuntu user session infrastructure' };
  }
  if (/^sshd: ubuntu@/.test(cmd) || /check-server-in-use/.test(cmd) || /^(?:-?bash|ps -u ubuntu|python3 -)(?:\s|$)/.test(cmd)) {
    if (!/for id in JUL-/.test(cmd)) {
      return { allowed: true, usedBy: 'Current SSH inspection session' };
    }
  }
  if (/\bop daemon\b/.test(cmd) && proc.inUseOpDaemon) {
    return { allowed: true, usedBy: '1Password daemon for active Studio/dashboard services' };
  }
  if (activeCards.length > 0 && activeCards.some(card => cmd.includes(card))) {
    return { allowed: true, usedBy: `Active Studio card (${activeCards.join(', ')})` };
  }
  return { allowed: false, usedBy: null };
}

export function evaluateServerState(snapshot) {
  const studioReachable = snapshot.studioReachable !== false;
  const studioError = snapshot.studioError ?? null;
  const activeCards = [...new Set(snapshot.activeCards ?? [])].sort();
  const activeSet = new Set(activeCards);
  const kept = [];
  const leftovers = [];

  for (const unit of snapshot.userUnits ?? []) {
    const failed = unit.active === 'failed' || unit.sub === 'failed';
    const allowedReason = IN_USE_SPEC.userUnits.get(unit.name);
    if (allowedReason && !failed) {
      kept.push({ kind: 'user-unit', name: unit.name, rssMb: 0, diskMb: 0, usedBy: allowedReason });
    } else if (unit.active === 'active' || unit.sub === 'running' || unit.sub === 'waiting' || failed || unit.name.startsWith('julia-') || unit.name.startsWith('jul')) {
      leftovers.push({ kind: 'user-unit', name: unit.name, rssMb: 0, diskMb: 0, reason: failed ? 'Failed transient/user unit' : 'Not in active user unit allowlist' });
    }
  }

  for (const unit of snapshot.systemUnits ?? []) {
    const allowedReason = IN_USE_SPEC.systemUnits.get(unit.name);
    if (allowedReason) {
      kept.push({ kind: 'system-unit', name: unit.name, rssMb: 0, diskMb: 0, usedBy: allowedReason });
    } else if (unit.name.startsWith('julia-') || unit.name.startsWith('jul') || unit.name.includes('mastra')) {
      leftovers.push({ kind: 'system-unit', name: unit.name, rssMb: 0, diskMb: 0, reason: 'Not in active system unit allowlist' });
    }
  }

  for (const proc of snapshot.processes ?? []) {
    const rssMb = Math.round(((proc.rssKb ?? 0) / 1024) * 10) / 10;
    const verdict = classifyProcess(proc, activeCards);
    if (verdict.allowed) {
      kept.push({ kind: 'process', name: `${proc.pid} ${proc.cmd}`, pid: proc.pid, rssMb, diskMb: 0, usedBy: verdict.usedBy });
    } else if (!studioReachable) {
      kept.push({ kind: 'process', name: `${proc.pid} ${proc.cmd}`, pid: proc.pid, rssMb, diskMb: 0, usedBy: 'Studio unreachable; preserving potential card process' });
    } else {
      leftovers.push({ kind: 'process', name: `${proc.pid} ${proc.cmd}`, pid: proc.pid, rssMb, diskMb: 0, reason: 'Orphaned or non-service process' });
    }
  }

  for (const checkout of snapshot.checkouts ?? []) {
    const allowedReason = IN_USE_SPEC.checkouts.get(checkout.path);
    if (allowedReason) {
      kept.push({ kind: 'checkout', name: checkout.path, rssMb: 0, diskMb: checkout.diskMb ?? 0, usedBy: allowedReason });
    } else {
      leftovers.push({ kind: 'checkout', name: checkout.path, rssMb: 0, diskMb: checkout.diskMb ?? 0, reason: 'Extra checkout outside in-use list' });
    }
  }

  for (const wt of snapshot.worktrees ?? []) {
    const isDashboard = wt.path === '/home/ubuntu/julia-dashboard';
    const isMainRepo = IN_USE_SPEC.checkouts.has(wt.path);
    const cardMatch = wt.path.match(/\/\.local\/state\/julia-scratch\/cards\/([^/]+)$/);
    const isActiveCard = cardMatch && (activeSet.has(cardMatch[1]) || !studioReachable);
    if (isDashboard || isMainRepo || isActiveCard) {
      kept.push({
        kind: 'worktree',
        name: wt.path,
        rssMb: 0,
        diskMb: wt.diskMb ?? 0,
        usedBy: isActiveCard
          ? (studioReachable ? `Active Studio card ${cardMatch[1]}` : `Studio unreachable; preserving card worktree ${cardMatch[1]}`)
          : (IN_USE_SPEC.checkouts.get(wt.path) ?? 'Registered main checkout'),
      });
    } else {
      leftovers.push({ kind: 'worktree', name: wt.path, rssMb: 0, diskMb: wt.diskMb ?? 0, reason: 'Leftover git worktree not tied to an active card' });
    }
  }

  for (const entry of snapshot.scratchEntries ?? []) {
    const allowedReason = IN_USE_SPEC.scratchFixed.get(entry.name);
    if (allowedReason) {
      kept.push({ kind: 'scratch', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, usedBy: allowedReason });
    } else {
      leftovers.push({ kind: 'scratch', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, reason: 'Leftover scratch file or directory' });
    }
  }

  for (const cardEntry of snapshot.scratchCards ?? []) {
    if (activeSet.has(cardEntry.name) || !studioReachable) {
      kept.push({
        kind: 'scratch-card',
        name: cardEntry.path,
        rssMb: 0,
        diskMb: cardEntry.diskMb ?? 0,
        usedBy: studioReachable ? `Active Studio card ${cardEntry.name}` : `Studio unreachable; preserving card copy ${cardEntry.name}`,
      });
    } else {
      leftovers.push({ kind: 'scratch-card', name: cardEntry.path, rssMb: 0, diskMb: cardEntry.diskMb ?? 0, reason: 'Inactive, finished, paused, or abandoned card copy' });
    }
  }

  for (const entry of snapshot.builderArtifacts ?? []) {
    leftovers.push({ kind: 'builder-artifact', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, reason: 'Stale artifact in julia-builder/.artifacts (Studio uses FLOW_REPO)' });
  }

  for (const entry of snapshot.flowStudioEntries ?? []) {
    const allowedReason = IN_USE_SPEC.flowStudioFixed.get(entry.name);
    if (allowedReason) {
      if (entry.name === 'trace.duckdb' && studioReachable && activeCards.length === 0 && (entry.diskMb ?? 0) > IN_USE_SPEC.maxIdleTraceMb) {
        leftovers.push({ kind: 'trace-db', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, reason: `Idle trace.duckdb exceeds ${IN_USE_SPEC.maxIdleTraceMb} MB` });
      } else {
        kept.push({ kind: 'flow-studio', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, usedBy: allowedReason });
      }
    } else if (activeSet.has(entry.name) || !studioReachable) {
      kept.push({
        kind: 'flow-studio-card',
        name: entry.path,
        rssMb: 0,
        diskMb: entry.diskMb ?? 0,
        usedBy: studioReachable ? `Active Studio card ${entry.name}` : `Studio unreachable; preserving Studio card folder ${entry.name}`,
      });
    } else {
      leftovers.push({ kind: 'flow-studio-card', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, reason: 'Finished or abandoned Studio card run folder' });
    }
  }

  for (const entry of snapshot.mastracodeEntries ?? []) {
    const allowedReason = IN_USE_SPEC.mastracodeFixed.get(entry.name);
    if (allowedReason) {
      kept.push({ kind: 'mastracode', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, usedBy: allowedReason });
    } else {
      leftovers.push({ kind: 'mastracode', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, reason: 'Unused Mastra Code trace, backup, or vector database' });
    }
  }

  for (const entry of snapshot.homeExtras ?? []) {
    if (IN_USE_SPEC.homeDisallowed.has(entry.name)) {
      leftovers.push({ kind: 'home-extra', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, reason: 'Stray build or scratch output in /home/ubuntu' });
    }
  }

  const sum = (items, key) => Math.round(items.reduce((acc, item) => acc + (item[key] ?? 0), 0) * 10) / 10;
  return {
    ok: leftovers.length === 0 && studioReachable,
    studioReachable,
    studioError,
    activeCards,
    kept,
    leftovers,
    summary: {
      keptRssMb: sum(kept, 'rssMb'),
      keptDiskMb: sum(kept, 'diskMb'),
      leftoverRssMb: sum(leftovers, 'rssMb'),
      leftoverDiskMb: sum(leftovers, 'diskMb'),
    },
  };
}

export function formatReport(evaluation) {
  const activeLabel = evaluation.studioReachable === false
    ? `unknown (Studio unreachable${evaluation.studioError ? `: ${evaluation.studioError}` : ''}; preserving card work)`
    : (evaluation.activeCards.length > 0 ? evaluation.activeCards.join(', ') : 'none');
  const lines = [
    `Server in-use check: ${evaluation.ok ? 'PASS' : 'FAIL'} (active cards: ${activeLabel})`,
    `Kept: ${evaluation.kept.length} items (${evaluation.summary.keptRssMb} MB RSS, ${evaluation.summary.keptDiskMb} MB disk)`,
    `Leftovers: ${evaluation.leftovers.length} items (${evaluation.summary.leftoverRssMb} MB RSS, ${evaluation.summary.leftoverDiskMb} MB disk)`,
  ];
  if (evaluation.leftovers.length > 0) {
    lines.push('', 'Leftovers (not in use):');
    for (const item of evaluation.leftovers) {
      lines.push(`- [${item.kind}] ${item.name} (${item.rssMb} MB RSS, ${item.diskMb} MB disk): ${item.reason}`);
    }
  }
  return lines.join('\n');
}
