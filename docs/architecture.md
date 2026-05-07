# Darwin 架构

## 一、概念模型

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  人类 / Agent                                     │
│  说："要传达技术专业感,目标 CTO"                    │
│         ↓                                        │
│  ┌─────────────────────────────────────────┐    │
│  │           Intent Layer                  │    │
│  │  { type, scope, weight, statement }     │    │
│  └─────────────────────────────────────────┘    │
│         ↓                                        │
│  ┌─────────────────────────────────────────┐    │
│  │      Tension Detector                   │    │
│  │   同 scope 语义对立 → 弹仲裁卡          │     │
│  └─────────────────────────────────────────┘    │
│         ↓                                        │
│  ┌─────────────────────────────────────────┐    │
│  │       Synthesis Engine                  │    │
│  │   Intent[] + 决策记录 → 产物            │     │
│  └─────────────────────────────────────────┘    │
│         ↓                                        │
│  ┌─────────────────────────────────────────┐    │
│  │     Adapter Layer                       │    │
│  │  HTML │ PPT │ Doc │ Design              │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
└──────────────────────────────────────────────────┘
```

## 二、数据模型

### Intent
```ts
type Intent = {
  id: string                         // i_xxx
  projectId: string
  authorId: string                   // user / agent id
  authorKind: 'human' | 'agent'
  statement: string                  // 用户原话
  type: 'Goal' | 'Constraint' | 'Preference' | 'Reference' | 'Veto'
  scope: string                      // 'global' | 'hero' | 'pricing.team' ...
  weight: 'must' | 'should' | 'nice_to_have'
  rationale?: string
  createdAt: Date
}
```

### Tension
```ts
type Tension = {
  id: string
  projectId: string
  scope: string
  intentIds: string[]                // 触发冲突的 intent
  variant: 'human' | 'agents'        // human⇄human / agent⇄agent
  status: 'active' | 'resolved'
  resolution?: {
    selectedOptionKey: string        // A / B / C / custom
    decidedBy: string[]
    decidedAt: Date
    threadId: string                 // 讨论 thread
  }
  options: Array<{
    key: string
    title: string
    desc: string
  }>
}
```

### Version (产物快照)
```ts
type Version = {
  v: number
  projectId: string
  label: string
  actor: string
  scope: string
  snapshot: {
    content: ScopeContent           // 各 scope 的实际内容
    visible: Record<string,boolean>
    prov: Record<string,string[]>   // scope → intent ids
  }
  createdAt: Date
}
```

### Project
```ts
type Project = {
  id: string
  name: string
  type: 'html' | 'ppt' | 'doc' | 'design'
  background?: string
  conflictMode: 'discuss' | 'ai_decide'
  collaborators: Array<{ id: string; kind: 'human' | 'agent' }>
  status: 'draft' | 'collaborating' | 'tension' | 'converged' | 'published'
}
```

## 三、API 路由

| 路由 | 方法 | 输入 | 输出 |
|------|------|------|------|
| `/api/projects` | GET / POST | — / 项目元信息 | Project[] / Project |
| `/api/projects/[id]/intents` | GET / POST | — / 一句话 | Intent[] / Intent |
| `/api/projects/[id]/extract` | POST | `{ statement: string }` | Intent (AI 抽取) |
| `/api/projects/[id]/synthesize` | POST | — | Version (新版本快照) |
| `/api/projects/[id]/render` | POST | `{ scope, format }` | 产物 HTML/JSON |
| `/api/projects/[id]/tensions` | GET / POST | — / `{ resolution }` | Tension[] / Tension |
| `/api/projects/[id]/versions` | GET | — | Version[] |
| `/api/projects/[id]/versions/[v]/rollback` | POST | — | 当前版本切换 |

## 四、数据流：单条 Intent 进入到产物变化

1. 用户输入 statement
2. 客户端 POST `/api/projects/[id]/extract`
3. 服务端 → Claude API (`prompts/extract-intent.ts`)
4. Claude 返回结构化 Intent
5. 服务端写入 Supabase
6. Supabase Realtime 推送给同项目其他人
7. 服务端检查同 scope 是否有 conflicting intent → 如有,POST `/api/tensions` 创建 Tension
8. Tension 通过 Realtime 推送
9. 用户在 UI 决议 Tension（A/B/C 或讨论）
10. 决议写入 Supabase
11. 服务端触发 synthesize → Claude API 重渲染相关 scope
12. 新 Version 推送给所有人

## 五、目录映射

```
src/app/api/extract/route.ts        → POST: statement → Intent
src/app/api/synthesize/route.ts     → POST: → Version
src/lib/types.ts                    → 上述 TS 类型
src/lib/claude.ts                   → Claude SDK 唯一封装
src/lib/prompts/extract-intent.ts   → 抽取 prompt
src/lib/prompts/detect-tension.ts   → 冲突检测 prompt
src/lib/prompts/render-html.ts      → HTML 渲染 prompt
src/lib/supabase/client.ts          → Supabase 浏览器端
src/lib/supabase/server.ts          → Supabase 服务端
```

## 六、Realtime 通信

V1 单人不需要。V2 多人时通过 Supabase Realtime:
- `intents:project_id` channel — Intent insert/update
- `tensions:project_id` channel — Tension lifecycle
- `versions:project_id` channel — 新版本

客户端订阅,React 19 的 `use(stream)` 或 React Query 拉数据。
