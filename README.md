# 两分钟启动器

一个反拖延 Web 应用。它不帮你管理一长串待办，只做一件事：在你逃避的那一刻，把任务砍到一个 **2 分钟内能做完的第一步**，然后配一个 10 分钟计时器。

## 为什么是“两分钟”

拖延通常不是因为不会安排时间，而是因为开始的那一下太难受。任务在脑子里是一团模糊的大东西，身体不知道先动哪里。这个应用把“开始”拆成一个具体动作：打开书、翻到某页、写下标题、跑起程序。做完就停，也算开始。

## 功能

- **任务拆解**：输入一件正在拖的事，自动拆成 4 个微步骤，第一步不超过 2 分钟。
- **卡点匹配**：选择“任务太大 / 怕做不好 / 手机分心 / 太累 / 不想开始”，给不同的启动建议。
- **我卡住了**：把当前步骤再砍一半，重新计时 5 分钟，不指责、不记失败。
- **10 分钟计时**：可以切换 5 分钟；关闭页面再回来，计时会按真实时间继续。
- **复盘**：每天只记三件事——今天启动了什麼、哪一步最难、明天只做哪一步。
- **趋势**：最近 7 天启动次数、本周专注分钟数、卡点分布，一眼看出自己最常被什么拦住。
- **记录**：启动次数而不是连续天数，断一天不会清零。
- **可安装**：支持 PWA，手机上可以添加到主屏幕，离线也能打开。
- **离线可用**：没有配置 API key 时使用内置模板，数据只存在浏览器 localStorage。

## 运行

需要 Node.js 18 或以上。

```bash
cd two-minute-starter
npm start
```

打开 http://localhost:4173。

### 可选：接入 DeepSeek

复制 `.env.example` 为 `.env`，填入 key：

```bash
cp .env.example .env
```

```env
DEEPSEEK_API_KEY=sk-your-key-here
PORT=4173
```

重启 `npm start`。前端不会拿到 key，所有模型请求都由 `server.js` 代理。没有 key 时，拆解会自动降级为内置模板，功能不受影响。

## 部署到 GitHub Pages（免费，手机可安装）

1. 在 GitHub 新建一个**公开**仓库，例如 `two-minute-starter`，不要勾选 “Add a README”。
2. 在本目录执行：

```bash
git init
git add .
git commit -m "feat: two-minute starter"
git branch -M main
git remote add origin https://github.com/<你的用户名>/two-minute-starter.git
git push -u origin main
```

3. 打开仓库的 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
4. 等 **Actions** 里的 `Deploy to GitHub Pages` 跑完，访问：

```text
https://<你的用户名>.github.io/two-minute-starter/
```

5. 手机用 Chrome/Safari 打开这个 HTTPS 地址，浏览器菜单里选“添加到主屏幕”，就能像 App 一样使用并离线打开。

> GitHub Pages 只托管静态文件，`server.js` 不会运行。应用会自动使用内置模板拆解；如果要启用 DeepSeek 个性化拆解，需要把 `/api/breakdown` 部署到支持 Node 的平台（Vercel、Render 等），再把前端请求指向那个地址。

## 项目结构

```
two-minute-starter/
├── index.html      # 页面结构：首页 / 拆解 / 计时 / 复盘 / 记录
├── styles.css      # 视觉：深松绿底、琥珀色重点、仪表盘式计时器
├── app.js          # 状态管理、任务拆解、计时器、趋势图、localStorage
├── server.js       # 静态文件服务 + DeepSeek 代理（可选）
├── manifest.webmanifest  # PWA 清单
├── sw.js           # Service Worker，缓存应用外壳
├── icons/          # PWA 图标
├── package.json
└── .env.example
```

## 技术点

- 原生 JavaScript，无前端框架，单页视图切换。
- `localStorage` 持久化任务、会话和复盘；关闭页面不丢数据。
- 计时器用 `endAt` 时间戳而不是累加 `setInterval`，切后台或锁屏后回来仍然准确。
- PWA：manifest + Service Worker 缓存应用外壳，可添加到主屏幕并离线打开。
- 可选的 DeepSeek Function Calling / JSON 输出，服务端校验步骤数量和第一步时长。
- 所有用户输入在渲染前做 HTML 转义，避免 XSS。
- 响应式布局，支持键盘焦点和 `prefers-reduced-motion`。

## 可以写进简历的描述

**两分钟启动器（反拖延 Agent）｜个人项目｜2026.09 – 2026.10**
技术栈：JavaScript · Node.js · DeepSeek API · localStorage

- 针对“知道该做但开始不了”的场景，设计“任务拆解 → 2 分钟启动 → 10 分钟计时 → 卡点降级 → 每日复盘”的闭环。
- 实现基于关键词的任务分类和模板拆解，保证第一步不超过 2 分钟；接入 DeepSeek API 后可生成个性化步骤，无 key 时自动降级。
- 用原生 JavaScript + Node.js 实现单页应用与本地持久化，支持 PWA 安装和离线缓存；计时器基于结束时间戳，切后台或锁屏后仍准确。
- 用“启动次数”替代连续打卡，避免断签带来的挫败感；记录卡点类型并展示最近 7 天趋势。

## 面试怎么讲

1. **问题**：市面上的待办应用都在增加任务，但拖延的人缺的不是清单，是“开始”的那一下。
2. **做法**：把任务拆到 2 分钟，先让身体动起来；如果还卡，就把步骤再砍一半。
3. **技术**：原生 JS + Node 静态服务；计时器用结束时间戳；LLM 只负责拆解，失败就退回模板，保证可用性。
4. **取舍**：没有做社交、积分、排行榜，因为这些东西会让用户为了“打卡”而打卡，偏离真正目标。
5. **结果**：可以记录自己使用两周的启动次数和卡点分布，用真实数据说明效果。

## 后续可以加

- 把复盘数据做成一周趋势图。
- 接入日历，把“明天只做哪一步”自动变成第二天首页的第一件事。
- 做成 PWA，手机上添加到主屏幕。
- 加入“同伴自习室”模式，只共享计时状态，不共享任务内容。
