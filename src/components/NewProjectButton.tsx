'use client';

/**
 * 新建项目 — 工具栏按钮 + 模态。
 *
 * 点击按钮打开模态：项目名称 + 类型选择器（4 选 1）+ 背景说明（可选）。
 * 创建成功后跳转到项目详情页。
 */

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Project } from '@/lib/types';
import type { Employee } from '@/lib/employees';
import { TYPE_LABEL, TypeIcon, NEW_PROJECT_TYPES } from '@/lib/type-meta';

const OWNER_ID = '00000000-0000-0000-0000-000000000001';
type SourceMode = 'blank' | 'import';

function CollabCheck({
  emp,
  checked,
  onToggle,
  disabled,
  variant = 'normal',
  hint,
}: {
  emp: Employee;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
  variant?: 'normal' | 'twin' | 'twin-recommended';
  hint?: string;
}) {
  const isTwin = variant === 'twin' || variant === 'twin-recommended';
  const isOnline = emp.kind === 'agent' || emp.isOnline;
  return (
    <button
      type="button"
      className={`collab-row${checked ? ' is-checked' : ''}${isTwin ? ' is-twin' : ''}${variant === 'twin-recommended' ? ' is-twin-recommended' : ''}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <span className="collab-avatar-wrap">
        <span className={`avatar ${emp.cls}${emp.kind === 'agent' ? ' agent' : ''}`}>
          {emp.short}
        </span>
        {emp.kind === 'human' && (
          <span
            className={`collab-online-dot${isOnline ? ' online' : ' offline'}`}
            title={isOnline ? '在线' : '离线'}
          />
        )}
      </span>
      <span className="collab-text">
        <span className="collab-name">{emp.name}</span>
        <span className="collab-role">
          {emp.role}
          {emp.kind === 'human' && (
            <span className={`collab-status-tag${isOnline ? ' online' : ' offline'}`}>
              {isOnline ? '在线' : '离线'}
            </span>
          )}
          {hint && <span className="collab-row-hint"> · {hint}</span>}
        </span>
      </span>
      <span className={`collab-check${checked ? ' on' : ''}`} aria-hidden>
        {checked && (
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M2.5 6.5L5 9l4.5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}

export default function NewProjectButton({
  employees,
  currentUserId,
}: {
  employees: Employee[];
  /** 当前登录用户 id,用于过滤协作者列表 */
  currentUserId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<Project['type']>('html');
  const [background, setBackground] = useState('');
  const [collaboratorIds, setCollaboratorIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 新建 vs 导入: 落地页可导入 URL, PPT 可导入文件
  const [sourceMode, setSourceMode] = useState<SourceMode>('blank');
  const [importUrl, setImportUrl] = useState('');
  const [importedHtmlRef, setImportedHtmlRef] = useState<
    { url: string; title: string | null; text: string; truncated: boolean } | null
  >(null);
  const [importedFile, setImportedFile] = useState<
    { name: string; isText: boolean; text?: string; note?: string } | null
  >(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // 切换 type 时重置导入态 (HTML 导入 URL, PPT 导入文件 — 不通用)
  useEffect(() => {
    setSourceMode('blank');
    setImportUrl('');
    setImportedHtmlRef(null);
    setImportedFile(null);
    setImportError(null);
  }, [type]);

  async function handleImportUrl() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch('/api/import/html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setImportError(json.error || `拉取失败 (${res.status})`);
        return;
      }
      setImportedHtmlRef({
        url: json.url,
        title: json.title,
        text: json.text,
        truncated: json.truncated,
      });
      // 若用户没填项目名, 用页面标题自动填一个
      if (!name && json.title) setName(json.title);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/import/file', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setImportError(json.error || `上传失败 (${res.status})`);
        return;
      }
      setImportedFile({
        name: json.name,
        isText: json.isText,
        text: json.text,
        note: json.note,
      });
      if (!name) {
        // 用文件名 (去后缀) 当默认项目名
        const stripped = json.name.replace(/\.[^.]+$/, '');
        setName(stripped);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  // owner 之外可勾选的员工 (owner 默认在,不渲染)
  const ownerId = currentUserId ?? OWNER_ID;
  const selectable = employees.filter(e => e.id !== ownerId);
  const humans = selectable.filter(e => e.kind === 'human');
  // 数字分身 (kind=agent + 有 linked_human_id) 不进 Agent 组,
  // 而是缩进在它真人下面渲染。独立 Agent 才在 Agent 组。
  const standaloneAgents = selectable.filter(
    e => e.kind === 'agent' && !e.linkedHumanId
  );
  const twinByHumanId = new Map<string, Employee>();
  for (const e of selectable) {
    if (e.kind === 'agent' && e.linkedHumanId) twinByHumanId.set(e.linkedHumanId, e);
  }

  function toggleCollab(id: string) {
    setCollaboratorIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, isPending]);

  function close() {
    if (isPending) return;
    setOpen(false);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请输入项目名称');
      return;
    }
    if (sourceMode === 'import') {
      if (type === 'html' && !importedHtmlRef) {
        setError('请先拉取要导入的 HTML 链接');
        return;
      }
      if (type === 'ppt' && !importedFile) {
        setError('请先上传要导入的 PPT 文件');
        return;
      }
    }

    // 把导入参考拼到 background 里, 项目背景 + 导入正文统一交给 LLM
    let finalBackground = background.trim();
    if (sourceMode === 'import') {
      const parts: string[] = [];
      if (finalBackground) parts.push(finalBackground);
      if (type === 'html' && importedHtmlRef) {
        parts.push(
          `【导入参考 (HTML)】来源: ${importedHtmlRef.url}` +
            (importedHtmlRef.title ? `\n标题: ${importedHtmlRef.title}` : '') +
            `\n\n${importedHtmlRef.text}` +
            (importedHtmlRef.truncated ? '\n\n[内容已截断 8000 字]' : '')
        );
      }
      if (type === 'ppt' && importedFile) {
        if (importedFile.isText && importedFile.text) {
          parts.push(
            `【导入参考 (${importedFile.name})】\n\n${importedFile.text}`
          );
        } else {
          parts.push(
            `【导入参考】文件名: ${importedFile.name}` +
              (importedFile.note ? `\n说明: ${importedFile.note}` : '')
          );
        }
      }
      finalBackground = parts.join('\n\n');
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmed,
            type,
            background: finalBackground || undefined,
            collaboratorIds: Array.from(collaboratorIds),
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error || `请求失败 (${res.status})`);
          return;
        }
        // Stay on workspace and refresh — let the user see the new card
        // appear at the top of the list. They can click in when ready.
        setOpen(false);
        setName('');
        setBackground('');
        setType('html');
        setCollaboratorIds(new Set());
        setSourceMode('blank');
        setImportUrl('');
        setImportedHtmlRef(null);
        setImportedFile(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="ws-btn ws-btn-primary"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <path d="M6 2v8M2 6h8" />
        </svg>
        新建项目
      </button>

      {open && (
        <div className="modal-backdrop" onClick={close}>
          <form
            className="modal-panel"
            onClick={e => e.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <header className="modal-head">
              <h2 className="modal-title">新建项目</h2>
              <p className="modal-sub">从一句话开始。Intent 会持续在这里沉淀。</p>
            </header>

            <div className="modal-body">
              <div className="field">
                <label className="field-label" htmlFor="np-name">项目名称</label>
                <input
                  id="np-name"
                  className="field-input"
                  type="text"
                  value={name}
                  placeholder="例：AI 编码工具产品发布页"
                  onChange={e => setName(e.target.value)}
                  disabled={isPending}
                  autoFocus
                />
              </div>

              <div className="field">
                <label className="field-label">产物形态</label>
                <div className="type-grid type-grid-2">
                  {NEW_PROJECT_TYPES.map(t => (
                    <button
                      key={t}
                      type="button"
                      className={`type-pick${type === t ? ' active' : ''}`}
                      onClick={() => setType(t)}
                      disabled={isPending}
                    >
                      <TypeIcon type={t} />
                      <span>{TYPE_LABEL[t]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label className="field-label">起点</label>
                <div className="source-toggle">
                  <button
                    type="button"
                    className={`source-pick${sourceMode === 'blank' ? ' active' : ''}`}
                    onClick={() => setSourceMode('blank')}
                    disabled={isPending}
                  >
                    <span className="source-pick-title">从零新建</span>
                    <span className="source-pick-desc">空白起步,让团队 Intent 合成出来</span>
                  </button>
                  <button
                    type="button"
                    className={`source-pick${sourceMode === 'import' ? ' active' : ''}`}
                    onClick={() => setSourceMode('import')}
                    disabled={isPending}
                  >
                    <span className="source-pick-title">
                      {type === 'html' ? '导入已有链接' : '导入已有 PPT'}
                    </span>
                    <span className="source-pick-desc">
                      {type === 'html'
                        ? '把目标页/参考页拉进来,AI 在它基础上迭代'
                        : '把已有 PPT 作为参考底稿 (文本可读,二进制部分仅作记录)'}
                    </span>
                  </button>
                </div>
              </div>

              {sourceMode === 'import' && type === 'html' && (
                <div className="field">
                  <label className="field-label" htmlFor="np-url">参考 HTML 链接</label>
                  <div className="import-url-row">
                    <input
                      id="np-url"
                      className="field-input"
                      type="url"
                      placeholder="https://example.com/landing"
                      value={importUrl}
                      onChange={e => setImportUrl(e.target.value)}
                      disabled={isPending || importing}
                    />
                    <button
                      type="button"
                      className="ws-btn ws-btn-ghost"
                      onClick={handleImportUrl}
                      disabled={isPending || importing || !importUrl.trim()}
                    >
                      {importing ? '拉取中…' : '拉取'}
                    </button>
                  </div>
                  {importError && <div className="import-error">⚠️ {importError}</div>}
                  {importedHtmlRef && (
                    <div className="import-ok">
                      ✓ 已拉取
                      {importedHtmlRef.title && (
                        <strong> 「{importedHtmlRef.title}」</strong>
                      )}
                      {' '}· {importedHtmlRef.text.length} 字
                      {importedHtmlRef.truncated && ' (已截断)'}
                    </div>
                  )}
                </div>
              )}

              {sourceMode === 'import' && type === 'ppt' && (
                <div className="field">
                  <label className="field-label" htmlFor="np-file">参考 PPT 文件</label>
                  <div className="import-file-row">
                    <input
                      id="np-file"
                      className="field-input"
                      type="file"
                      accept=".ppt,.pptx,.pdf,.txt,.md,.html"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) handleImportFile(f);
                      }}
                      disabled={isPending || importing}
                    />
                  </div>
                  {importing && <div className="import-info">读取中…</div>}
                  {importError && <div className="import-error">⚠️ {importError}</div>}
                  {importedFile && (
                    <div className="import-ok">
                      ✓ 已上传 <strong>{importedFile.name}</strong>
                      {importedFile.isText
                        ? ` · 文本已提取 ${importedFile.text?.length ?? 0} 字`
                        : ` · 二进制文件 (AI 仅读得到文件名)`}
                    </div>
                  )}
                </div>
              )}

              <div className="field">
                <label className="field-label" htmlFor="np-bg">项目背景（可选）</label>
                <textarea
                  id="np-bg"
                  className="field-input field-textarea"
                  value={background}
                  placeholder="一两句话描述目标受众、关键约束。Agent 会读这段做参考。"
                  onChange={e => setBackground(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div className="field">
                <label className="field-label">
                  邀请协作者
                  <span className="field-hint">
                    — 你已自动加入。Agent 会按人设主动贡献 Intent
                  </span>
                </label>
                {selectable.length === 0 ? (
                  <div className="collab-empty">
                    还没有其他员工。去
                    {' '}<a href="/employees" target="_blank" rel="noreferrer">员工管理</a>{' '}
                    新增真实成员或 Agent。
                  </div>
                ) : (
                  <div className="collab-grid">
                    {humans.length > 0 && (
                      <>
                        <div className="collab-group-label">真实员工</div>
                        {humans.map(emp => {
                          const twin = twinByHumanId.get(emp.id) ?? null;
                          // 有数字分身 → 始终展示(在线时可选,离线时推荐)
                          const showTwin = !!twin;
                          const twinVariant = !emp.isOnline ? 'twin-recommended' : 'twin';
                          const twinHint = !emp.isOnline
                            ? `${emp.name}离线，推荐数字分身代为参与`
                            : '数字分身';
                          return (
                            <div key={emp.id} className="collab-cluster">
                              <CollabCheck
                                emp={emp}
                                checked={collaboratorIds.has(emp.id)}
                                onToggle={() => toggleCollab(emp.id)}
                                disabled={isPending}
                              />
                              {showTwin && twin && (
                                <CollabCheck
                                  emp={twin}
                                  checked={collaboratorIds.has(twin.id)}
                                  onToggle={() => toggleCollab(twin.id)}
                                  disabled={isPending}
                                  variant={twinVariant}
                                  hint={twinHint}
                                />
                              )}
                            </div>
                          );
                        })}
                      </>
                    )}
                    {standaloneAgents.length > 0 && (
                      <>
                        <div className="collab-group-label">Agent 员工</div>
                        {standaloneAgents.map(emp => (
                          <CollabCheck
                            key={emp.id}
                            emp={emp}
                            checked={collaboratorIds.has(emp.id)}
                            onToggle={() => toggleCollab(emp.id)}
                            disabled={isPending}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {error && <div className="modal-error">{error}</div>}

            <footer className="modal-foot">
              <button
                type="button"
                className="ws-btn ws-btn-ghost"
                onClick={close}
                disabled={isPending}
              >
                取消
              </button>
              <button
                type="submit"
                className="ws-btn ws-btn-accent"
                disabled={isPending || !name.trim()}
              >
                {isPending ? '创建中…' : '创建项目'}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}
