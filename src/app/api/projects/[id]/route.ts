/**
 * /api/projects/[id]
 *
 * GET     — fetch a single project
 * PATCH   — update project name / background / status
 * DELETE  — remove a project (cascades to intents/tensions/versions via FK)
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getProject, deleteProject, updateProject, setCollaborators } from '@/lib/projects';
import { currentUserId } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const project = await getProject(id);
    if (!project) {
      return NextResponse.json(
        { ok: false, error: 'Project not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, project });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  type: z.enum(['html', 'ppt', 'doc', 'design']).optional(),
  // 与 POST /api/projects 对齐: 容纳导入 HTML / 长文档
  background: z.string().max(60000).nullable().optional(),
  status: z
    .enum(['draft', 'collaborating', 'tension', 'converged', 'published'])
    .optional(),
  conflictMode: z.enum(['discuss', 'ai_decide']).optional(),
  collaboratorIds: z.array(z.string()).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Invalid request: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }
  if (Object.keys(body).length === 0) {
    return NextResponse.json(
      { ok: false, error: 'no fields to update' },
      { status: 400 }
    );
  }
  try {
    const project = await updateProject(id, body);
    if (body.collaboratorIds !== undefined) {
      const ownerId = await currentUserId();
      await setCollaborators(id, ownerId, body.collaboratorIds);
    }
    revalidatePath('/');
    revalidatePath(`/projects/${id}`);
    return NextResponse.json({ ok: true, project });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await deleteProject(id);
    revalidatePath('/');
    revalidatePath('/memory');
    revalidatePath('/employees');
    revalidatePath(`/projects/${id}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
