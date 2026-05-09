/**
 * GET   /api/projects/:id/collaborators  — 列出当前协作者 (Employee[])
 * PATCH /api/projects/:id/collaborators  — 整体替换协作者列表
 *
 * Body (PATCH): { collaboratorIds: string[] }
 *   - owner 总是隐式包含,前端不传
 *   - 不在列表里的现有协作者会被移除
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  getProject,
  listCollaborators,
  setCollaborators,
} from '@/lib/projects';

const Patch = z.object({
  collaboratorIds: z.array(z.string()),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json(
      { ok: false, error: 'project not found' },
      { status: 404 }
    );
  }
  const collaborators = await listCollaborators(id);
  return NextResponse.json({ ok: true, collaborators });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  let body: z.infer<typeof Patch>;
  try {
    body = Patch.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '请求格式不对' },
      { status: 400 }
    );
  }

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json(
      { ok: false, error: 'project not found' },
      { status: 404 }
    );
  }

  try {
    await setCollaborators(id, project.ownerId, body.collaboratorIds);
    const collaborators = await listCollaborators(id);
    revalidatePath(`/projects/${id}`);
    revalidatePath('/');
    return NextResponse.json({ ok: true, collaborators });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
