/**
 * 单 pin LLM patch 调用 wrapper — 给一段 outerHTML 和用户注解, 返回改完的 outerHTML。
 *
 * 用 callLLM (不是 callLLMJSON) — 输出是 HTML 不是 JSON。
 * 失败时返回 ok:false, 上层 (patches.ts) 决定是跳过还是抛, 保留分级降级能力。
 */

import { callLLM } from './llm';
import { stripCodeFences } from './prompts/synthesize-html';
import {
  buildPatchElementSystem,
  buildPatchElementUser,
  looksLikePatchedHtml,
  type PatchElementInput,
} from './prompts/patch-element';

const PATCH_TIMEOUT_MS = 25_000;
const PATCH_MAX_TOKENS = 2_000;

export type PatchElementResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

export async function patchElement(input: PatchElementInput): Promise<PatchElementResult> {
  try {
    const raw = await Promise.race([
      callLLM({
        system: buildPatchElementSystem(),
        user: buildPatchElementUser(input),
        cacheSystem: false,    // system 都是同一份, 缓存收益小, 不引入缓存 key 复杂度
        maxTokens: PATCH_MAX_TOKENS,
        temperature: 0.1,      // 尽量保守, patch 任务不需要创意
        tier: 'fast',
      }),
      timeout(PATCH_TIMEOUT_MS),
    ]);
    const cleaned = stripCodeFences(raw).trim();
    if (!looksLikePatchedHtml(cleaned)) {
      return { ok: false, error: `LLM output not HTML-like: ${cleaned.slice(0, 100)}` };
    }
    return { ok: true, html: cleaned };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`patch-element 超时 ${ms}ms`)), ms)
  );
}
