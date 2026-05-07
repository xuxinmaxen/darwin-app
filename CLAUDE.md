# Darwin · 多人意图合成

> 第一个把多人意图作为头等输入、AI 作为意图调和者的协作生成产品。
> 真人贡献目的、品味、约束；Agent 贡献视角、执行、规模；两者在同一画布上协作。

## 给 Claude / 任何 AI 协作者的工作约定

### 第一性原理
1. **协作的最小单位是 Intent，不是产物或 prompt**。所有功能围绕"如何让多人 Intent 合成为单一产物"展开
2. **AI 是调和者，不是决策者**。AI 抽取意图、显性化冲突、提议方案；人类拥有最终仲裁权
3. **冲突是头等对象**。Tension 不是错误而是事件,必须显性化、可讨论、可仲裁、可留痕
4. **产物即语言**。所有协作发生在产物上,不在元数据上。少弹模态、少配置项、多在画布上做事
5. **Agent 是同事**。有人设、有时间、有权限、有学习历史。不要做成"按钮叠加 AI"

### 不要做
- ❌ 让用户填 type/scope/weight 表单 —— AI 后台抽取,永不暴露 schema
- ❌ 弹"恭喜你完成了"类自满弹窗 —— 产物本身要让人想分享才是真奖赏
- ❌ "暗黑酷炫"风格 —— 这是协作产品,浅色专业为主（参考 Linear / Anthropic）
- ❌ 引入 ORM 或大型状态管理库 —— Next.js + React 19 + Server Components 自带的够用
- ❌ Claude prompt 里写"You are a helpful assistant" —— system prompt 必须是 Darwin 业务语言

### 一定要做
- ✅ 写代码前先看 `docs/architecture.md` 和 `docs/v1-spec.md`,按 V1 范围做
- ✅ Intent / Tension / Version 数据结构改动,先改 `src/lib/types.ts` 再改使用方
- ✅ Claude API 调用统一通过 `src/lib/claude.ts`,不散落在路由里
- ✅ UI 用 Tailwind utility class,不写孤立 CSS
- ✅ 所有 LLM 提示词放 `src/lib/prompts/`,每个文件一个 prompt,便于版本化
- ✅ 商业敏感判断（费用、隐私）必须在服务端,前端只负责展示

## ⚠️ Next.js 16 注意事项
当前用 Next.js 16 + React 19,有 breaking changes。写代码前查 `node_modules/next/dist/docs/`。常见变化:
- App Router 是默认（不用 Pages Router）
- Server Components 是默认,客户端组件需 `'use client'`
- `params` / `searchParams` 在 dynamic routes 里是 Promise

## 技术栈

| 层 | 技术 | 原因 |
|---|---|---|
| 前端 | Next.js 16 App Router + React 19 + TS | 全栈一个 repo |
| 样式 | Tailwind CSS 4 | utility-first,与 demo 风格一致 |
| API | Next.js Route Handlers | 不另起 server |
| AI | `@anthropic-ai/sdk` (Claude Sonnet 4.6 默认) | 团队主用 |
| 数据库 | Supabase (Postgres + Realtime) | 免运维 + 实时 |
| 部署 | Vercel + Supabase | git push 自动部署 |

## 项目结构

```
darwin-app/
├── src/
│   ├── app/
│   │   ├── page.tsx                # 工作台
│   │   ├── projects/[id]/page.tsx  # 项目详情
│   │   └── api/
│   │       ├── extract/route.ts    # 一句话 → Intent
│   │       ├── render/route.ts     # Intent[] → 产物
│   │       └── tensions/route.ts   # 冲突检测/解决
│   ├── components/
│   ├── lib/
│   │   ├── types.ts
│   │   ├── claude.ts
│   │   ├── prompts/
│   │   └── supabase/
│   └── styles/
├── public/
│   └── demo.html                   # v0 mock demo（保留作 /demo）
├── docs/
│   ├── architecture.md
│   └── v1-spec.md
├── .env.example
└── CLAUDE.md
```

## 开发命令

```bash
npm run dev    # localhost:3000
npm run build  # 生产构建
npm run start  # 启动生产 server
```

## 演进路径

- **v0** ✅ 静态 mock demo (`/demo` 路径)
- **v1** 🚧 单人 Intent → Claude 抽取 → HTML 产物（验证意图层）
- **v2** 多人实时 + Tension 检测 + 决策留痕
- **v3** Agent 对话（Atlas/Lyra）+ 多 Adapter
- **v4** 团队记忆 + 影子 Agent + 学习
