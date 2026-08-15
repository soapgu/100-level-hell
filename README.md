# 是男人就下100层

经典纵向下落小游戏的原创 Web 复刻。使用 Vite、React、TypeScript 和 Canvas 实现，支持固定时间步物理、五类特殊平台、生命值、层数记录和本机最高分。

## 本地运行

要求 Node.js 22.13 或更高版本。

```bash
npm ci
npm run dev
```

浏览器打开终端给出的本地地址。使用 `←` / `→` 或 `A` / `D` 移动，按 `P` 或 `Esc` 暂停。

## 验证

```bash
npm test
npm run lint
npm run build
```

游戏图形和音效均为原创实现，不包含《NS-SHAFT》的原始程序或美术素材。

## GitHub Pages

`main` 分支更新后，GitHub Actions 会自动测试、构建并发布到：

<https://soapgu.github.io/100-level-hell/>

仓库的 **Settings → Pages → Build and deployment → Source** 需要设置为 **GitHub Actions**。
