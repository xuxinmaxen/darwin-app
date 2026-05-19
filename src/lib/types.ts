/**
 * Darwin · 核心数据类型
 *
 * 数据结构改动 → 先改这里 → 再改使用方
 */

// ─── Project ───────────────────────────────────────────────

export type ProjectType = 'html' | 'ppt' | 'doc' | 'design';
export type ConflictMode = 'discuss' | 'ai_decide';
export type ProjectStatus =
  | 'draft'
  | 'collaborating'
  | 'tension'
  | 'converged'
  | 'published';

export type Project = {
  id: string;
  name: string;
  type: ProjectType;
  background?: string | null;
  conflictMode: ConflictMode;
  status: ProjectStatus;
  createdAt: string; // ISO
  updatedAt: string;
  ownerId: string;
};

// ─── Intent ────────────────────────────────────────────────

export type IntentType =
  | 'Goal'
  | 'Constraint'
  | 'Preference'
  | 'Reference'
  | 'Veto';

export type IntentWeight = 'must' | 'should' | 'nice_to_have';

export type AuthorKind = 'human' | 'agent';

export type Intent = {
  id: string;
  projectId: string;
  authorId: string;
  authorKind: AuthorKind;

  /** 用户原始输入,无修改 */
  statement: string;

  /** AI 抽取后的结构化字段 */
  type: IntentType;
  /** "global" | "hero" | "pricing" | "pricing.team" | ... */
  scope: string;
  weight: IntentWeight;
  rationale?: string | null;

  /** 哪条 Intent 触发了这一条 (Agent react 用)。null = 自然产生 */
  triggerIntentId?: string | null;

  createdAt: string;
};

// ─── Tension ───────────────────────────────────────────────

export type TensionVariant = 'human' | 'agents';
export type TensionStatus = 'active' | 'resolved';

export type TensionOption = {
  key: string;        // 'A' | 'B' | 'C' | 'custom'
  title: string;
  desc: string;
};

export type TensionResolution = {
  selectedOptionKey: string;
  decidedBy: string[];      // employee ids
  decidedAt: string;
  threadId?: string | null; // 关联讨论 thread (v2: 4.13)
};

export type Tension = {
  id: string;
  projectId: string;
  scope: string;
  intentIds: string[];
  variant: TensionVariant;
  status: TensionStatus;
  options: TensionOption[];
  resolution?: TensionResolution | null;
  createdAt: string;
  resolvedAt?: string | null;
};

// ─── Thread (讨论) ─────────────────────────────────────────

export type ThreadStatus = 'active' | 'resolved';
export type ThreadMessageKind = 'human' | 'agent' | 'system';

export type Thread = {
  id: string;
  projectId: string;
  scope: string;
  title: string;
  status: ThreadStatus;
  tensionId?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
};

export type ThreadMessage = {
  id: string;
  threadId: string;
  authorId: string;            // employee.id 或 'system'
  authorKind: ThreadMessageKind;
  body: string;                // 支持简单 markdown (strong)
  isDecision: boolean;
  decisionPayload?: { selectedOptionKey: string } | null;
  createdAt: string;
};

// ─── Team Memory ───────────────────────────────────────────

export type TeamPrefIconKey =
  | 'pen'
  | 'eye'
  | 'graph'
  | 'audience'
  | 'flow'
  | 'note';

export type TeamPref = {
  id: string;
  iconKey: TeamPrefIconKey;
  category: string;            // 文案风格 / 视觉风格 / 商业策略 / 目标受众 / 协作风格
  body: string;                // 支持 markdown strong
  source: string;              // 例: 徐鑫 / 团队默认 / hero 冲突 v2
  sourceCls: string;           // 头像配色 class
  createdAt: string;
  updatedAt: string;
};

export type PrefCandidateStatus = 'pending' | 'accepted' | 'dismissed';

export type PrefCandidate = {
  id: string;
  ownerId: string;
  projectId: string;
  tensionId?: string | null;
  threadId?: string | null;
  iconKey: TeamPrefIconKey;
  category: string;
  body: string;
  sourceHint?: string | null;
  status: PrefCandidateStatus;
  acceptedPrefId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentLearning = {
  agentId: string;
  agentName: string;
  agentRole: string;
  agentCls: string;
  agentShort: string;
  isDigitalTwin: boolean;
  projectsRead: number;
  intentsContributed: number;
  tensionsTouched: number;     // 卷入的冲突数
  /** LLM 抽出的学习画像 tag (≤3 个), 还没算就为 null (UI 据此触发重算) */
  tags: string[] | null;
  /** 上次抽 tag 时的 intent 数量, UI 据此判断是否过期 */
  tagsIntentCount: number;
};

export type MemoryEventKind = 'consensus' | 'agent-event' | 'onboarding' | 'learning';

export type MemoryEvent = {
  id: string;
  kind: MemoryEventKind;
  body: string;                // 支持 markdown strong
  meta: string;                // 上下文,如 "Human ⇄ Human · 项目X"
  date: string;                // ISO
  projectId?: string | null;
};

/**
 * Agent 发布后从项目里沉淀的学习记录 (一条 = 一个 agent 对一个项目的最新理解)。
 * UNIQUE(employee_id, project_id) — 同项目再发布会 UPSERT 而不是堆历史。
 */
export type EmployeeLearning = {
  id: string;
  employeeId: string;
  projectId: string;
  summary: string;             // 1-2 句, 第三人称 ("X 学到 ...")
  highlights: string[];        // 2-5 条短语 chip
  createdAt: string;
  updatedAt: string;
};

/** Claude 抽取的原始输出（写库前的中间形态）*/
export type ExtractedIntent = Pick<
  Intent,
  'type' | 'scope' | 'weight' | 'rationale'
>;

// ─── Version (产物快照) ─────────────────────────────────────

export type ScopeContent =
  | HeroContent
  | FeaturesContent
  | PricingContent
  | CtaContent
  | Record<string, unknown>;

export type HeroContent = {
  eyebrow?: string;
  title: string;
  sub: string;
};

export type FeaturesContent = {
  items: Array<{ title: string; desc: string; icon?: string }>;
};

export type PricingContent = {
  tiers: Array<{
    name: string;
    price: string;
    sub?: string;
    items: string[];
    highlight?: boolean;
  }>;
};

export type CtaContent = {
  title: string;
  sub: string;
};

export type ProductSnapshot = {
  hero?: HeroContent;
  features?: FeaturesContent;
  pricing?: PricingContent;
  cta?: CtaContent;
  [scope: string]: ScopeContent | undefined;
};

export type Version = {
  v: number;
  projectId: string;
  label: string;
  actor: string;
  scope: string;
  snapshot: {
    content: ProductSnapshot;
    visible: Record<string, boolean>;
    prov: Record<string, string[]>;
  };
  createdAt: string;
};

// ─── API Contracts ─────────────────────────────────────────

export type ExtractRequest = {
  statement: string;
  /** Optional: project context to help AI scope correctly */
  projectId?: string;
};

export type ExtractResponse = {
  ok: true;
  intent: ExtractedIntent & { id?: string; statement: string };
} | {
  ok: false;
  error: string;
};

export type SynthesizeResponse = {
  ok: true;
  version: number;
  scopes: ProductSnapshot;
  provenance: Record<string, string[]>;
} | {
  ok: false;
  error: string;
};

export type HealthResponse = {
  ok: boolean;
  service: 'darwin';
  version: string;
  env: {
    anthropic: boolean;
    supabase: boolean;
  };
  claude: {
    hasKey: boolean;
    baseURL: string;
    modelDefault: string;
    modelOpus: string;
  };
  timestamp: string;
};
