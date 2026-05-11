/**
 * 把 "用户原话 + 附件原文" 的 statement 拆出展示部分。
 *
 * 存储约定 (见 components/IntentForm.tsx):
 *   <用户原话>\n\n【参考文件: name1】\n<content1>\n\n【参考文件: name2】\n<content2>
 *   或从 URL 导入: 【导入参考 (html)】\n<content>
 *
 * 卡片/对立栏只展示用户原话, 附件正文藏起来给 LLM 读, UI 用 chip 提示文件名。
 */

const ATTACH_MARKER_RE = /【(?:参考文件:\s*[^】]+|导入参考(?:\s*\([^)]*\))?)】/;
const ATTACH_NAME_RE = /【参考文件:\s*([^】]+)】/g;
const IMPORT_REF_RE = /【导入参考(?:\s*\(([^)]*)\))?】/g;

export type ParsedStatement = {
  userText: string;
  attachments: string[];
  hasImportRef: boolean;
};

export function parseStatementForDisplay(raw: string): ParsedStatement {
  const firstMatch = raw.search(ATTACH_MARKER_RE);
  const userText = (firstMatch >= 0 ? raw.slice(0, firstMatch) : raw).trim();
  const attachments: string[] = [];
  for (const m of raw.matchAll(ATTACH_NAME_RE)) {
    attachments.push(m[1].trim());
  }
  let hasImportRef = false;
  for (const m of raw.matchAll(IMPORT_REF_RE)) {
    hasImportRef = true;
    if (m[1]) attachments.push(m[1].trim());
  }
  return { userText, attachments, hasImportRef };
}
