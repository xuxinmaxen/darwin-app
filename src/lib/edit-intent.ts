import type { Intent } from './types';

export type EditKind =
  | 'annotated_patch'
  | 'text_replace'
  | 'asset_repair'
  | 'visual_patch'
  | 'local_patch'
  | 'global_rewrite';

export type ImageReference = {
  name: string;
  url: string;
};

export type EditClassification = {
  kinds: EditKind[];
  imageRefs: ImageReference[];
  reason: string;
};

const IMAGE_REF_RE = /【参考图片:\s*([^】]+)】\s*(https?:\/\/\S+)/g;

const GLOBAL_REWRITE_RE =
  /(整体|全站|全局|所有模块|全部模块|整个页面|整页|重做|重新设计|重新生成|大改|整体重构|from scratch|full\s*rewrite|redesign\s+the\s+whole)/i;

const TEXT_REPLACE_RE =
  /(改成|改为|换成|替换成|替换为|->|→|=>)/i;

const ASSET_REPAIR_RE =
  /(logo|图标|图片|image|img|破图|缺失|加载不出来|没有加载|糊了|补全|补充|修复)/i;

const VISUAL_PATCH_RE =
  /(截图|红框|框中|如图|参考图片|看我上传|视觉|样式|位置|对齐)/i;

export function classifyEditBatch(intents: Intent[]): EditClassification {
  const kinds = new Set<EditKind>();
  const imageRefs: ImageReference[] = [];
  const reasons: string[] = [];

  for (const intent of intents) {
    const statement = intent.statement || '';
    if (/【标注修改】/.test(statement)) {
      kinds.add('annotated_patch');
      reasons.push('contains annotated pins');
    }
    if (GLOBAL_REWRITE_RE.test(statement)) {
      kinds.add('global_rewrite');
      reasons.push('explicit global rewrite language');
    }
    if (TEXT_REPLACE_RE.test(statement)) {
      kinds.add('text_replace');
      reasons.push('contains text replacement language');
    }
    if (ASSET_REPAIR_RE.test(statement)) {
      kinds.add('asset_repair');
      reasons.push('mentions broken/missing visual asset');
    }
    if (VISUAL_PATCH_RE.test(statement)) {
      kinds.add('visual_patch');
      reasons.push('mentions screenshot/visual reference');
    }
    if (!GLOBAL_REWRITE_RE.test(statement)) {
      kinds.add('local_patch');
    }

    for (const ref of extractImageReferences(statement)) {
      imageRefs.push(ref);
    }
  }

  return {
    kinds: Array.from(kinds),
    imageRefs: dedupeBy(imageRefs, ref => ref.url),
    reason: dedupe(reasons).join('; ') || 'default local patch',
  };
}

export function extractImageReferences(statement: string): ImageReference[] {
  const refs: ImageReference[] = [];
  for (const match of statement.matchAll(IMAGE_REF_RE)) {
    refs.push({
      name: match[1]?.trim() || 'image',
      url: (match[2] || '').trim(),
    });
  }
  return refs;
}

export function hasImageReferences(intents: Intent[]): boolean {
  return intents.some(intent => extractImageReferences(intent.statement).length > 0);
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
