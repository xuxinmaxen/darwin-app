import { db, assertOk, newId, nowISO } from './db';

export type Version = {
  id: string; projectId: string; format: string; content: string;
  intentIds: string[]; createdAt: string; publishedAt: string | null;
  source?: 'llm' | 'template';
};
export type VersionMeta = Omit<Version, 'content'>;

type VersionRow = {
  id: string; project_id: string; format: string; content: string;
  intent_ids: string; created_at: string; published_at: string | null;
};

function rowToVersion(row: VersionRow): Version {
  let intentIds: string[] = [];
  try { intentIds = JSON.parse(row.intent_ids); } catch { /* ignore */ }
  return { id: row.id, projectId: row.project_id, format: row.format, content: row.content,
    intentIds, createdAt: row.created_at, publishedAt: row.published_at ?? null };
}

export async function getLatestVersion(projectId: string): Promise<Version | null> {
  const { data, error } = await db().from('versions').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToVersion(data as VersionRow) : null;
}

export async function listVersions(projectId: string): Promise<Version[]> {
  const result = await db().from('versions').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
  return assertOk(result).map(rowToVersion);
}

export async function listVersionsMetadata(projectId: string): Promise<VersionMeta[]> {
  const result = await db().from('versions').select('id, project_id, format, intent_ids, created_at, published_at').eq('project_id', projectId).order('created_at', { ascending: true });
  return assertOk(result).map(row => {
    let intentIds: string[] = [];
    try { intentIds = JSON.parse((row as VersionRow).intent_ids); } catch { /* ignore */ }
    return { id: (row as VersionRow).id, projectId: (row as VersionRow).project_id, format: (row as VersionRow).format,
      intentIds, createdAt: (row as VersionRow).created_at, publishedAt: (row as VersionRow).published_at ?? null };
  });
}

export async function publishVersion(projectId: string, versionId: string): Promise<Version> {
  const target = await getVersionById(versionId);
  if (!target || target.projectId !== projectId) throw new Error('version not found');
  const now = nowISO();
  // Clear published_at on all versions for this project, then set on target
  await db().from('versions').update({ published_at: null }).eq('project_id', projectId);
  assertOk(await db().from('versions').update({ published_at: now }).eq('id', versionId));
  return { ...target, publishedAt: now };
}

export async function getPublishedVersion(projectId: string): Promise<Version | null> {
  const { data, error } = await db().from('versions').select('*').eq('project_id', projectId).not('published_at', 'is', null).order('published_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToVersion(data as VersionRow) : null;
}

export async function getVersionById(versionId: string): Promise<Version | null> {
  const { data, error } = await db().from('versions').select('*').eq('id', versionId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToVersion(data as VersionRow) : null;
}

export async function rollbackTo(projectId: string, sourceVersionId: string): Promise<Version> {
  const source = await getVersionById(sourceVersionId);
  if (!source || source.projectId !== projectId) throw new Error('source version not found');
  return createVersion({ projectId, format: source.format, content: source.content, intentIds: source.intentIds });
}

export async function countVersions(projectId: string): Promise<number> {
  const { count, error } = await db().from('versions').select('*', { count: 'exact', head: true }).eq('project_id', projectId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type CreateVersionInput = { projectId: string; format: string; content: string; intentIds: string[] };

export async function createVersion(input: CreateVersionInput): Promise<Version> {
  const id = newId();
  const now = nowISO();
  assertOk(await db().from('versions').insert({
    id, project_id: input.projectId, format: input.format,
    content: input.content, intent_ids: JSON.stringify(input.intentIds), created_at: now,
  }));
  return { id, projectId: input.projectId, format: input.format, content: input.content,
    intentIds: input.intentIds, createdAt: now, publishedAt: null };
}
