const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(`${__dirname}/../_worker.js`, 'utf8').replace('export default {', 'globalThis.worker = {');
const retired = '@cf/qwen/qwen3-30b-a3b-fp8';
const gemma = '@cf/google/gemma-4-26b-a4b-it';

function setup() {
  const calls = [];
  const config = { defaultModel: `workers:${retired}` };
  const c = vm.createContext({
    retired,
    env: {
      AVITO_KV: { get: async (key) => key === 'aisales:config' ? config : null },
      AI: { run: async (model, input) => {
        calls.push({ model, input });
        return { choices: [{ message: { content: '{"ok":true}' } }] };
      } },
    },
  });
  vm.runInContext(source, c);
  return { c, calls, config };
}

test('Gemma is used by default and replaces the retired model in environment overrides', async () => {
  const { c, calls } = setup();
  assert.equal(await vm.runInContext("botAi(env, 'system', 'user', 120)", c), '{"ok":true}');
  c.env.CONTROL_BOT_AI_MODEL = retired;
  c.env.WORKERS_AI_MODEL = retired;
  assert.equal(await vm.runInContext("waiAi(env, 'system', 'user', 2500)", c), '{"ok":true}');
  c.env.ASSISTANT_AI_MODEL = retired;
  await vm.runInContext("botAi(env, 'system', 'user', 600, {model:env.ASSISTANT_AI_MODEL})", c);
  for (const { model, input } of calls) {
    assert.equal(model, gemma);
    assert.equal(input.chat_template_kwargs.enable_thinking, false);
    assert.equal(input.messages[1].content, 'user');
  }
  assert.equal(calls[1].input.max_tokens, 2500);
});

test('AI Sales resolves saved settings and queued requests using the retired Workers model', async () => {
  const { c, calls, config } = setup();
  assert.equal((await vm.runInContext('aisConfig(env)', c)).defaultModel, `workers:${gemma}`);
  assert.equal(config.defaultModel, `workers:${retired}`);
  const models = await vm.runInContext('aisModelList(env)', c);
  assert.equal(models[0].ref, `workers:${gemma}`);
  assert.ok(!models.some((model) => model.ref === `workers:${retired}`));
  await vm.runInContext("aisCallModel(env, 'workers:' + retired, 'system', 'user')", c);
  assert.equal(calls[0].model, gemma);
  config.defaultModel = 'openrouter:qwen/qwen3-30b-a3b';
  assert.equal((await vm.runInContext('aisConfig(env)', c)).defaultModel, config.defaultModel);
});

test('a configured GPT-OSS override keeps its Workers AI Responses API shape', async () => {
  const { c, calls } = setup();
  c.env.CONTROL_BOT_AI_MODEL = '@cf/openai/gpt-oss-20b';
  await vm.runInContext("botAi(env, 'system', 'user', 120)", c);
  assert.equal(calls[0].model, c.env.CONTROL_BOT_AI_MODEL);
  assert.equal(calls[0].input.instructions, 'system');
  assert.equal(calls[0].input.input, 'user');
  assert.equal(calls[0].input.reasoning.effort, 'low');
});
