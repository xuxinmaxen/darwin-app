import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Darwin · 多人意图合成',
  description:
    '多人意图合成。让团队的判断被 AI 合成为一份共鸣的产物。',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
