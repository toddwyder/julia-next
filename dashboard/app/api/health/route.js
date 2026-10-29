// Route Handler contract: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
// `dynamic = 'force-dynamic'`: node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md
import { checkHealth } from '../../../lib/health.js';

export const dynamic = 'force-dynamic';

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

export function renderHealthHtml(report) {
  const rows = report.checks.map(check => `<li class="${check.ok ? 'ok' : 'broken'}"><strong>${escape(check.name)}</strong> ${check.ok ? 'ok' : 'failed'}: ${escape(check.detail)}</li>`).join('\n');
  const files = report.files.length
    ? `<p class="broken">Failing files:</p><ul class="files">${report.files.map(file => `<li class="broken">${escape(file)}</li>`).join('')}</ul>`
    : '';
  const summary = report.status === 'ok'
    ? 'Linear answers, the state folder is writable and every run file parses.'
    : `Failing ${report.failing.length === 1 ? 'check' : 'checks'}: ${escape(report.failing.join(', '))}.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Julia dashboard health</title>
<style>
:root { color-scheme: light; --mint: #10b981; --rose: #be123c; --ink: #1e293b; --page: #f3f6f8; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font-family: 'Public Sans', system-ui, sans-serif; line-height: 1.6; }
main { max-width: 800px; margin: 0 auto; padding: 48px 24px 64px; }
h1 { font-size: clamp(1.8rem, 5vw, 2.5rem); line-height: 1.2; margin: 8px 0 16px; letter-spacing: -.035em; }
.eyebrow { color: #047857; font-size: .8rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; margin: 0; }
ul { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 12px; }
li { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; overflow-wrap: anywhere; }
.ok { border-left: 4px solid var(--mint); }
.broken { border-left: 4px solid var(--rose); background: #fff1f2; color: #9f1239; }
.files li { font-family: ui-monospace, monospace; font-size: .9rem; }
a { color: #4338ca; }
</style>
</head>
<body>
<main>
<p class="eyebrow">Julia dashboard</p>
<h1>Health: ${escape(report.status)}</h1>
<p>${summary}</p>
<ul class="checks">
${rows}
</ul>
${files}
<p>Checked at ${escape(report.checkedAt)}. <a href="/">Ready cards</a></p>
</main>
</body>
</html>
`;
}

export async function GET(request) {
  const report = await checkHealth();
  const status = report.status === 'ok' ? 200 : 503;
  const headers = { 'cache-control': 'no-store' };
  const accepts = request?.headers?.get?.('accept') ?? '';
  if (accepts.includes('text/html')) {
    return new Response(renderHealthHtml(report), { status, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
  }
  return Response.json(report, { status, headers });
}
