import Link from 'next/link';
import { notFound } from 'next/navigation';

import { readRun, shownStatus, stamp } from '../../../lib/machine-runs.js';

export const dynamic = 'force-dynamic';

function Step({ step }) {
  return (
    <tr>
      <td>{step.id}</td>
      <td>
        <span className={`pill ${step.status}`}>{step.status}</span>
      </td>
      <td>{step.startedAt ? stamp(step.startedAt) : 'not started'}</td>
      <td>{step.endedAt ? stamp(step.endedAt) : 'not ended'}</td>
      <td>{step.detail ?? ''}</td>
    </tr>
  );
}

export default async function RunPage({ params }) {
  const { id } = await params;
  const record = await readRun(id);
  if (!record) notFound();
  const status = shownStatus(record);
  return (
    <>
      <header>
        <p className="eyebrow">{record.card}</p>
        <h1>Run {record.id}</h1>
        <p className="run-line">
          <span className={`pill ${status}`}>{status}</span> started {stamp(record.startedAt)}
          {record.endedAt ? ` · finished ${stamp(record.endedAt)}` : ''}
          {record.pr ? ` · pull request #${record.pr}` : ''}
        </p>
        {record.detail ? <p>{record.detail}</p> : null}
        <Link className="back" href="/runs">
          All runs
        </Link>
      </header>
      <table className="steps">
        <thead>
          <tr>
            <th scope="col">Stage</th>
            <th scope="col">Status</th>
            <th scope="col">Started</th>
            <th scope="col">Ended</th>
            <th scope="col">What happened</th>
          </tr>
        </thead>
        <tbody>
          {record.steps.map(step => (
            <Step key={step.id} step={step} />
          ))}
        </tbody>
      </table>
      <p className="run-line">
        {status === 'running' || status === 'stalled' ? `Last heard from ${stamp(record.heartbeatAt ?? record.updatedAt)}.` : null}
      </p>
    </>
  );
}
