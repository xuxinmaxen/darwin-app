/**
 * Darwin · Claude SDK 唯一封装
 *
 * 所有 Claude API 调用走这里。不要在 route handler 里直接 new Anthropic()。
 */

import Anthropic from '@anthropic-ai/sdk';

// ─── Models ────────────────────────────────────────────────

/** 默认模型:抽取 / 渲染 / 调和 */
export const MODEL_DEFAULT =
  process.env.CLAUDE_MODEL_DEFAULT ?? 'claude-sonnet-4-5';

/** 重大决策 / 复杂仲裁:用 Opus */
export const MODEL_OPUS =
  process.env.CLAUDE_MODEL_OPUS ?? 'claude-opus-4-1';

// ─── Client (singleton) ────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Copy .env.example → .env.local and fill it in.'
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

// ─── Generic call ──────────────────────────────────────────

export type CallOptions = {
  system?: string;
  /** Cache the system prompt (Anthropic prompt caching). System >= 1024 tokens. */
  cacheSystem?: boolean;
  model?: string;
  maxTokens?: number;
  temperature?: number;
};

/**
 * Call Claude with a single user message.
 * Returns plain text from the first content block.
 */
export async function callClaude(
  userMessage: string,
  opts: CallOptions = {}
): Promise<string> {
  const client = getClient();

  const systemBlocks = opts.system
    ? [
        opts.cacheSystem
          ? {
              type: 'text' as const,
              text: opts.system,
              cache_control: { type: 'ephemeral' as const },
            }
          : { type: 'text' as const, text: opts.system },
      ]
    : undefined;

  const response = await client.messages.create({
    model: opts.model ?? MODEL_DEFAULT,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0,
    system: systemBlocks,
    messages: [{ role: 'user', content: userMessage }],
  });

  const firstBlock = response.content[0];
  if (firstBlock.type !== 'text') {
    throw new Error(
      `Expected text response from Claude, got: ${firstBlock.type}`
    );
  }
  return firstBlock.text;
}

/**
 * Call Claude and parse the response as JSON.
 * Strips ```json fences if present.
 */
export async function callClaudeJSON<T = unknown>(
  userMessage: string,
  opts: CallOptions = {}
): Promise<T> {
  const raw = await callClaude(userMessage, opts);
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse Claude response as JSON.\nRaw: ${raw}\nError: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
