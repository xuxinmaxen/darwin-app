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
