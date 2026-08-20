# Codeg

[![Release](https://img.shields.io/github/v/release/xintaofei/codeg)](https://github.com/xintaofei/codeg/releases)
[![Docs](https://img.shields.io/badge/docs-docs.codeg.app-3451b2)](https://docs.codeg.app)
[![License](https://img.shields.io/github/license/xintaofei/codeg)](./LICENSE)

<p>
  <strong>简体中文</strong> |
  <a href="./docs/readme/README.zh-TW.md">繁體中文</a> |
  <a href="./docs/readme/README.ja.md">日本語</a> |
  <a href="./docs/readme/README.ko.md">한국어</a> |
  <a href="./docs/readme/README.es.md">Español</a> |
  <a href="./docs/readme/README.de.md">Deutsch</a> |
  <a href="./docs/readme/README.fr.md">Français</a> |
  <a href="./docs/readme/README.pt.md">Português</a> |
  <a href="./docs/readme/README.ar.md">العربية</a>
</p>

Codeg（Code Generation）是一个多智能体编码工作台：把所有 AI 编码智能体收进同一个地方 —— 并让它们协同工作。

它将所有受支持智能体 CLI 的会话聚合进一个可搜索的工作区，让主智能体在同一个任务内委派给其它类型的子智能体。不想守着做完的活，可以写进待办任务：每个任务待在自己的分支上无人值守地跑，做完了等你验收才落地。Codeg 可作为桌面应用、独立服务器或 Docker 容器运行；内置十四个智能体，你也可以自行注册任何其它兼容 ACP 的智能体。

![工作区](./docs/images/workspace-light.png#gh-light-mode-only)
![工作区](./docs/images/workspace-dark.png#gh-dark-mode-only)

## 关于本分支

本仓库基于 [xintaofei/codeg](https://github.com/xintaofei/codeg) 进行二次开发，并遵循原项目的 Apache-2.0 许可证。本分支保留了 Codeg 多智能体编码工作台的核心能力，并针对使用体验、智能体兼容性和发布流程进行了调整。

### 本分支的主要改动

- 改进会话管理：增加未读标记、可配置的状态颜色与操作、侧边栏优化，以及“添加到会话”能力
- 改进智能体选择：记住上次使用的智能体，在新建会话时直接显示模型选项，并更新智能体图标
- 扩展智能体兼容性：集成 Qoder 及其设置面板，支持 Grok 标题本地化、Pi 命令输出，并提升中文等 CJK 文本后触发 `@` 提及的可靠性
- 改进本地文件与产物处理：支持从消息中打开引用的产物，并增强本地路径与 Windows 路径兼容性
- 为 Web 部署增加 PWA 支持
- 调整发布流程：支持未签名构建与服务器安装包，修复 Docker 发布标签，并更新应用图标

## 📖 文档

**完整文档见 [docs.codeg.app](https://docs.codeg.app)** — [快速开始](https://docs.codeg.app/zh/getting-started/) · [指南](https://docs.codeg.app/zh/guide/) · [参考](https://docs.codeg.app/zh/reference/)

## 🤖 支持的 Agent

Claude Code · Codex · Gemini · OpenClaw · OpenCode · Cline · Hermes · CodeBuddy · Kimi Code · Pi · Grok · Cursor · DeepSeek Harness · Qoder

其中大部分 Codeg 都能替你安装、锁定版本并更新。完整名单、各自的运行环境要求以及会话在磁盘上的存放位置，见 [支持的智能体](https://docs.codeg.app/zh/guide/supported-agents)。

名单之外的呢？自己加就行。从公开的 ACP 注册表里挑一个，或者粘贴它的 distribution JSON，Codeg 会安装它、预检它能否启动，然后像对待内置智能体一样对待它——出现在选择器里，接受 `@` 委派与技能配置；即便这个智能体本身不留下任何历史，它的会话也会被记录下来并可搜索。→ [自定义智能体](https://docs.codeg.app/zh/guide/custom-agents)

## 🤝 多智能体协作

多智能体协作，从此只需一个按键：输入 `@`，选中智能体，发送。剩下的调度全交给 Codeg —— 它把每个被提及的智能体拉起为独立会话，交付任务，再把工作实时汇流回你正在进行的对话。提及两个，它们就并肩开工：Claude Code 起草，Codex 同步评审。不用来回切换上下文，也不必在多个终端之间复制粘贴。

如果智能体自己派出了子智能体——Claude Code、Codex、Grok 与 OpenCode 都会——每个子智能体都有一张边跑边填的卡片，而不是等结束后一次性出现。点开就能读它自己的那个会话。

![在单个 Codeg 会话中将任务委派给子智能体](./docs/images/collaboration-light.gif#gh-light-mode-only)
![在单个 Codeg 会话中将任务委派给子智能体](./docs/images/collaboration-dark.gif#gh-dark-mode-only)

## ✅ 待办任务

不是每件事都得你盯着做完。写下来就行——标题、说明、用哪个智能体跑——Codeg 会给它**一份独立的代码副本**：项目旁边的一个 git 工作树，跑在自己的分支上。几个任务同时开工也互不干扰，更不会碰你手头那份代码。可以约在今晚开始，也可以让某个文件夹自己按并发上限一件件处理下去。

做完的任务不会自己合并。它会移到待验收那一栏等着你：看 diff、打回去再做一轮，或者点通过——然后由智能体来落地，先把基础分支并进它的工作树、在那里解完冲突。之后 Codeg 不听智能体一面之词，而是自己去核对 git：确认不了的合并会退回待验收，而不是报一句成功。

![待办任务看板：任务从「待办」经「进行中」走到「完成」](./docs/images/task-light.png#gh-light-mode-only)
![待办任务看板：任务从「待办」经「进行中」走到「完成」](./docs/images/task-dark.png#gh-dark-mode-only)

## 🪟 分屏

一条标签栏不总是够用。右键点击会话标签，即可把视图**向右**或**向下**拆分，想拆几次就拆几次：左右两栏、上下三格，或者一整片网格。每个分组都是独立的工作区——自己的标签、自己的标题栏、自己的新建会话按钮——所以左边这格可以让 Claude Code 重构，右边那格让 Codex 审阅 diff。

把标签从一个分组拖到另一个分组，它的会话在搬家途中也不会中断；拖动两个分组之间的分隔条，就能改变它们分配空间的方式。布局会按工作区记住，草稿也包含在内：重新打开 Codeg，拆分原样回来，没发出去的文字还在输入框里。

![把会话区拆分成标签分组构成的网格](./docs/images/split-light.gif#gh-light-mode-only)
![把会话区拆分成标签分组构成的网格](./docs/images/split-dark.gif#gh-dark-mode-only)

## 📄 Office 文档

让智能体做一份演示、一份报告或一张表，它交付的是真正的 `.pptx` / `.docx` / `.xlsx` —— 右侧面板同时实时渲染。每一次改动都会自己落进预览：幻灯片逐页成形，表格逐步铺开，数字落入单元格。第 4 页不满意？下一条消息说一声就行 —— 智能体原地改同一个文件，预览随即跟上。无需导出，无需外部 Office 应用，全程不用离开 Codeg。

![智能体编辑 Office 文档，旁边是实时预览](./docs/images/office-light.png#gh-light-mode-only)
![智能体编辑 Office 文档，旁边是实时预览](./docs/images/office-dark.png#gh-dark-mode-only)

## 💻 工作区

一个工作区，容纳所有智能体。无论正在干活的是 Claude Code、Codex 还是 Cursor，它们都在同一个编辑器、同一套实时 diff、同一个 Git 客户端里工作，而产出的是你仓库里真实的文件，就在你眼前变化。还可以把别的目录挂进来——共用的库、隔壁的服务、文档仓库——文件树、搜索与智能体本身都把它们当作同一个工作区。

**会话**：把你已有的历史一并接管 —— 所有已安装智能体的过往会话，一键导入，并可从中断处继续。进来之后它们不再是彼此隔绝的孤岛 —— `@` 提及一个旧会话，你正在对话的智能体就能读到它，哪怕那是另一个智能体留下的，于是今天的 Codex 能接着上周 Claude Code 停下的地方往下做。无论一个会话攒得多长，打开时都先呈现最近几轮，剩下的随你往上翻再逐段补齐。

**文件**：智能体的改动会以 diff 的形式，随着落盘即时呈现在对话旁边。任意文件都能在带语法高亮的真实编辑器里打开，用 `⌘L` 把整个文件（或仅一段选区）直接交给智能体，Markdown、HTML、图片与 Office 文档也都在同一面板内预览。

**Git**：一个完整的客户端，而不只是状态展示 —— 在「更改」标签页里直接提交（写一句话，回车即可），旁边就是拉取、抓取、推送与贮藏，历史里还标着每条提交推没推出去。新建分支、合并、变基、重置、与另一个分支比较，也能不切过去就更新或推送任意分支。遇到冲突会打开三栏合并编辑器，逐块采纳或自己动手写。而工作树把并行开发压缩成一个动作 —— 新分支、独立目录，外加一个扎根其中的新会话，于是一队智能体可以同时开发不同功能，谁也不碰谁的文件。

**出问题的时候**：回合失败了不会只说一句「出错了」—— Claude Code 与 Codex 会说清是哪一类：连接问题、登录问题、额度用尽、请求被拒、服务异常 —— 并在输入框下方留一条提示，只放真正帮得上忙的按钮：重试、去登录，或者新建会话。智能体自己在重试时显示为琥珀色，回合正常结束后收敛成一行「已恢复」。输入框下面那个连接状态图标也是个按钮：点开就能看到这个会话的真实状态，还有一个会恢复而不是重开的「重新连接」。

## ✨ 核心亮点

- **[会话聚合](https://docs.codeg.app/zh/guide/aggregation)** — 把所有受支持智能体的会话导入统一、可搜索的工作区，并从上次中断处继续
- **[多智能体协作](https://docs.codeg.app/zh/guide/multi-agent)** — `@` 提及任意智能体即可委派：不同类型的子智能体各自作为独立会话，在同一个任务内并行运行
- **[待办任务](https://docs.codeg.app/zh/guide/tasks)** — 把要做的事写下来，智能体一件件做完；每个任务在自己的工作树里跑，只有你验收之后才会合进你的分支
- **[自定义智能体](https://docs.codeg.app/zh/guide/custom-agents)** — 从公开注册表或 distribution JSON 注册任何其它兼容 ACP 的智能体；Codeg 负责安装、记录历史，并像内置智能体一样对待它
- **[工作区](https://docs.codeg.app/zh/guide/workspace)** — 智能体旁边就是完整的工程闭环：文件树、编辑器与 diff、Git 变更、提交、内置终端，以及[挂进同一个工作区的多个文件夹](https://docs.codeg.app/zh/guide/workspace#work-across-several-folders)
- **[分屏](https://docs.codeg.app/zh/guide/workspace#split-the-conversation-view-into-groups)** — 把会话区拆成任意多个标签分组，在分组之间拖动标签与分隔条，重启后布局（含草稿）原样回来
- **[Git 与 Worktree](https://docs.codeg.app/zh/guide/git)** — 查看并提交变更、管理 Git 远程账号，用内置 `git worktree` 流程并行开发
- **[Token 用量](https://docs.codeg.app/zh/guide/token-usage)** — 状态栏计数器背后是一整份报告：趋势与缓存命中率、活跃热力图，以及按文件夹、智能体、模型与会话的分项
- **[消息渠道](https://docs.codeg.app/zh/guide/chat-channels)** — 在 Telegram、飞书、微信里直接驱动智能体：创建任务、批准权限、实时接收进展
- **[自动化](https://docs.codeg.app/zh/guide/automations)** — 把配置好的输入框存成可复用的自动化任务，按 cron 计划或手动触发、无界面运行——可以开一个会话，也可以留一条待办任务等你验收
- **[Office 文档](https://docs.codeg.app/zh/guide/office)** — 通过内置 `officecli` 创建、分析、校对和编辑 `.docx` / `.xlsx` / `.pptx`，并在标签页内实时预览
- **[科学研究](https://docs.codeg.app/zh/guide/research)** — 内置科研技能（假设生成、实验设计、统计、可视化、批判性评估、文献检索），任意智能体均可调用
- **[项目启动器](https://docs.codeg.app/zh/guide/project-boot)** — 可视化创建新项目并实时预览，创建完直接在工作区打开
- **[MCP](https://docs.codeg.app/zh/guide/mcp) & [技能](https://docs.codeg.app/zh/guide/skills)** — 本地服务器扫描 + 市场搜索/安装，技能支持全局与项目级管理
- **[外观自定义](https://docs.codeg.app/zh/reference/settings/appearance)** — 十二套主题都能逐个色彩 token 重新调色、全局设定圆角大小、以 shadcn JSON 导入导出主题，或者干脆自己写 CSS
- **[桌面端、服务器与 Docker](https://docs.codeg.app/zh/getting-started/deployment)** — 原生桌面应用、可用浏览器访问的独立 `codeg-server`，或者 `docker compose up`

## 📦 安装与运行

**桌面端** — 从 [Releases](https://github.com/xintaofei/codeg/releases) 下载 macOS、Windows 或 Linux 的安装包，再按 [安装](https://docs.codeg.app/zh/getting-started/installation) 操作。

**服务器** — 无界面运行 Codeg，用任意浏览器访问。Linux 或 macOS：

```bash
curl -fsSL https://raw.githubusercontent.com/xintaofei/codeg/main/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Windows（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/xintaofei/codeg/main/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

**Docker** — 同一个服务器，装进一个容器：

```bash
docker run -d -p 3080:3080 -v codeg-data:/data ghcr.io/xintaofei/codeg:latest
```

Compose、预编译二进制、源码构建与就地升级见 [部署](https://docs.codeg.app/zh/getting-started/deployment)；环境变量见 [配置](https://docs.codeg.app/zh/getting-started/configuration)。想构建 Codeg 本身：[开发](https://docs.codeg.app/zh/reference/development) 与 [架构](https://docs.codeg.app/zh/reference/architecture)。

## 🔒 隐私与安全

- 默认本地优先：解析、存储与项目操作都在本地完成 —— 仅在用户主动触发时才访问网络
- Web 模式与服务器模式均使用基于令牌的身份认证
- 支持系统代理，适配企业网络环境

详见 [隐私与安全](https://docs.codeg.app/zh/reference/privacy)。

## 🙏 鸣谢

- [Codeg](https://github.com/xintaofei/codeg) 及其贡献者：本分支基于该项目进行二次开发
- [Agent Client Protocol](https://agentclientprotocol.com)：Codeg 得以连接所有受支持智能体的基础
- [Superpowers](https://github.com/obra/superpowers)：为 Codeg 的专家技能模块提供支持
- [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI)：为 Codeg 的 Office 文档工作流提供支持
- [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills)：为 Codeg 的科学研究技能提供支持（MIT 许可的子集）

## 📜 许可证

Apache-2.0，详见 [LICENSE](./LICENSE)。
