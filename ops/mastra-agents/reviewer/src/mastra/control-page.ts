import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { agentError } from './agent-errors.ts'

import {
  ControlPageStateSchema,
  InitializationActivitySchema,
  InitializationBoundaryStateSchema,
  InitializationResultSchema,
  InitializationRunsStateSchema,
  StartInitializationSchema,
  AgentDashboardStateSchema,
} from './contracts.ts'
import type { z } from 'zod/v4'

type ControlPageState = z.infer<typeof ControlPageStateSchema>
type StartInitialization = z.infer<typeof StartInitializationSchema>
type InitializationResult = z.infer<typeof InitializationResultSchema>
type InitializationRunsState = z.infer<typeof InitializationRunsStateSchema>
type InitializationActivity = z.infer<typeof InitializationActivitySchema>

const CONTROL_PATH = '/julia-control'

const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost):\d+$/

// Tailscale Serve terminates TLS for this server's tailnet DNS name and proxies the
// request to the loopback listener, so a request that reaches this loopback-bound
// server with the server's own tailnet name as its Host came through Serve. The name
// is configured by the operator who sets Serve up (JUL-242); it is not guessed here.
function hostName(hostHeader: string) {
  return hostHeader.trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '')
}

export function isAllowedControlHost(hostHeader: string, tailscaleHosts: readonly string[]) {
  if (LOOPBACK_HOST.test(hostHeader.trim().toLowerCase())) return true
  const name = hostName(hostHeader)
  if (!name) return false
  return tailscaleHosts.some(allowed => hostName(allowed) === name)
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 1024 * 1024) throw new Error('request body is too large')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function initializationPageHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Julia · Initialize</title>
<style>
:root{font-family:ui-sans-serif,system-ui,sans-serif;color:#211b16;background:#f4efe7}body{margin:0;padding:2rem}main{max-width:58rem;margin:auto;background:#fffaf2;border:1px solid #d9cdbc;border-radius:18px;padding:2rem;box-shadow:0 18px 48px #4a38201f}h1{margin-top:0}p{line-height:1.5}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}fieldset{border:1px solid #d9cdbc;border-radius:12px;padding:1rem}label{display:block;font-weight:650;margin:.75rem 0 .3rem}select{width:100%;padding:.65rem;border:1px solid #9f907d;border-radius:8px;background:white}button{padding:.72rem 1.1rem;border-radius:9px;border:1px solid #6f5c46;font-weight:700;cursor:pointer}.actions{display:flex;gap:.75rem;margin-top:1.25rem}.start{background:#355c43;color:white}.cancel{background:transparent}.status{padding:1rem;border-radius:10px;background:#edf4ee}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:700px){.grid{grid-template-columns:1fr}body{padding:.75rem}main{padding:1.2rem}}
</style></head><body><main id="app"><h1>Initialize a Ready card</h1><p>Loading real Ready cards and current model choices…</p></main>
<script>
const app=document.querySelector('#app');
const roleLabels={builder:'Builder',reviewer:'Reviewer',crashFixer:'Crash fixer',crashReviewer:'Crash reviewer'};
const apiPath='${CONTROL_PATH}/api';
const optionKey=offer=>offer.route+'::'+offer.modelId;
function selectionFor(offer,effort){const value={route:offer.route,modelId:offer.modelId,company:offer.company,service:offer.service,effort};if(offer.wire)value.wire=offer.wire;return value}
function render(state){
  app.textContent='';const title=document.createElement('h1');title.textContent='Initialize a Ready card';app.append(title);
  const note=document.createElement('p');note.textContent='Choose the exact route, model, and advertised effort for every role. Start creates only a durable ready-for-build run.';app.append(note);
  const form=document.createElement('form');
  const cardLabel=document.createElement('label');cardLabel.textContent='Ready card';const cardSelect=document.createElement('select');cardSelect.name='card';
  state.cards.forEach((entry,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=entry.card.identifier+' — '+entry.card.title+(entry.admitted?'':' (cannot start)');cardSelect.append(option)});cardLabel.append(cardSelect);form.append(cardLabel);
  const cardNote=document.createElement('p');cardNote.className='status';cardNote.hidden=true;form.append(cardNote);
  const grid=document.createElement('div');grid.className='grid';const controls={};
  Object.entries(roleLabels).forEach(([role,label])=>{const field=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent=label;field.append(legend);
    const modelLabel=document.createElement('label');modelLabel.textContent='Route and model';const model=document.createElement('select');state.offers.forEach(offer=>{const option=document.createElement('option');option.value=optionKey(offer);option.textContent=offer.service+' · '+offer.name+' ('+offer.company+')';model.append(option)});modelLabel.append(model);field.append(modelLabel);
    const effortLabel=document.createElement('label');effortLabel.textContent='Effort';const effort=document.createElement('select');effortLabel.append(effort);field.append(effortLabel);
    const syncEfforts=()=>{const offer=state.offers.find(item=>optionKey(item)===model.value);effort.textContent='';offer.supportedEfforts.forEach(value=>{const option=document.createElement('option');option.value=value;option.textContent=value;effort.append(option)});effort.value=offer.supportedEfforts.includes('medium')?'medium':offer.supportedEfforts[0]};model.addEventListener('change',syncEfforts);syncEfforts();controls[role]={model,effort};grid.append(field)});
  form.append(grid);const actions=document.createElement('div');actions.className='actions';const start=document.createElement('button');start.type='submit';start.className='start';start.textContent='Start';const cancel=document.createElement('button');cancel.type='button';cancel.className='cancel';cancel.textContent='Cancel';actions.append(start,cancel);form.append(actions);app.append(form);
  const syncCard=()=>{const entry=state.cards[Number(cardSelect.value)];const blocked=!entry||!entry.admitted;cardNote.hidden=!blocked;cardNote.textContent=blocked?(entry?entry.card.reason:'Select a Ready card.'):'';start.disabled=blocked};
  cardSelect.addEventListener('change',syncCard);syncCard();
  cancel.addEventListener('click',()=>{form.remove();const closed=document.createElement('p');closed.className='status';closed.textContent='Initialization closed. Nothing was sent or saved.';app.append(closed)});
  form.addEventListener('submit',async event=>{event.preventDefault();const entry=state.cards[Number(cardSelect.value)];if(!entry||!entry.admitted){syncCard();return}start.disabled=true;const roles={};for(const [role,control] of Object.entries(controls)){const offer=state.offers.find(item=>optionKey(item)===control.model.value);roles[role]=selectionFor(offer,control.effort.value)}
    try{const response=await fetch(apiPath+'/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card:entry.card,roles})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Start failed');form.remove();const done=document.createElement('div');done.className='status';done.innerHTML='<strong>Ready for build</strong><pre></pre>';done.querySelector('pre').textContent=JSON.stringify(body,null,2);app.append(done)}catch(error){start.disabled=false;const message=document.createElement('p');message.className='status';message.textContent=error.message;form.append(message)}})
}
fetch(apiPath+'/state').then(response=>response.json().then(body=>{if(!response.ok)throw new Error(body.error||'Discovery failed');return body})).then(render).catch(error=>{app.textContent='';const h=document.createElement('h1');h.textContent='Initialize a Ready card';const p=document.createElement('p');p.className='status';p.textContent=error.message;app.append(h,p)});
</script></body></html>`
}

export function controlPageHtml() {
  const dashboardStyles = `.dashboard{margin-bottom:24px}.dashboard-header{margin-bottom:16px}.eyebrow,.muted{color:#5e5b53}.eyebrow{font-size:13px;letter-spacing:.02em}.dashboard h1{margin:4px 0 6px;font-size:26px}.agent-card{background:#fff;border:1px solid #e2e0d8;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:14px;margin-top:16px}.card-head h2{overflow-wrap:anywhere}.card-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.agent-card h2,.agent-card h3{margin:0}.agent-card h2{font-size:18px}.agent-card h3{font-size:15px}.phase{border-radius:999px;padding:4px 10px;font-size:13px;background:#e6ecfa;color:#1f3f99;white-space:nowrap}.agent-status{border-radius:8px;padding:10px 12px;font-size:14px}.agent-status.working{background:#eef2fc;color:#1f3f99}.agent-status.stopped{background:#fcefe3;color:#8a3d05;font-weight:500}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}.fact-label{font-size:12px;color:#5e5b53}.fact-value{font-size:14px;overflow-wrap:anywhere}.activity{border-top:1px solid #eceae3;padding-top:12px}.activity-list{display:grid;grid-template-columns:56px minmax(0,1fr);gap:8px 10px;font-size:14px;margin-top:8px}.activity-empty{grid-column:1/-1}.activity-time{white-space:nowrap;font-family:ui-monospace,monospace;font-size:13px;color:#5e5b53}`
  const dashboardTelemetryStyles = `.context-head{display:flex;justify-content:space-between;gap:8px;font-size:13px;flex-wrap:wrap}.context-track{height:8px;background:#eceae3;border-radius:999px;overflow:hidden;margin-top:6px}.context-fill{height:8px;background:#2f5bd3;border-radius:999px}.telemetry-events{font-size:13px;color:#5e5b53;margin-top:6px}.agent-checklist{border-top:1px solid #eceae3;padding-top:12px;display:flex;flex-direction:column;gap:8px}.checklist-note{font-size:12px;color:#5e5b53}.checklist-step{font-size:14px;overflow-wrap:anywhere}.checklist-step.pending{color:#5e5b53}.checklist-step.inProgress{font-weight:500}`
  const dashboardScript = `<script>
const dashboard=document.querySelector('#agent-cards');
const clock=iso=>{const date=new Date(iso);return (date.getHours()%12||12)+':'+String(date.getMinutes()).padStart(2,'0')};
const expandedActions=new Set();
function appendTelemetry(article,card){
const t=card.telemetry;const context=document.createElement('section');context.className='agent-context';
const head=document.createElement('div');head.className='context-head';const label=document.createElement('span');label.textContent=t.context?'Context '+t.context.percent+'% full':'Context unavailable';head.append(label);
const compactions=document.createElement('span');compactions.className='muted';compactions.textContent=t.compactions===null?'Compactions: unavailable':t.compactions.length?t.compactions.length+' compaction'+(t.compactions.length===1?'':'s')+', '+clock(t.compactions.at(-1).occurredAt):'No compactions';head.append(compactions);context.append(head);
const track=document.createElement('div');track.className='context-track';track.setAttribute('role','progressbar');track.setAttribute('aria-label','Context fullness');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');
if(t.context){track.setAttribute('aria-valuenow',String(t.context.percent));track.title=t.context.usedTokens+' tokens / '+t.context.windowTokens+' context window (last model exchange)';const fill=document.createElement('div');fill.className='context-fill';fill.style.width=t.context.percent+'%';track.append(fill)}else{track.setAttribute('aria-valuetext','unavailable')}context.append(track);
const handoffs=document.createElement('div');handoffs.className='telemetry-events';handoffs.textContent='Handoffs: '+(t.handoffs===null?'unavailable':t.handoffs);context.append(handoffs);article.append(context);
const checklist=document.createElement('section');checklist.className='agent-checklist';if(t.checklist===null){checklist.textContent='Checklist: unavailable'}else if(!t.checklist.length){checklist.textContent="No checklist: the agent didn't make one this time."}else{const title=document.createElement('h3');title.textContent="The agent's own checklist";const note=document.createElement('div');note.className='checklist-note';note.textContent='Written by the agent. Check it against what it actually did, below.';checklist.append(title,note);t.checklist.forEach(item=>{const row=document.createElement('div');row.className='checklist-step '+item.status;row.textContent=(item.status==='completed'?'✓ ':'□ ')+item.step+(item.status==='inProgress'?' (working on)':'');checklist.append(row)})}article.append(checklist)
}
function renderAgents(state){document.querySelector('#agent-updated').textContent='Updated '+clock(state.updatedAt);dashboard.textContent='';if(!state.cards.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No agents are running.';dashboard.append(empty);return}state.cards.forEach(card=>{const article=document.createElement('article');article.className='agent-card';const head=document.createElement('div');head.className='card-head';const identity=document.createElement('div');identity.innerHTML='<div class="eyebrow"></div><h2></h2>';identity.querySelector('.eyebrow').textContent=card.cardIdentifier;identity.querySelector('h2').textContent=card.cardTitle;const phase=document.createElement('span');phase.className='phase';phase.textContent=card.stage+' · round '+card.round;head.append(identity,phase);article.append(head);const status=document.createElement('div');status.className='agent-status '+card.status;status.textContent=card.statusDetail;article.append(status);const facts=document.createElement('div');facts.className='facts';[['Agent and model',card.role+' · '+card.model+' ('+card.service+')'],['Source',card.source],['Started',clock(card.startedAt)],['Last record',clock(card.updatedAt)]].forEach(([label,value])=>{const fact=document.createElement('div');fact.innerHTML='<div class="fact-label"></div><div class="fact-value"></div>';fact.querySelector('.fact-label').textContent=label;fact.querySelector('.fact-value').textContent=value;facts.append(fact)});article.append(facts);appendTelemetry(article,card);const activity=document.createElement('div');activity.className='activity';activity.innerHTML="<h3>What it actually did</h3><div class='muted' style='font-size:12px'>From the tools' own records. Newest first.</div>";const list=document.createElement('div');list.className='activity-list';card.actions.slice(0,expandedActions.has(card.agentId)?undefined:10).forEach(action=>{const time=document.createElement('span');time.className='activity-time';time.textContent=clock(action.occurredAt);const label=document.createElement('span');label.textContent=action.label+' · ';const outcome=document.createElement('span');outcome.textContent=action.outcome==='succeeded'?'Succeeded':action.outcome==='failed'?'Failed':action.phase==='running'?'In progress':'Outcome unknown';label.append(outcome);list.append(time,label)});if(!card.actions.length){const none=document.createElement('span');none.className='muted activity-empty';none.textContent='No detailed actions recorded yet.';list.append(none)}activity.append(list);if(card.actions.length>10){const show=document.createElement('button');show.type='button';show.textContent=expandedActions.has(card.agentId)?'Show fewer actions':'Show all '+card.actions.length+' actions';show.addEventListener('click',()=>{if(expandedActions.has(card.agentId))expandedActions.delete(card.agentId);else expandedActions.add(card.agentId);renderAgents(state)});activity.append(show)}article.append(activity);const source=document.createElement('div');source.className='muted';source.style.fontSize='12px';source.textContent='Source: '+card.source+' lifecycle events';article.append(source);dashboard.append(article)})}
function loadAgents(){return fetch('${CONTROL_PATH}/api/agents').then(response=>response.json().then(body=>{if(!response.ok)throw new Error(body.error||'Agent discovery failed');return body})).then(renderAgents).catch(error=>{dashboard.textContent='';const p=document.createElement('p');p.className='status';p.textContent=error.message;dashboard.append(p)})}
loadAgents();setInterval(loadAgents,30000);
</script>`
  return initializationPageHtml()
    .replace('</style>', `${dashboardStyles}${dashboardTelemetryStyles}</style>`)
    .replace('<body><main id="app">', `<body><main><section class="dashboard"><header class="dashboard-header"><div class="eyebrow">Julia control</div><h1>What's running now</h1><p class="muted">Julia-monitored agent runs</p><div id="agent-updated" class="muted">Loading agent records…</div></header><div id="agent-cards"></div></section><section id="app">`)
    .replace('</main>\n<script>', '</section></main>\n<script>')
    .replace('</body></html>', `${dashboardScript}</body></html>`)
}

export async function startControlPageServer({
  port = 43123,
  tailscaleHosts = [],
  getState,
  startInitialization,
  getRuns,
  getActivity,
  getAgentCards = async () => ({ updatedAt: new Date().toISOString(), cards: [] }),
  onRequest = () => {},
}: {
  port?: number
  tailscaleHosts?: readonly string[]
  getState: () => Promise<ControlPageState>
  startInitialization: (input: StartInitialization) => Promise<InitializationResult>
  getRuns: () => Promise<InitializationRunsState>
  getActivity: () => InitializationActivity
  getAgentCards?: () => Promise<unknown>
  onRequest?: (request: { method: string; path: string }) => void
}) {
  const server = createServer(async (request, response) => {
    const method = request.method ?? 'GET'
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    onRequest({ method, path: url.pathname })
    const host = request.headers.host ?? ''
    if (!isAllowedControlHost(host, tailscaleHosts)) return sendJson(response, 403, { error: "Host must be loopback or this server's Tailscale Serve name" })
    try {
      if (method === 'GET' && (url.pathname === CONTROL_PATH || url.pathname === `${CONTROL_PATH}/`)) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        return response.end(controlPageHtml())
      }
      if (method === 'GET' && url.pathname === '/favicon.ico') {
        response.writeHead(204, { 'Cache-Control': 'public, max-age=86400' })
        return response.end()
      }
      if (method === 'GET' && url.pathname === `${CONTROL_PATH}/api/state`) {
        return sendJson(response, 200, ControlPageStateSchema.parse(await getState()))
      }
      if (method === 'GET' && url.pathname === `${CONTROL_PATH}/api/runs`) {
        return sendJson(response, 200, InitializationBoundaryStateSchema.parse({
          ...await getRuns(),
          activity: getActivity(),
        }))
      }
      if (method === 'GET' && url.pathname === `${CONTROL_PATH}/api/agents`) {
        return sendJson(response, 200, AgentDashboardStateSchema.parse(await getAgentCards()))
      }
      if (method === 'POST' && url.pathname === `${CONTROL_PATH}/api/start`) {
        return sendJson(response, 200, InitializationResultSchema.parse(await startInitialization(StartInitializationSchema.parse(await readJson(request)))))
      }
      return sendJson(response, 404, { error: 'not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(JSON.stringify({ event: 'control-page-request-failed', ...agentError(error, { provider: 'julia-control', runId: 'request', eventKind: `${method} ${url.pathname}` }) }))
      return sendJson(response, 400, { error: message })
    }
  })
  server.on('error', error => console.log(JSON.stringify({ event: 'control-page-server-failed', error: error.message })))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('control page did not bind a TCP listener')
  const url = `http://127.0.0.1:${address.port}${CONTROL_PATH}`
  return {
    url,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}
