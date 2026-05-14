/**
 * 项目详情页 (V1) — Server Component
 *
 * 拉项目元数据 + Intent 列表 + 最新一版合成结果,塞给 ProjectShell。
 */

import { notFound, redirect } from 'next/navigation';
import { getProject, listCollaborators } from '@/lib/projects';
import { listIntentsByProject } from '@/lib/intents';
import { getLatestVersion, countVersions, listVersionsMetadata } from '@/lib/versions';
import { listActiveTensions } from '@/lib/tensions';
import { getSynthesisJob } from '@/lib/synthesis-state';
import { describeLLM } from '@/lib/llm';
import { currentUser } from '@/lib/auth';
import ProjectShell from '@/components/ProjectShell';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export default async function ProjectDetailPage({ params }: Params) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const [intents, initialVersion, versionsTotal, versionsMeta, collaborators, activeTensions, initialSynthesisJob] =
    await Promise.all([
      listIntentsByProject(id),
      getLatestVersion(id),
      countVersions(id),
      listVersionsMetadata(id),
      listCollaborators(id),
      listActiveTensions(id),
      getSynthesisJob(id),
    ]);
  const llm = describeLLM();

  return (
    <ProjectShell
      project={project}
      intents={intents}
      claudeReady={llm.hasKey}
      initialVersion={initialVersion}
      versionsTotal={versionsTotal}
      versionsMeta={versionsMeta}
      collaborators={collaborators}
      activeTensions={activeTensions}
      initialSynthesisJob={initialSynthesisJob}
      currentUser={{
        id: user.id,
        name: user.name,
        role: user.role,
        cls: user.cls,
        short: user.short,
      }}
    />
  );
}
