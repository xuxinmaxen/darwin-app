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
6. **修改是手术,不是重画 (Surgical-Edit Rule)**。任何 v2+ 的合成都必须只动用户当条新 intent 明确点名的区域,其余 byte-for-byte 保留 v1。系统层面 fail-safe: 输出 bytes 不在 existing 的 80%-120% 区间 → 抛弃 LLM 输出,保留上一版不变 (entrypoint: [src/lib/synthesize.ts `checkIncrementalOutput`](src/lib/synthesize.ts))。绝不允许"我以为这样更好看"式无名义重写; 用户没说改的就是不改。

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

## Git 与部署（本项目专属，覆盖全局规则）

> 全局 `~/.claude/CLAUDE.md ## Git 与部署` 默认要求"等用户说才 push / 部署"。
> 在 Darwin 项目里**反过来**：改完默认直接推 + 部署，不再问。

代码改动结束 + 本地 `npm run build` 通过后，**直接按序执行**（不要在中间停下问"要不要推/部署"）：

```bash
git add <具体文件名>                                              # 不用 -A
git commit -m "<英文 message>"                                    # 简洁动作动词
git push origin main
vercel --prod --yes
vercel alias set <返回的 deployment URL> darwin.org.cn
```

最后把 deployment URL + alias 后的 darwin.org.cn 一起回报。

**例外（仍要先停下来确认）：**
- 改了 schema / 删表 / 删字段 / 删旧数据
- 改了环境变量或 secrets
- 删除已上线功能 / 改了对外 API 契约
- 大重构（≥ 5 个文件 + 跨模块）

**docs-only 改动（CLAUDE.md / README / docs/）：** 只 commit + push，不跑 vercel——没有运行时影响。

## 演进路径

- **v0** ✅ 静态 mock demo (`/demo` 路径)
- **v1** 🚧 单人 Intent → Claude 抽取 → HTML 产物（验证意图层）
- **v2** 多人实时 + Tension 检测 + 决策留痕
- **v3** Agent 对话（Atlas/Lyra）+ 多 Adapter
- **v4** 团队记忆 + 影子 Agent + 学习
