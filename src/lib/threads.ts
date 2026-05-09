/**
 * Thread queries — 讨论抽屉的数据层。
 *
 * Thread = 一次围绕特定 scope 的讨论。两类来源:
 *   1. Tension 触发: thread.tension_id 指向冲突,系统消息开场
 *   2. 用户主动开 thread (后续): 在 Intent / 产物 section 上发起
 *
 * 消息有 3 种 author_kind:
 *   - human: 真人发言, 普通气泡
 *   - agent: Agent 发言, 气泡按 agent 配色
 *   - system: 系统事件 (Tension 触发、AI 决策、resolve 通知), 灰底
 *
 * Server-only。
 */

import { db, newId, nowISO } from './db';
import type {
  Thread,
  ThreadMessage,
  ThreadStatus,
  ThreadMessageKind,
} from './types';

// ─── Row types ─────────────────────────────────────────────

type ThreadRow = {
  id: string;
  project_id: string;
  scope: string;
  title: string;
  status: string;
  tension_id: string | null;
  created_at: string;
  resolved_at: string | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  author_id: string;
  author_kind: string;
  body: string;
  is_decision: number;
  decision_payload: string | null;
  created_at: string;
};

function rowToThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    projectId: row.project_id,
    scope: row.scope,
    title: row.title,
    status: row.status as ThreadStatus,
    tensionId: row.tension_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function rowToMessage(row: MessageRow): ThreadMessage {
  let payload: { selectedOptionKey: string } | null = null;
  if (row.decision_payload) {
    try { payload = JSON.parse(row.decision_payload); } catch { /* ignore */ }
  }
  return {
    id: row.id,
    threadId: row.thread_id,
    authorId: row.author_id,
    authorKind: row.author_kind as ThreadMessageKind,
    body: row.body,
    isDecision: row.is_decision !== 0,
    decisionPayload: payload,
    createdAt: row.created_at,
  };
}

// ─── Threads ───────────────────────────────────────────────

export async function listThreads(projectId: string): Promise<Thread[]> {
  const rows = db()
    .prepare(
      `SELECT * FROM threads WHERE project_id = ? ORDER BY created_at DESC`
    )
    .all(projectId) as ThreadRow[];
  return rows.map(rowToThread);
}

export async function getThread(id: string): Promise<Thread | null> {
  const row = db()
    .prepare(`SELECT * FROM threads WHERE id = ?`)
    .get(id) as ThreadRow | undefined;
  return row ? rowToThread(row) : null;
}

/** 给定 tensionId, 返回它关联的 active thread (避免重复创建)。 */
export async function findThreadByTension(
  tensionId: string
): Promise<Thread | null> {
  const row = db()
    .prepare(
      `SELECT * FROM threads WHERE tension_id = ? AND status = 'active' LIMIT 1`
    )
    .get(tensionId) as ThreadRow | undefined;
  return row ? rowToThread(row) : null;
}

export type CreateThreadInput = {
  projectId: string;
  scope: string;
  title: string;
  tensionId?: string | null;
  /** 创建时一并写入的开场消息 (一般是 system 类描述冲突) */
  openingMessages?: Array<{
    authorId: string;
    authorKind: ThreadMessageKind;
    body: string;
    isDecision?: boolean;
  }>;
};

export async function createThread(input: CreateThreadInput): Promise<Thread> {
  const id = newId();
  const now = nowISO();
  const conn = db();
  const tx = conn.transaction(() => {
    conn
      .prepare(
        `INSERT INTO threads (id, project_id, scope, title, tension_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.projectId, input.scope, input.title, input.tensionId ?? null, now);
    if (input.openingMessages) {
      for (const m of input.openingMessages) {
        conn
          .prepare(
            `INSERT INTO thread_messages
              (id, thread_id, author_id, author_kind, body, is_decision, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            newId(),
            id,
            m.authorId,
            m.authorKind,
            m.body,
            m.isDecision ? 1 : 0,
            nowISO()
          );
      }
    }
  });
  tx();
  return {
    id,
    projectId: input.projectId,
    scope: input.scope,
    title: input.title,
    status: 'active',
    tensionId: input.tensionId ?? null,
    createdAt: now,
    resolvedAt: null,
  };
}

export async function resolveThread(id: string): Promise<Thread | null> {
  const now = nowISO();
  db()
    .prepare(
      `UPDATE threads SET status = 'resolved', resolved_at = ? WHERE id = ?`
    )
    .run(now, id);
  return getThread(id);
}

// ─── Messages ──────────────────────────────────────────────

export async function listMessages(threadId: string): Promise<ThreadMessage[]> {
  const rows = db()
    .prepare(
      `SELECT * FROM thread_messages WHERE thread_id = ? ORDER BY created_at ASC`
    )
    .all(threadId) as MessageRow[];
  return rows.map(rowToMessage);
}

export type CreateMessageInput = {
  threadId: string;
  authorId: string;
  authorKind: ThreadMessageKind;
  body: string;
  isDecision?: boolean;
  decisionPayload?: { selectedOptionKey: string } | null;
};

export async function createMessage(
  input: CreateMessageInput
): Promise<ThreadMessage> {
  const id = newId();
  const now = nowISO();
  db()
    .prepare(
      `INSERT INTO thread_messages
        (id, thread_id, author_id, author_kind, body, is_decision, decision_payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.threadId,
      input.authorId,
      input.authorKind,
      input.body,
      input.isDecision ? 1 : 0,
      input.decisionPayload ? JSON.stringify(input.decisionPayload) : null,
      now
    );
  return {
    id,
    threadId: input.threadId,
    authorId: input.authorId,
    authorKind: input.authorKind,
    body: input.body,
    isDecision: !!input.isDecision,
    decisionPayload: input.decisionPayload ?? null,
    createdAt: now,
  };
}
