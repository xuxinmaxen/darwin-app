import { db, assertOk, newId, nowISO } from './db';
import type { Thread, ThreadMessage, ThreadStatus, ThreadMessageKind } from './types';

type ThreadRow = {
  id: string; project_id: string; scope: string; title: string;
  status: string; tension_id: string | null; created_at: string; resolved_at: string | null;
};
type MessageRow = {
  id: string; thread_id: string; author_id: string; author_kind: string;
  body: string; is_decision: number; decision_payload: string | null; created_at: string;
};

function rowToThread(r: ThreadRow): Thread {
  return { id: r.id, projectId: r.project_id, scope: r.scope, title: r.title,
    status: r.status as ThreadStatus, tensionId: r.tension_id, createdAt: r.created_at, resolvedAt: r.resolved_at };
}
function rowToMessage(r: MessageRow): ThreadMessage {
  let payload: { selectedOptionKey: string } | null = null;
  if (r.decision_payload) { try { payload = JSON.parse(r.decision_payload); } catch { /* ignore */ } }
  return { id: r.id, threadId: r.thread_id, authorId: r.author_id,
    authorKind: r.author_kind as ThreadMessageKind, body: r.body,
    isDecision: r.is_decision !== 0, decisionPayload: payload, createdAt: r.created_at };
}

export async function listThreads(projectId: string): Promise<Thread[]> {
  const result = await db().from('threads').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
  return assertOk(result).map(rowToThread);
}

export async function getThread(id: string): Promise<Thread | null> {
  const { data, error } = await db().from('threads').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToThread(data as ThreadRow) : null;
}

export async function findThreadByTension(tensionId: string): Promise<Thread | null> {
  const { data, error } = await db().from('threads').select('*').eq('tension_id', tensionId).eq('status', 'active').maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToThread(data as ThreadRow) : null;
}

export type CreateThreadInput = {
  projectId: string; scope: string; title: string; tensionId?: string | null;
  openingMessages?: Array<{ authorId: string; authorKind: ThreadMessageKind; body: string; isDecision?: boolean }>;
};

export async function createThread(input: CreateThreadInput): Promise<Thread> {
  const id = newId();
  const now = nowISO();
  assertOk(await db().from('threads').insert({
    id, project_id: input.projectId, scope: input.scope, title: input.title,
    tension_id: input.tensionId ?? null, created_at: now,
  }));
  if (input.openingMessages?.length) {
    assertOk(await db().from('thread_messages').insert(
      input.openingMessages.map(m => ({
        id: newId(), thread_id: id, author_id: m.authorId, author_kind: m.authorKind,
        body: m.body, is_decision: m.isDecision ? 1 : 0, created_at: nowISO(),
      }))
    ));
  }
  return { id, projectId: input.projectId, scope: input.scope, title: input.title,
    status: 'active', tensionId: input.tensionId ?? null, createdAt: now, resolvedAt: null };
}

export async function resolveThread(id: string): Promise<Thread | null> {
  const now = nowISO();
  assertOk(await db().from('threads').update({ status: 'resolved', resolved_at: now }).eq('id', id));
  return getThread(id);
}

export async function listMessages(threadId: string): Promise<ThreadMessage[]> {
  const result = await db().from('thread_messages').select('*').eq('thread_id', threadId).order('created_at', { ascending: true });
  return assertOk(result).map(rowToMessage);
}

export type CreateMessageInput = {
  threadId: string; authorId: string; authorKind: ThreadMessageKind; body: string;
  isDecision?: boolean; decisionPayload?: { selectedOptionKey: string } | null;
};

export async function createMessage(input: CreateMessageInput): Promise<ThreadMessage> {
  const id = newId();
  const now = nowISO();
  const row = {
    id, thread_id: input.threadId, author_id: input.authorId, author_kind: input.authorKind,
    body: input.body, is_decision: input.isDecision ? 1 : 0,
    decision_payload: input.decisionPayload ? JSON.stringify(input.decisionPayload) : null,
    created_at: now,
  };
  assertOk(await db().from('thread_messages').insert(row));
  return { id, threadId: input.threadId, authorId: input.authorId, authorKind: input.authorKind,
    body: input.body, isDecision: !!input.isDecision, decisionPayload: input.decisionPayload ?? null, createdAt: now };
}
