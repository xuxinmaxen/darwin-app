/**
 * GET /api/projects/[id]/export?format=html|pptx
 *
 * html  → 下载最新版本的 HTML 文件
 * pptx  → 解析 HTML/Markdown 版本内容,用 pptxgenjs 生成真实 PPTX 并下载
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/lib/projects';
import { getLatestVersion } from '@/lib/versions';
import { extractSourceUrl } from '@/lib/extract-source-url';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const format = req.nextUrl.searchParams.get('format') ?? 'html';

  const [project, version] = await Promise.all([
    getProject(id),
    getLatestVersion(id),
  ]);

  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  if (!version) {
    return NextResponse.json({ error: '还没有版本，先合成一次再导出' }, { status: 400 });
  }

  const slug = project.name.replace(/[^\w一-龥-]/g, '_').slice(0, 60);

  if (format === 'html') {
    // 导出 HTML 在 file:// 协议打开时, <img src="/x.png"> / <img src="/_next/..."> 之类
    // 相对/根路径会被解析成 file:///x.png → 坏图。给 head 注入 <base href=sourceUrl>
    // 让浏览器把这些 URL 解析回原站, 图片就能正常 fetch (img 元素不受 CORS 限制)。
    // 用户从零新建的项目没有 sourceUrl, 不动 HTML。
    const sourceUrl = extractSourceUrl(project.background);
    const finalContent = injectBaseForExport(version.content, sourceUrl);
    return new NextResponse(finalContent, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(slug)}.html"`,
      },
    });
  }

  if (format === 'pptx') {
    const pptxBuf = await buildPptx(project.name, version.content);
    return new NextResponse(pptxBuf.buffer as ArrayBuffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(slug)}.pptx"`,
      },
    });
  }

  return NextResponse.json({ error: `不支持的 format: ${format}` }, { status: 400 });
}

/**
 * 给导出 HTML 注入 <base href=sourceUrl>, 让 file:// 下相对图片能 fetch 回原站。
 * 已经有 <base> 时不动 (LLM 偶尔会自己写一个); 没 sourceUrl 时也不动。
 * 注意: <base> 不影响 hash anchor (#section), self-containment 不破坏。
 */
function injectBaseForExport(html: string, sourceUrl: string | null): string {
  if (!sourceUrl) return html;
  if (/<base\b/i.test(html)) return html;
  const baseTag = `<base href="${sourceUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  // 没 <head> 也尝试塞个最小的;不过 LLM 输出几乎一定有 head
  return `<head>${baseTag}</head>${html}`;
}

// ─── PPTX builder ──────────────────────────────────────────────────────────

type Slide = { title: string; bullets: string[] };

/** 把 HTML 或 Markdown 内容解析为幻灯片数组 */
function parseSlides(content: string, projectName: string): Slide[] {
  const isHtml =
    content.trim().toLowerCase().startsWith('<!doctype') ||
    content.trim().toLowerCase().startsWith('<html');

  return isHtml ? parseHtmlSlides(content, projectName) : parseMdSlides(content, projectName);
}

function parseHtmlSlides(html: string, projectName: string): Slide[] {
  const slides: Slide[] = [];

  // 按 <section> 或 <article> 分块;没有则整体一张
  const sectionRe = /<(?:section|article)[^>]*>([\s\S]*?)<\/(?:section|article)>/gi;
  let m: RegExpExecArray | null;
  const sections: string[] = [];
  while ((m = sectionRe.exec(html)) !== null) sections.push(m[1]);

  if (sections.length === 0) {
    // 没有 section 结构 → 整体作为一页
    const title = extractFirstTag(html, ['h1']) || projectName;
    const bullets = extractTextBlocks(html).slice(0, 8);
    return [{ title, bullets }];
  }

  for (const sec of sections) {
    const title = extractFirstTag(sec, ['h1', 'h2', 'h3']) || projectName;
    const bullets = extractTextBlocks(sec).filter(b => b !== title).slice(0, 8);
    slides.push({ title, bullets });
  }
  return slides;
}

function parseMdSlides(md: string, projectName: string): Slide[] {
  const slides: Slide[] = [];
  const lines = md.split('\n');

  let current: Slide | null = null;

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)/);
    const h2 = line.match(/^##\s+(.+)/);
    const bullet = line.match(/^[-*]\s+(.+)/);
    const quote = line.match(/^>\s+(.+)/);

    if (h1) {
      if (current) slides.push(current);
      current = { title: h1[1].trim(), bullets: [] };
    } else if (h2) {
      if (current) slides.push(current);
      current = { title: h2[1].trim(), bullets: [] };
    } else if (current && bullet) {
      current.bullets.push(bullet[1].trim());
    } else if (current && quote) {
      current.bullets.push(quote[1].trim());
    }
  }
  if (current) slides.push(current);

  if (slides.length === 0) slides.push({ title: projectName, bullets: [md.slice(0, 200)] });
  return slides;
}

function extractFirstTag(html: string, tags: string[]): string {
  for (const t of tags) {
    const m = html.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i'));
    if (m) return stripHtmlTags(m[1]).trim();
  }
  return '';
}

function extractTextBlocks(html: string): string[] {
  const items: string[] = [];
  const re = /<(?:li|p|td)[^>]*>([\s\S]*?)<\/(?:li|p|td)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const t = stripHtmlTags(m[1]).trim();
    if (t && t.length > 2 && t.length < 200) items.push(t);
  }
  return items;
}

function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function buildPptx(projectName: string, content: string): Promise<Buffer> {
  // dynamic import keeps pptxgenjs out of the client bundle
  const PptxGenJS = (await import('pptxgenjs')).default;
  const prs = new PptxGenJS();

  prs.layout = 'LAYOUT_WIDE';
  prs.author = 'Darwin';
  prs.subject = projectName;
  prs.title = projectName;

  const slides = parseSlides(content, projectName);

  // ── 封面幻灯片 ──
  const cover = prs.addSlide();
  cover.background = { fill: 'F7F6F0' };
  cover.addText(projectName, {
    x: 0.8, y: 1.8, w: '85%', h: 1.8,
    fontSize: 36, bold: true, color: '1A1A1C',
    fontFace: 'PingFang SC, Helvetica Neue, Arial',
    align: 'left',
  });
  cover.addText('由 Darwin 多人意图合成', {
    x: 0.8, y: 3.8, w: '85%', h: 0.5,
    fontSize: 14, color: '8E8F99',
    fontFace: 'PingFang SC, Helvetica Neue, Arial',
    align: 'left',
  });

  // ── 内容幻灯片 ──
  for (const slide of slides) {
    const s = prs.addSlide();
    s.background = { fill: 'FFFFFF' };

    // 左侧紫色竖条
    s.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: 0.08, h: '100%', fill: { color: '6366F1' },
    });

    // 标题
    s.addText(slide.title, {
      x: 0.5, y: 0.45, w: '88%', h: 0.9,
      fontSize: 24, bold: true, color: '1A1A1C',
      fontFace: 'PingFang SC, Helvetica Neue, Arial',
      align: 'left',
    });

    // 分隔线
    s.addShape(prs.ShapeType.line, {
      x: 0.5, y: 1.35, w: '88%', h: 0,
      line: { color: 'E8E5DA', width: 1 },
    });

    // 正文 bullets
    if (slide.bullets.length > 0) {
      const bulletText = slide.bullets.map(b => ({ text: b, options: { bullet: { code: '2022' } } }));
      s.addText(bulletText, {
        x: 0.6, y: 1.55, w: '87%', h: 4.0,
        fontSize: 15, color: '525560',
        fontFace: 'PingFang SC, Helvetica Neue, Arial',
        paraSpaceBefore: 8,
        lineSpacingMultiple: 1.35,
      });
    }
  }

  const buf = await prs.write({ outputType: 'nodebuffer' });
  return buf as Buffer;
}
