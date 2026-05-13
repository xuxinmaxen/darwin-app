/**
 * Darwin · LLM Facade
 *
 * 上层调用方 (extract / synthesize) 只调 callLLM / callLLMJSON。
 * 下层根据 env 自动选 provider:
 *   - OPENAI_API_KEY 设了 → openai (走 OpenAI SDK,可指 cc-switch / 国产中转的 OpenAI 兼容端点)
 *   - 否则 ANTHROPIC_API_KEY 设了 → anthropic (走 Anthropic SDK,可指 Hermes)
 *
 * env (.env.local):
 *   OPENAI_API_KEY=sk-xxx                          ← cc-switch / openai 直连 key
 *   OPENAI_BASE_URL=https://your-cc-switch/v1      ← 中转站 base url (省略 = api.openai.com)
 *   OPENAI_MODEL=gpt-4o                            ← 模型名 (省略 = gpt-4o)
 *
 *   ANTHROPIC_API_KEY=sk-ant-xxx                   ← Anthropic key
 *   ANTHROPIC_BASE_URL=https://claude.deeplumen.cn ← Hermes 等中转
 *   CLAUDE_MODEL_DEFAULT=claude-opus-4.6           ← Claude 模型名
 *
 * Server-only。
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export type LLMProvider = 'anthropic' | 'openai';

let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

/** 当前活跃 provider:OpenAI 优先 (因为它通常更新被设置 = 用户主动选)。 */
export function llmProvider(): LLMProvider | null {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

export type LLMConfig = {
  provider: LLMProvider | null;
  hasKey: boolean;
  baseURL: string;
  model: string;
};

export function describeLLM(): LLMConfig {
  const provider = llmProvider();
  if (provider === 'openai') {
    return {
      provider,
      hasKey: true,
      baseURL:
        process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o',
    };
  }
  if (provider === 'anthropic') {
    return {
      provider,
      hasKey: true,
      baseURL:
        process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com',
      model: process.env.CLAUDE_MODEL_DEFAULT?.trim() || 'claude-sonnet-4-5',
    };
  }
  return { provider: null, hasKey: false, baseURL: '', model: '' };
}

export type CallOpts = {
  system: string;
  user: string;
  /** Anthropic prompt caching (no-op on OpenAI). */
  cacheSystem?: boolean;
  maxTokens?: number;
  temperature?: number;
  /**
   * 任务规模提示。'fast' = 使用 OPENAI_MODEL_FAST / CLAUDE_MODEL_HAIKU 等小模型,
   * 适合 extract-intent / detect-tension / detect-consensus 等只输出 50-300 token 的任务。
   * 'full' (默认) = 用主模型,适合 synthesis 等需要大量输出的任务。
   */
  tier?: 'fast' | 'full';
};

export async function callLLM(opts: CallOpts): Promise<string> {
  const provider = llmProvider();
  if (!provider) {
    throw new Error(
      'No LLM API key set. Configure OPENAI_API_KEY or ANTHROPIC_API_KEY in .env.local'
    );
  }
  return provider === 'openai' ? callOpenAI(opts) : callAnthropic(opts);
}

/** 流式版本: 每个 text chunk 通过 AsyncGenerator yield 出来 */
export async function* callLLMStream(opts: CallOpts): AsyncGenerator<string> {
  const provider = llmProvider();
  if (!provider) {
    throw new Error('No LLM API key set');
  }
  if (provider === 'openai') {
    yield* callOpenAIStream(opts);
  } else {
    yield* callAnthropicStream(opts);
  }
}

/** Strip ```json / ``` fences and JSON.parse. */
export async function callLLMJSON<T = unknown>(opts: CallOpts): Promise<T> {
  const raw = await callLLM(opts);
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(
      `LLM 返回不是合法 JSON (前 200 字符: ${raw.slice(0, 200)}) — ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

// ─── Anthropic ────────────────────────────────────────────

function getAnthropicClient() {
  if (!_anthropic) {
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      baseURL: process.env.ANTHROPIC_BASE_URL?.trim() || undefined,
    });
  }
  return _anthropic;
}

function getOpenAIClient() {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    });
  }
  return _openai;
}

function anthropicModel(tier?: 'fast' | 'full') {
  return tier === 'fast'
    ? (process.env.CLAUDE_MODEL_HAIKU?.trim() || process.env.CLAUDE_MODEL_DEFAULT?.trim() || 'claude-haiku-4-5')
    : (process.env.CLAUDE_MODEL_DEFAULT?.trim() || 'claude-sonnet-4-5');
}

function openaiModel(tier?: 'fast' | 'full') {
  return tier === 'fast'
    ? (process.env.OPENAI_MODEL_FAST?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini')
    : (process.env.OPENAI_MODEL?.trim() || 'gpt-4o');
}

async function callAnthropic(opts: CallOpts): Promise<string> {
  const client = getAnthropicClient();
  const model = anthropicModel(opts.tier);
  const systemBlocks = [
    opts.cacheSystem
      ? { type: 'text' as const, text: opts.system, cache_control: { type: 'ephemeral' as const } }
      : { type: 'text' as const, text: opts.system },
  ];
  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0,
    system: systemBlocks,
    messages: [{ role: 'user', content: opts.user }],
  });
  const block = response.content[0];
  if (block.type !== 'text') throw new Error(`Anthropic returned ${block.type} block, expected text`);
  return block.text;
}

async function* callAnthropicStream(opts: CallOpts): AsyncGenerator<string> {
  const client = getAnthropicClient();
  const model = anthropicModel(opts.tier);
  const systemBlocks = [
    opts.cacheSystem
      ? { type: 'text' as const, text: opts.system, cache_control: { type: 'ephemeral' as const } }
      : { type: 'text' as const, text: opts.system },
  ];
  const stream = client.messages.stream({
    model,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0,
    system: systemBlocks,
    messages: [{ role: 'user', content: opts.user }],
  });
  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta' &&
      event.delta.text
    ) {
      yield event.delta.text;
    }
  }
}

// ─── OpenAI (and OpenAI-compatible cc-switch / 国产中转) ─

async function callOpenAI(opts: CallOpts): Promise<string> {
  const client = getOpenAIClient();
  const model = openaiModel(opts.tier);
  const response = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  });
  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error('OpenAI 返回内容为空');
  return text;
}

async function* callOpenAIStream(opts: CallOpts): AsyncGenerator<string> {
  const client = getOpenAIClient();
  const model = openaiModel(opts.tier);
  const stream = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    if (delta) yield delta;
  }
}
