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
    <html lang="zh-CN" suppressHydrationWarning>
      {/* 防止暗色模式闪烁: 在 hydration 前读 localStorage 设 data-theme */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('darwin-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
