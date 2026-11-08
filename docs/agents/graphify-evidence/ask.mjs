import { readFileSync } from 'node:fs';

const key = process.env.COMMANDCODE_API_KEY;
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const body = {
  model: input.model ?? 'deepseek/deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: input.system },
    { role: 'user', content: input.user },
  ],
  temperature: 0,
};
const response = await fetch('https://api.commandcode.ai/provider/v1/chat/completions', {
  method: 'POST',
  headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const result = await response.json();
if (!response.ok) {
  console.error(response.status, JSON.stringify(result).slice(0, 500));
  process.exit(1);
}
console.log(JSON.stringify({
  answer: result.choices?.[0]?.message?.content ?? '',
  usage: result.usage ?? null,
}));
