/**
 * Intent 抽取核心 — 从一句 statement 调 Claude 取出结构化 {type, scope, weight, rationale}。
 *
 * 失败时不抛错,返回 null;调用方决定回退到默认 (Goal/global/should)。
 *
 * 复用了 prompts/extract-intent.ts 里的 system/user 构造和 zod-style 校验。
 */

import { callLLMJSON, llmProvider } from './llm';
import {
  buildExtractIntentSystem,
  buildExtractIntentUser,
  isValidExtractedIntent,
} from './prompts/extract-intent';
import type { ExtractedIntent, ProjectType } from './types';

const EXTRACT_TIMEOUT_MS = 15_000;

export type ExtractInput = {
  statement: string;
  projectType: ProjectType;
  projectBackground?: string | null;
};

export type ExtractOutcome =
  | { ok: true; intent: ExtractedIntent; source: 'llm' }
  | { ok: false; reason: string };

/**
 * 试图用 Claude 抽取 Intent。
 *
 * - 没 ANTHROPIC_API_KEY → 直接返回 ok=false (不浪费一个网络调用)
 * - DARWIN_DISABLE_CLAUDE=1 → 同上
 * - 网络/Claude 失败 → ok=false,reason 给出来,调用方回退默认
 */
export async function tryExtractIntent(
  input: ExtractInput
): Promise<ExtractOutcome> {
  if (process.env.DARWIN_DISABLE_CLAUDE === '1') {
    return { ok: false, reason: 'DARWIN_DISABLE_CLAUDE=1' };
  }
  if (!llmProvider()) {
    return { ok: false, reason: '未配置 OPENAI_API_KEY 或 ANTHROPIC_API_KEY' };
  }

  try {
    const system = buildExtractIntentSystem({
      projectType: input.projectType,
      projectBackground: input.projectBackground,
    });
    const user = buildExtractIntentUser(input.statement);

    const extracted = await Promise.race([
      callLLMJSON<ExtractedIntent>({
        system,
        user,
        cacheSystem: true,
        maxTokens: 256,
        temperature: 0,
        tier: 'fast',
      }),
      timeout(EXTRACT_TIMEOUT_MS),
    ]);

    if (!isValidExtractedIntent(extracted)) {
      return {
        ok: false,
        reason: `LLM 返回 schema 不合法: ${JSON.stringify(extracted).slice(0, 120)}`,
      };
    }

    return { ok: true, intent: extracted, source: 'llm' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[extract] LLM path failed:', reason);
    return { ok: false, reason };
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Claude 抽取超时 ${ms}ms`)), ms)
  );
}
