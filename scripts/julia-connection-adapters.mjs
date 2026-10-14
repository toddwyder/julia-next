// Stock Mastra connection adapters and secret validation per ADR 0019 and ADR 0021.
import { spawn } from 'node:child_process';

const RAW_SECRET_PATTERNS = [
  /^ghp_[a-zA-Z0-9]{20,}$/,
  /^github_pat_[a-zA-Z0-9_]{20,}$/,
  /^sk-[a-zA-Z0-9_-]{20,}$/,
  /^Bearer\s+\S+$/i,
  /^xox[baprs]-[a-zA-Z0-9-]{10,}$/,
  /^[a-f0-9]{32,64}$/i,
  /^[A-Za-z0-9+/]{40,}={0,2}$/,
];

const VALID_VAULT_REFERENCE = /^([A-Z][A-Z0-9_]{2,63}|op:\/\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)?)$/;

export function assertNoRawSecret(value, field = 'authReference') {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (RAW_SECRET_PATTERNS.some(pat => pat.test(trimmed)) || !VALID_VAULT_REFERENCE.test(trimmed)) {
    throw new Error(`cannot store raw secret in ${field}; store it in the vault and pass its reference name`);
  }
}

export function inferModelMaker(modelId, defaultMaker = 'Unknown') {
  const id = String(modelId || '').toLowerCase();
  if (/claude|anthropic|sonnet|opus|haiku/.test(id)) return 'Anthropic';
  if (/gpt|o1|o3|o4|codex|openai/.test(id)) return 'OpenAI';
  if (/gemini|google/.test(id)) return 'Google';
  if (/deepseek|deep-seek/.test(id)) return 'DeepSeek';
  if (/grok|xai/.test(id)) return 'xAI';
  if (/llama|meta/.test(id)) return 'Meta';
  if (/mistral|codestral|mixtral/.test(id)) return 'Mistral';
  if (/qwen|alibaba/.test(id)) return 'Alibaba';
  return defaultMaker || 'Unknown';
}

export function redactConnection(connection) {
  const copy = { ...connection };
  if (typeof copy.authReference === 'string' && copy.authReference.startsWith('op://')) {
    const parts = copy.authReference.split('/');
    if (parts.length >= 4) {
      parts[3] = '***';
      copy.authReference = parts.join('/');
    }
  }
  return copy;
}

export async function testApiAdapter(connection, {
  resolveSecret = (name) => process.env[name] ?? null,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!connection.endpoint) throw new Error(`API connection "${connection.id}" missing endpoint`);
  const apiKey = connection.authReference ? resolveSecret(connection.authReference) : null;
  if (connection.authReference && !apiKey) {
    return { status: 'FAIL', reason: `auth reference "${connection.authReference}" could not be resolved from vault`, models: [], testedAt: new Date().toISOString() };
  }
  const modelsUrl = new URL(connection.endpoint.replace(/\/+$/, '') + '/models');
  try {
    const headers = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetchImpl(modelsUrl.toString(), { method: 'GET', headers });
    if (!response.ok) {
      return { status: 'FAIL', reason: `endpoint returned HTTP ${response.status}`, models: [], testedAt: new Date().toISOString() };
    }
    const data = await response.json();
    const rawList = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    const models = rawList.map(item => {
      const id = typeof item === 'string' ? item : (item.id ?? item.name);
      const name = typeof item === 'object' && item.name ? item.name : (item.id ?? String(item));
      const maker = inferModelMaker(id, connection.maker);
      const supportsThinking = /reasoner|thought|thinking|r1/i.test(id || name);
      return {
        id, name, maker, route: 'api', service: connection.service,
        thinking: supportsThinking ? { supported: ['low', 'medium', 'high'], default: 'medium' } : { supported: false, default: null },
        readiness: 'READY',
      };
    });
    return { status: 'PASS', models, testedAt: new Date().toISOString() };
  } catch (error) {
    return { status: 'FAIL', reason: `network probe failed: ${error.message}`, models: [], testedAt: new Date().toISOString() };
  }
}

export function discoverCodexAppServerModels(executable = 'codex', args = ['app-server', '--stdio'], { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let buffer = '';
    const timer = setTimeout(() => {
      if (!finished) { finished = true; child.kill(); reject(new Error('timed out waiting for ACP model discovery')); }
    }, timeoutMs);
    child.on('error', (err) => { if (!finished) { finished = true; clearTimeout(timer); reject(err); } });
    child.on('close', (code) => { if (!finished) { finished = true; clearTimeout(timer); reject(new Error(`ACP server exited with code ${code}`)); } });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.id === 2 && Array.isArray(msg.result?.data)) {
            if (!finished) { finished = true; clearTimeout(timer); child.kill(); resolve(msg.result.data); }
          }
        } catch {}
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'julia', version: '1.0' } } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'model/list', params: {} }) + '\n');
  });
}

export function discoverAntigravityModels(executable = 'agy', { timeoutMs = 15000, runCommand = null } = {}) {
  if (runCommand) {
    return runCommand(executable, ['models']).then(res => {
      if (res.code !== 0) throw new Error(res.stderr || `exit code ${res.code}`);
      return parseAgyModelsOutput(res.stdout);
    });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['models'], { stdio: ['ignore', 'pipe', 'pipe'], shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('timed out waiting for agy models')); }, timeoutMs);
    child.stdout?.on('data', d => { stdout += d.toString(); });
    child.stderr?.on('data', d => { stderr += d.toString(); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`agy models returned code ${code}: ${stderr}`));
      else { try { resolve(parseAgyModelsOutput(stdout)); } catch (err) { reject(err); } }
    });
  });
}

function parseAgyModelsOutput(output) {
  const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
  const models = [];
  for (const line of lines) {
    if (line.startsWith('Fetching')) continue;
    const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
    if (!parts.length) continue;
    const id = parts[0];
    const name = parts[1] || id;
    const maker = inferModelMaker(id, 'Google');
    const supportsThinking = /-high|-medium|-low/i.test(id) || /claude|gemini/i.test(id);
    models.push({
      id, name, maker, route: 'acp', service: 'Antigravity',
      thinking: supportsThinking
        ? { supported: ['low', 'medium', 'high'], default: id.endsWith('-high') ? 'high' : (id.endsWith('-low') ? 'low' : 'medium') }
        : { supported: false, default: null },
      readiness: 'READY',
    });
  }
  return models;
}

export async function checkClaudeModelExact(modelId, { executable = 'claude', timeoutMs = 8000, probeFn = null } = {}) {
  if (probeFn) return probeFn(modelId);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--model', modelId, '-p', 'say hi'], { stdio: ['pipe', 'pipe', 'pipe'], shell: true, windowsHide: true });
    child.stdin.end();
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timed out waiting for claude --model ${modelId}`)); }, timeoutMs);
    child.stderr?.on('data', d => { stderr += d.toString(); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`claude --model ${modelId} failed with code ${code}: ${stderr}`));
      else {
        resolve({
          id: modelId, name: `Claude ${modelId}`, maker: 'Anthropic', route: 'acp', service: 'Claude',
          thinking: { supported: ['low', 'medium', 'high'], default: 'medium' }, readiness: 'READY',
        });
      }
    });
  });
}

export async function testAcpAdapter(connection, {
  AcpAgentClass = null,
  runCommand = null,
  claudeProbe = null,
} = {}) {
  const service = (connection.service || '').toLowerCase();
  const executable = connection.command || (service === 'antigravity' ? 'agy' : 'codex');

  if (service === 'antigravity' || executable === 'agy') {
    try {
      const models = await discoverAntigravityModels(executable, { runCommand });
      if (!models.length) return { status: 'FAIL', reason: 'Antigravity ACP advertised zero models', models: [], testedAt: new Date().toISOString() };
      return { status: 'PASS', models, testedAt: new Date().toISOString() };
    } catch (err) {
      return { status: 'FAIL', reason: `Antigravity ACP probe failed: ${err.message}`, models: [], testedAt: new Date().toISOString() };
    }
  }

  if (service === 'claude' || service === 'anthropic' || executable === 'claude') {
    const enrolled = Array.isArray(connection.enrolledModels) && connection.enrolledModels.length > 0
      ? connection.enrolledModels
      : (Array.isArray(connection.models) && connection.models.length > 0 ? connection.models : ['sonnet']);
    try {
      const models = [];
      for (const mId of enrolled) {
        models.push(await checkClaudeModelExact(mId, { executable: connection.command || 'claude', probeFn: claudeProbe }));
      }
      return { status: 'PASS', models, testedAt: new Date().toISOString() };
    } catch (err) {
      return { status: 'FAIL', reason: `Claude model check failed: ${err.message}`, models: [], testedAt: new Date().toISOString() };
    }
  }

  const args = connection.args || (executable === 'codex' ? ['app-server', '--stdio'] : ['--stdio']);
  let AcpAgentImpl = AcpAgentClass;
  if (!AcpAgentImpl) {
    try {
      const mod = await import('@mastra/acp');
      AcpAgentImpl = mod.AcpAgent;
    } catch {
      try {
        const url = new URL('../ops/mastra-agents/reviewer/node_modules/@mastra/acp/dist/index.js', import.meta.url);
        AcpAgentImpl = (await import(url.href)).AcpAgent;
      } catch { AcpAgentImpl = null; }
    }
  }

  if (AcpAgentImpl) {
    try {
      const agent = new AcpAgentImpl({ id: connection.id, name: connection.name || connection.id, command: executable, args, cwd: process.cwd() });
      let advertised = [];
      try {
        advertised = await agent.getAvailableModels();
      } catch {
        const rpcModels = await discoverCodexAppServerModels(executable, args);
        advertised = rpcModels.map(m => ({
          id: m.id, name: m.displayName || m.id, maker: inferModelMaker(m.id, connection.maker || 'OpenAI'),
          thinking: { supported: Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts.map(e => e.reasoningEffort) : ['low', 'medium', 'high'], default: m.defaultReasoningEffort || 'low' },
        }));
      }
      const models = advertised.map(m => ({
        id: m.modelId || m.id, name: m.name || m.modelId || m.id, maker: m.maker || inferModelMaker(m.modelId || m.id, connection.maker || 'OpenAI'),
        route: 'acp', service: connection.service || 'Codex', thinking: m.thinking || { supported: ['low', 'medium', 'high'], default: 'high' }, readiness: 'READY',
      }));
      return { status: 'PASS', models, testedAt: new Date().toISOString() };
    } catch (error) {
      return { status: 'FAIL', reason: `stock Mastra AcpAgent probe failed: ${error.message}`, models: [], testedAt: new Date().toISOString() };
    }
  }

  try {
    const rpcModels = await discoverCodexAppServerModels(executable, args);
    const models = rpcModels.map(m => ({
      id: m.id, name: m.displayName || m.id, maker: inferModelMaker(m.id, connection.maker || 'OpenAI'),
      route: 'acp', service: connection.service || 'Codex',
      thinking: { supported: Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts.map(e => e.reasoningEffort) : ['low', 'medium', 'high'], default: m.defaultReasoningEffort || 'low' },
      readiness: 'READY',
    }));
    return { status: 'PASS', models, testedAt: new Date().toISOString() };
  } catch (error) {
    return { status: 'FAIL', reason: `ACP connection probe failed: ${error.message}`, models: [], testedAt: new Date().toISOString() };
  }
}

export async function testSdkAdapter(connection) {
  return {
    status: 'FAIL',
    reason: `unsupported SDK service "${connection?.service || 'unknown'}"; Cursor and SDK-agent routes are excluded under JUL-225`,
    models: [],
    testedAt: new Date().toISOString(),
  };
}
