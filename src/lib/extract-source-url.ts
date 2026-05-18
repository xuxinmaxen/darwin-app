/**
 * 从 project.background 抽出原始 source URL — 用于:
 *   1. iframe 预览注入 <base href> (ProjectCanvas 渲染层)
 *   2. 导出 HTML 注入 <base href> 让 file:// 下相对图片仍能 fetch (export route)
 *
 * background 在导入项目时长成:
 *   【导入参考 (HTML)】
 *   来源: https://nohi.ai/
 *   标题: ...
 *   原始 HTML (压缩): ...
 *   【/导入参考 (HTML)】
 */
export function extractSourceUrl(background: string | null | undefined): string | null {
  if (!background) return null;
  const m = background.match(/【导入参考 \(HTML\)】[\s\S]*?来源:\s*(\S+)/);
  return m ? m[1] : null;
}
