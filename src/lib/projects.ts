/**
 * Project queries (Supabase).
 *
 * Server-only — uses service role client. Never import this file from a
 * Client Component.
 */

import { supabaseAdmin } from './supabase/server';
import type {
  Project,
  ProjectType,
  ConflictMode,
  ProjectStatus,
} from './types';

// ─── DB row → Project shape ────────────────────────────────

type ProjectRow = {
  id: string;
  name: string;
  type: string;
  background: string | null;
  conflict_mode: string;
  status: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ProjectType,
    background: row.background,
    conflictMode: row.conflict_mode as ConflictMode,
    status: row.status as ProjectStatus,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Queries ───────────────────────────────────────────────

export async function listProjects(ownerId?: string): Promise<Project[]> {
  const db = supabaseAdmin();
  let query = db
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false });
  if (ownerId) query = query.eq('owner_id', ownerId);
  const { data, error } = await query;
  if (error) throw new Error(`listProjects: ${error.message}`);
  return (data as ProjectRow[]).map(rowToProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getProject(${id}): ${error.message}`);
  return data ? rowToProject(data as ProjectRow) : null;
}

export type CreateProjectInput = {
  name: string;
  type: ProjectType;
  background?: string | null;
  conflictMode?: ConflictMode;
  ownerId: string;
};

export async function createProject(
  input: CreateProjectInput
): Promise<Project> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('projects')
    .insert({
      name: input.name,
      type: input.type,
      background: input.background ?? null,
      conflict_mode: input.conflictMode ?? 'discuss',
      status: 'draft',
      owner_id: input.ownerId,
    })
    .select('*')
    .single();
  if (error) throw new Error(`createProject: ${error.message}`);
  return rowToProject(data as ProjectRow);
}

export async function deleteProject(id: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from('projects').delete().eq('id', id);
  if (error) throw new Error(`deleteProject(${id}): ${error.message}`);
}
