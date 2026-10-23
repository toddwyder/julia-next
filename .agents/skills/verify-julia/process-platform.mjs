import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

export function portOwners(port) {
  if (process.platform !== 'win32') {
    const output = execFileSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' });
    return [...new Set([...output.matchAll(/pid=(\d+)/g)].map(([, pid]) => Number(pid)))];
  }
  const output = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
  const owners = new Set();
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[0] !== 'TCP' || fields[3] !== 'LISTENING') continue;
    if (fields[1].endsWith(`:${port}`)) owners.add(Number(fields[4]));
  }
  return [...owners].filter(Number.isInteger);
}

export function processTree(rootPid) {
  if (process.platform !== 'win32') {
    const ticks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
    const boot = Number(readFileSync('/proc/stat', 'utf8').match(/^btime (\d+)$/m)[1]) * 1000;
    const rows = [];
    for (const name of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      try {
        const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ');
        const command = readFileSync(`/proc/${name}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
        if (command) rows.push({ ProcessId: Number(name), ParentProcessId: Number(fields[1]), CommandLine: command, Created: new Date(boot + Number(fields[19]) / ticks * 1000).toISOString() });
      } catch (error) {
        if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error;
      }
    }
    const ids = new Set([Number(rootPid)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) if (ids.has(row.ParentProcessId) && !ids.has(row.ProcessId)) { ids.add(row.ProcessId); changed = true; }
    }
    return { root: rows.find(row => row.ProcessId === Number(rootPid)) ?? null, tree: rows.filter(row => ids.has(row.ProcessId)) };
  }
  const script = [
    `$all=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate)`,
    `$rootRow=$all | Where-Object { $_.ProcessId -eq ${rootPid} } | Select-Object -First 1`,
    `$root=if($rootRow){[pscustomobject]@{ProcessId=$rootRow.ProcessId;CommandLine=$rootRow.CommandLine;Created=$rootRow.CreationDate.ToUniversalTime().ToString('o')}}else{$null}`,
    `$ids=[System.Collections.Generic.List[uint32]]::new(); [void]$ids.Add([uint32]${rootPid})`,
    `$changed=$true; while($changed){$changed=$false; foreach($p in $all){if($ids.Contains([uint32]$p.ParentProcessId) -and -not $ids.Contains([uint32]$p.ProcessId)){[void]$ids.Add([uint32]$p.ProcessId);$changed=$true}}}`,
    `$tree=@($all | Where-Object { $ids.Contains([uint32]$_.ProcessId) } | ForEach-Object { [pscustomobject]@{ProcessId=$_.ProcessId;CommandLine=$_.CommandLine;Created=$_.CreationDate.ToUniversalTime().ToString('o')} })`,
    `[pscustomobject]@{Root=$root;Tree=$tree} | ConvertTo-Json -Compress -Depth 4`,
  ].join('; ');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
  if (!output) return { root: null, tree: [] };
  const parsed = JSON.parse(output);
  return { root: parsed.Root ?? null, tree: Array.isArray(parsed.Tree) ? parsed.Tree : parsed.Tree ? [parsed.Tree] : [] };
}

export async function stopProcess(pid, tree = false) {
  if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'], { stdio: 'ignore' });
  else {
    try { process.kill(tree ? -Number(pid) : Number(pid), 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const deadline = Date.now() + 5000;
  while (processTree(pid).root && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  if (processTree(pid).root) throw new Error(`process ${pid} did not stop`);
}
