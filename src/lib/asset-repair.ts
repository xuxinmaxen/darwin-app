import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { Intent } from './types';

export type AssetRepairResult =
  | {
      ok: true;
      html: string;
      changed: number;
      reason: string;
    }
  | {
      ok: false;
      reason: string;
    };

type BrandLogo = {
  keys: string[];
  label: string;
  svg: string;
};

const BRAND_LOGOS: BrandLogo[] = [
  {
    keys: ['chatgpt', 'openai', 'fchatgpt'],
    label: 'ChatGPT',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#10A37F"/><path fill="#fff" d="M32 12c3.8 0 7.2 2.1 9 5.3a10.3 10.3 0 0 1 8 14.2 10.2 10.2 0 0 1-9.2 15.4A10.3 10.3 0 0 1 22 46.5a10.2 10.2 0 0 1-8-14.1 10.2 10.2 0 0 1 9.2-15.5A10.2 10.2 0 0 1 32 12Zm-5.9 8.7 10.2 5.9 3-1.7-10.2-5.9a6.7 6.7 0 0 0-7.9 2.1 6.6 6.6 0 0 0-.9 6.2l3-1.7a3.2 3.2 0 0 1 2.8-4.9Zm15.6 8.2V17.1a6.6 6.6 0 0 0-5.3-1.9 6.7 6.7 0 0 0-5.4 4.2l3 1.7a3.2 3.2 0 0 1 4.2-1.7v11.8l3.5-2.3Zm-20.2 8.2-3-1.8a6.7 6.7 0 0 0 3.5 7.2 6.6 6.6 0 0 0 6.4-.5v-3.5a3.2 3.2 0 0 1-5.4-1.4l10.2-5.9v-3.5l-11.7 6.8Zm21 6.2-10.2-5.9-3 1.7 10.2 5.9a6.7 6.7 0 0 0 7.9-2.1 6.6 6.6 0 0 0 .9-6.2l-3 1.7a3.2 3.2 0 0 1-2.8 4.9ZM22.3 35.1V46.9a6.7 6.7 0 0 0 10.7-2.3l-3-1.7a3.2 3.2 0 0 1-4.2 1.7V32.8l-3.5 2.3Zm20.2-8.2 3 1.8a6.7 6.7 0 0 0-3.5-7.2 6.6 6.6 0 0 0-6.4.5v3.5a3.2 3.2 0 0 1 5.4 1.4l-10.2 5.9v3.5l11.7-6.8Z"/></svg>`,
  },
  {
    keys: ['claude', 'anthropic'],
    label: 'Claude',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#D97757"/><path fill="#fff7ed" d="M18.5 43.4 29.8 14h5.1l11.3 29.4h-5.7l-2.4-6.7H26.4L24 43.4h-5.5Zm9.4-11.1h8.7l-4.3-12.1-4.4 12.1Z"/></svg>`,
  },
  {
    keys: ['gemini', 'google'],
    label: 'Gemini',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#1A73E8"/><path fill="#fff" d="M32 8c2.9 12.3 10.7 20.1 24 24-13.3 3.9-21.1 11.7-24 24-2.9-12.3-10.7-20.1-24-24 13.3-3.9 21.1-11.7 24-24Z"/></svg>`,
  },
  {
    keys: ['perplexity'],
    label: 'Perplexity',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#20B8A5"/><path fill="#fff" d="M18 15h9.7l4.3 4.1 4.3-4.1H46v34h-7.8L32 43l-6.2 6H18V15Zm6 6v16.5l8-7.8 8 7.8V21h-1.3L32 27.5 25.3 21H24Zm0 22h.9l7.1-6.9 7.1 6.9h.9V42l-8-7.8-8 7.8v1Z"/></svg>`,
  },
];

const BROKEN_RELATIVE_IMAGE_RE =
  /^(?:\.{0,2}\/)?(?:logo|logos|assets|images|img|icons)\//i;

export function repairAssetsForIntents(
  existingHtml: string,
  intents: Intent[]
): AssetRepairResult {
  if (!shouldRepairAssets(intents)) {
    return { ok: false, reason: 'no asset repair intent' };
  }

  const $ = cheerio.load(existingHtml, { xml: false });
  const candidateScope = candidateScopeText(intents);
  let changed = 0;
  const touched: string[] = [];
  const replacements: Array<{ from: string; to: string }> = [];

  $('img').each((_idx, node) => {
    if (!isElement(node)) return;
    const $img = $(node);
    const src = ($img.attr('src') || '').trim();
    const label = inferImageLabel($, node);
    const logo = logoFor(src, label, candidateScope);
    if (!logo) return;
    if (!isLikelyBrokenAsset(src, logo)) return;

    replacements.push({ from: src, to: svgDataUri(logo.svg) });
    changed++;
    touched.push(logo.label);
  });

  if (changed === 0) {
    return { ok: false, reason: 'no broken logo/image source matched known assets' };
  }

  return {
    ok: true,
    html: replaceImgSrcValues(existingHtml, replacements),
    changed,
    reason: `asset repair replaced ${changed} image src(s): ${dedupe(touched).join(', ')}`,
  };
}

export function countLikelyBrokenAssetRefs(html: string): number {
  const $ = cheerio.load(html, { xml: false });
  let count = 0;
  $('img').each((_idx, node) => {
    if (!isElement(node)) return;
    const src = ($(node).attr('src') || '').trim();
    if (BROKEN_RELATIVE_IMAGE_RE.test(src)) count++;
  });
  return count;
}

export function hasLikelyBrokenAssetRefs(html: string): boolean {
  return countLikelyBrokenAssetRefs(html) > 0;
}

function shouldRepairAssets(intents: Intent[]): boolean {
  return intents.some(intent =>
    /(logo|图标|图片|image|img|破图|缺失|加载不出来|没有加载|糊了|补全|补充|修复)/i
      .test(intent.statement)
  );
}

function candidateScopeText(intents: Intent[]): string {
  return intents.map(intent => `${intent.scope} ${intent.statement}`).join(' ').toLowerCase();
}

function inferImageLabel($: CheerioAPI, node: Element): string {
  const $img = $(node);
  const bits = [
    $img.attr('alt'),
    $img.attr('aria-label'),
    $img.attr('title'),
    $img.attr('src'),
    $img.parent().text(),
    $img.closest('.flow-node,.agent,.logo,.brand,[class*="logo"],[class*="node"]').text(),
  ];
  return normalize(bits.filter(Boolean).join(' '));
}

function logoFor(src: string, label: string, scope: string): BrandLogo | null {
  const haystack = normalize(`${src} ${label} ${scope}`);
  return BRAND_LOGOS.find(logo => logo.keys.some(key => haystack.includes(key))) ?? null;
}

function isLikelyBrokenAsset(src: string, logo: BrandLogo): boolean {
  if (!src) return true;
  if (/^data:image\//i.test(src)) return false;
  if (/^https?:\/\//i.test(src)) return false;
  if (/^\/\//.test(src)) return false;
  if (BROKEN_RELATIVE_IMAGE_RE.test(src)) return true;
  return logo.keys.some(key => src.toLowerCase().includes(key)) && !src.includes('/');
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22')}`;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}

function replaceImgSrcValues(
  html: string,
  replacements: Array<{ from: string; to: string }>
): string {
  let out = html;
  const unique = dedupeBy(replacements, item => item.from);
  for (const replacement of unique) {
    out = out.replace(
      /(<img\b[^>]*?\ssrc\s*=\s*)(["'])(.*?)\2/gi,
      (full, prefix: string, quote: string, value: string) => {
        if (value.trim() !== replacement.from) return full;
        return `${prefix}${quote}${replacement.to}${quote}`;
      }
    );
  }
  return out;
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

function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' && typeof (node as Element).tagName === 'string';
}
