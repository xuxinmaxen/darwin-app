# Darwin

> **多人意图合成。让团队的判断被 AI 合成为一份共鸣的产物。**

[![Live](https://img.shields.io/badge/live-darwin--app.vercel.app-6366F1)](https://darwin-app-virid.vercel.app)
[![v0 demo](https://img.shields.io/badge/v0-mock%20demo-blue)](https://darwin-app-virid.vercel.app/demo.html)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Darwin 是第一个把"多人意图"作为头等输入、AI 作为意图调和者的协作生成产品。

- **真人**贡献目的、品味、约束
- **Agent**贡献视角、执行、规模
- 两者在同一画布上协作

## 核心机制

| 层 | 作用 |
|---|---|
| **Intent Layer** | 用户一句话 → AI 抽取为结构化 Intent（type / scope / weight） |
| **Tension as First-class** | 同 scope 语义对立时显性化冲突,AI 提议调和方案,人仲裁 |
| **AI as Mediator** | AI 是抽取者 / 提议者,**不是决策者**。最终拍板权属于人 |
| **Format-agnostic Adapter** | 同一组 Intent 可输出落地页 / PPT / 文档 / 设计稿 |

## 演进阶段

- [x] **v0** — 静态 mock demo（[在线体验](https://darwin-app-virid.vercel.app/demo.html)）
- [x] **v1 (in progress)** — Workspace + 项目详情 + Intent CRUD（[在线体验](https://darwin-app-virid.vercel.app)）。Claude 抽取等 Hermes 解锁
- [ ] **v1 完成** — Claude 抽取上线 → HTML 产物合成
- [ ] **v2** — 多人实时 + Tension 检测 + 决策留痕
- [ ] **v3** — Agent 对话（Atlas/Lyra）+ 多 Adapter
- [ ] **v4** — 团队记忆 + 影子 Agent

## 本地开发

```bash
git clone https://github.com/xuxinmaxen/darwin-app.git
cd darwin-app
npm install
cp .env.example .env.local
# 在 .env.local 填入 ANTHROPIC_API_KEY 等
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。
访问 [http://localhost:3000/demo.html](http://localhost:3000/demo.html) 查看 v0 mock demo。

## 文档

- [`CLAUDE.md`](CLAUDE.md) — AI 协作约定 + 第一性原理
- [`docs/architecture.md`](docs/architecture.md) — 系统架构 + 数据流
- [`docs/v1-spec.md`](docs/v1-spec.md) — V1 MVP 范围 + API 契约

## 技术栈

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Claude API · Supabase · Vercel

## 名字由来

**Darwin** —— 多人意图通过冲突、讨论、共识完成自然选择,产物在持续进化。
