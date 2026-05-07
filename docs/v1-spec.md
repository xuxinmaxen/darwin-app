# V1 MVP 规格

> V1 目标：**单人模式下验证「Intent Layer 是否真 work」**。
> 不做多人实时、不做 Agent、不做版本管理。一切聚焦"AI 抽取 → 合成"这条核心链路。

## 范围（In Scope）

### ✅ 必须有
1. **登录**：Supabase Auth (邮箱 magic link 即可)
2. **项目**：创建项目 / 项目列表 / 进入项目详情
3. **Intent 输入**：一个文本框,用户随便打,enter 提交
4. **Intent 抽取**：Claude 把一句话抽取为 `{ type, scope, weight, statement }`
5. **Intent 看板**：左侧列表显示已抽取的 Intent 卡片（含 AI 标签）
6. **产物画布**：基于当前所有 Intent,Claude 渲染一份 HTML 落地页
7. **重新合成**：每次新增/编辑 Intent 后,触发重新合成（手动按钮 or auto debounce）
8. **Provenance**：产物每个 section 显示来源 Intent ID

### ❌ 不做（v2+）
- 多人实时协作
- Tension 检测（v2 才有,v1 假设没冲突）
- Agent 协作者
- 版本管理 / 回滚
- 多 Adapter（v1 只有 HTML）
- 团队记忆
- 影子 Agent
- 发布 / 部署产物

## 技术决策

- 所有 LLM 调用走服务端 Route Handler
- 用 Claude Sonnet 4.6 (默认),Opus 留给 Tension 仲裁
- prompt cache 必开（system 部分稳定,可以缓存）
- 抽取/渲染两步独立,失败可重试

## API 契约

### `POST /api/projects/[id]/extract`

**Request**
```json
{
  "statement": "要传达技术专业感,目标用户是 CTO"
}
```

**Response 200**
```json
{
  "intent": {
    "id": "i_01HXYZ",
    "projectId": "p_01ABC",
    "authorId": "u_01DEF",
    "authorKind": "human",
    "statement": "要传达技术专业感,目标用户是 CTO",
    "type": "Goal",
    "scope": "global",
    "weight": "must",
    "rationale": null,
    "createdAt": "2026-04-28T..."
  },
  "raw": "<原始 Claude 响应,debug 用>"
}
```

### `POST /api/projects/[id]/synthesize`

**Request**: 无 body,服务端拉项目所有 intent 自己合成

**Response 200**
```json
{
  "version": 1,
  "scopes": {
    "hero":    { "title": "...", "sub": "...", "eyebrow": "..." },
    "features": [{ "title": "...", "desc": "..." }, ...],
    "pricing": [{ "name": "免费", "price": "¥0", ... }, ...],
    "cta":     { "title": "...", "sub": "..." }
  },
  "provenance": {
    "hero":    ["i_01", "i_02"],
    "features": ["i_01"],
    "pricing": ["i_03"],
    "cta":     ["i_01", "i_02", "i_03"]
  }
}
```

## 验收标准

V1 完成的判定：3 个真实用户用真实 Claude API 跑下面流程能跑通：

1. 注册 / 登录
2. 创建项目
3. 输入 5 条 Intent（可以涵盖：目标受众、风格倾向、必要功能、定价、CTA）
4. 看到合成的 HTML 落地页
5. 编辑/删除其中一条 Intent,产物相应变化
6. 在 Provenance 模式下能追踪每个区块由哪些 Intent 驱动

跑通即 V1 完成。

## 工程顺序

按这个顺序实现,前一步不通后面不动:

1. `src/lib/types.ts` — 把所有数据结构定下来
2. `src/lib/claude.ts` — Claude SDK 封装,调通"Hello Claude"
3. `src/lib/prompts/extract-intent.ts` — 抽取 prompt + 单测（curl）
4. `src/app/api/extract/route.ts` — Route Handler 跑通
5. Supabase schema — `projects` / `intents` 两张表
6. `src/lib/supabase/` — client + queries
7. `src/app/page.tsx` — 工作台（项目列表）
8. `src/app/projects/[id]/page.tsx` — 项目详情布局
9. Intent 输入框 + 抽取联动
10. Intent 看板（左侧）
11. `src/lib/prompts/render-html.ts` — 渲染 prompt
12. `src/app/api/synthesize/route.ts`
13. 产物画布（中央 iframe）
14. Provenance 高亮
15. 部署到 Vercel + 端到端验收

预估 1-2 周（一人一天 4 小时算）。
