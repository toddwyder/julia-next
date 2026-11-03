import Link from 'next/link';

import { listRuns, shownStatus, stamp } from '../../lib/machine-runs.js';

export const dynamic = 'force-dynamic';

function summary(record, status) {
  const done = record.steps.filter(step => step.status === 'succeeded').length;
  const running = record.steps.find(step => step.status === 'running');
  if (status === 'stalled') return `silent since ${stamp(record.heartbeatAt ?? record.updatedAt)}`;
  if (running) return `${running.id} is running`;
  return `${done} of ${record.steps.length} stages finished`;
}

async function RunList() {
  const { dir, runs, listError } = await listRuns();
  if (listError) {
    return (
      <p className="problem" role="alert">
        The run store at {dir} could not be read: {listError}
      </p>
    );
  }
  if (runs.length === 0) {
    return (
      <p className="empty">
        No card run has been recorded yet. A run appears here as soon as the machine starts one, in {dir}.
      </p>
    );
  }
  const now = Date.now();
  return (
    <ul className="cards">
      {runs.map(record => {
        const status = shownStatus(record, now);
        return (
          <li className="card" key={record.id}>
            <div className="card-copy">
              <p className="identifier">{record.card}</p>
              <h2>
                <Link href={`/runs/${record.id}`}>{record.id}</Link>
              </h2>
              <p className="run-line">
                {summary(record, status)} · started {stamp(record.startedAt)}
              </p>
            </div>
            <span className={`pill ${status}`}>{status}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function RunsPage() {
  return (
    <>
      <header>
        <p className="eyebrow">The machine</p>
        <h1>Card runs</h1>
        <p>Every run of build, review and landing, as the machine records it.</p>
        <Link className="back" href="/">
          Ready cards
        </Link>
      </header>
      <RunList />
    </>
  );
}
