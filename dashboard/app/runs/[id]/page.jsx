import Link from 'next/link';
import { notFound } from 'next/navigation';

import { readRun, shownStatus, stamp, usageCells } from '../../../lib/machine-runs.js';

export const dynamic = 'force-dynamic';

function Step({ step }) {
  const cells = usageCells(step);
  return (
    <tr>
      <td>{step.id}</td>
      <td>
        <span className={`pill ${step.status}`}>{step.status}</span>
      </td>
      <td>{step.startedAt ? stamp(step.startedAt) : 'not started'}</td>
      <td>{step.endedAt ? stamp(step.endedAt) : 'not ended'}</td>
      <td>{cells.elapsed}</td>
      <td>{cells.tokens}</td>
      <td>{cells.cost}</td>
      <td>
        {step.detail ?? ''}
        {cells.warning ? <span className="warning">{cells.warning}</span> : null}
      </td>
    </tr>
  );
}

function totals(steps) {
  const ran = steps.filter(step => step.usage && !step.usage.empty);
  if (ran.length === 0) return null;
  const cost = ran.reduce((sum, step) => sum + (Number(step.usage.costUsd) || 0), 0);
  const tokens = ran.reduce((sum, step) => sum + (Number(step.usage.inputTokens) || 0) + (Number(step.usage.outputTokens) || 0), 0);
  const calls = ran.reduce((sum, step) => sum + (Number(step.usage.modelCalls) || 0), 0);
  const everyModel = ran.flatMap(step => step.usage.models ?? []);
  const free = everyModel.length > 0 && everyModel.every(model => /:free$/i.test(String(model)));
  const costLabel = cost > 0 ? `$${cost.toFixed(cost < 0.01 ? 4 : 2)}` : free ? 'free model' : 'cost unknown';
  return `${calls} model ${calls === 1 ? 'call' : 'calls'} · ${tokens} tokens · ${costLabel}`;
}

export default async function RunPage({ params }) {
  const { id } = await params;
  const record = await readRun(id);
  if (!record) notFound();
  const status = shownStatus(record);
  const total = totals(record.steps);
  const flagged = record.steps.filter(step => usageCells(step).warning);
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
        {total ? <p className="run-line">{total}</p> : null}
        {record.pingedAt ? <p className="run-line">Todd was told once, at {stamp(record.pingedAt)}.</p> : null}
        <Link className="back" href="/runs">
          All runs
        </Link>
      </header>
      {flagged.length ? (
        <p className="problem" role="alert">
          {flagged.length === 1 ? 'One stage ran' : `${flagged.length} stages ran`} but recorded no model rows in its
          trace file, so this page cannot say what it spent.
        </p>
      ) : null}
      <table className="steps">
        <thead>
          <tr>
            <th scope="col">Stage</th>
            <th scope="col">Status</th>
            <th scope="col">Started</th>
            <th scope="col">Ended</th>
            <th scope="col">Elapsed</th>
            <th scope="col">Tokens</th>
            <th scope="col">Cost</th>
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
