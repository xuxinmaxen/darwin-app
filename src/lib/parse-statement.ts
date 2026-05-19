/**
 * 把 "用户原话 + 附件原文" 的 statement 拆出展示部分。
 *
 * 存储约定 (见 components/IntentForm.tsx):
 *   <用户原话>\n\n【参考文件: name1】\n<content1>\n\n【参考文件: name2】\n<content2>
 *   <用户原话>\n\n【参考链接】来源: <url>\n标题: <title>\n\n<拉取正文>
 *   或从 URL 导入: 【导入参考 (html)】\n<content>
 *
 * 卡片/对立栏只展示用户原话, 附件正文藏起来给 LLM 读, UI 用 chip 提示文件名/链接。
 */

const ATTACH_MARKER_RE = /【(?:参考文件:\s*[^】]+|导入参考(?:\s*\([^)]*\))?|参考链接|参考图片:\s*[^】]+)】/;
const ATTACH_NAME_RE = /【参考文件:\s*([^】]+)】/g;
const IMAGE_NAME_RE = /【参考图片:\s*([^】]+)】/g;
const IMPORT_REF_RE = /【导入参考(?:\s*\(([^)]*)\))?】/g;
/**
 * 【标注修改】块: 用户标注的元素文本里可能包含 【...】 子串 (比如产物把
 * "【导入参考 (HTML)】..." 直接渲染成可见文字, pin 中的 element text 就会带这串).
 * 必须先把整个 patch block 从 raw 里挖掉再扫 attach marker, 否则会被误切。
 */
const ANNOT_BLOCK_RE = /【标注修改】[\s\S]*?(?=\n\n【(?:参考文件|导入参考|参考链接|参考图片)|$)/;
/**
 * 【参考链接】块两种形态:
 *   (ok)      【参考链接】来源: <url>\n标题: <title>\n\n<body...>
 *   (fail/初) 【参考链接】<url>\n(pending/失败原因)
 * 我们只在卡片上 chip 显示标题 (或 host fallback), 正文藏起来给 LLM。
 */
const LINK_REF_FULL_RE = /【参考链接】来源:\s*(\S+)(?:\s*\n\s*标题:\s*([^\n]+))?/g;
const LINK_REF_SHORT_RE = /【参考链接】\s*(https?:\/\/\S+)/g;

export type LinkRef = { url: string; title: string | null };

export type ParsedStatement = {
  userText: string;
  /** 文件附件名 */
  attachments: string[];
  /** 图片附件名 */
  images: string[];
  /** 参考链接 (URL + 可选标题) */
  links: LinkRef[];
  /** 项目级导入参考 (HTML 复刻蓝本) */
  hasImportRef: boolean;
};

function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export function parseStatementForDisplay(raw: string): ParsedStatement {
  // 先把 【标注修改】 块从 raw 里挖掉, 再扫 attach marker。pin 里的 element text
  // 经常含 【...】 子串, 不挖掉就会被 ATTACH_MARKER_RE 在 patch block 内部误切。
  let annotBlock = '';
  let scanSource = raw;
  const annotMatch = raw.match(ANNOT_BLOCK_RE);
  if (annotMatch && annotMatch.index !== undefined) {
    annotBlock = annotMatch[0];
    scanSource =
      raw.slice(0, annotMatch.index) +
      raw.slice(annotMatch.index + annotMatch[0].length);
  }

  const firstMatch = scanSource.search(ATTACH_MARKER_RE);
  let userText = (firstMatch >= 0 ? scanSource.slice(0, firstMatch) : scanSource).trim();
  if (annotBlock) {
    userText = userText ? `${userText}\n\n${annotBlock}` : annotBlock;
  }

  // attach 扫描走 scanSource (已剥掉 annotBlock), 避免 pin 文本里的 【参考…】 被当成真附件
  const attachments: string[] = [];
  for (const m of scanSource.matchAll(ATTACH_NAME_RE)) attachments.push(m[1].trim());

  const images: string[] = [];
  for (const m of scanSource.matchAll(IMAGE_NAME_RE)) images.push(m[1].trim());

  const links: LinkRef[] = [];
  const seenUrls = new Set<string>();
  for (const m of scanSource.matchAll(LINK_REF_FULL_RE)) {
    const url = m[1].trim();
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    links.push({ url, title: m[2]?.trim() || null });
  }
  for (const m of scanSource.matchAll(LINK_REF_SHORT_RE)) {
    const url = m[1].trim();
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    links.push({ url, title: null });
  }

  let hasImportRef = false;
  for (const m of scanSource.matchAll(IMPORT_REF_RE)) {
    hasImportRef = true;
    if (m[1]) attachments.push(m[1].trim());
  }

  return { userText, attachments, images, links, hasImportRef };
}

export function linkRefLabel(link: LinkRef): string {
  if (link.title) {
    return link.title.length > 40 ? link.title.slice(0, 40) + '…' : link.title;
  }
  return safeHost(link.url);
}
