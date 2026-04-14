<p align="center">
  <h1 align="center">OpenPerfetto</h1>
  <p align="center">
    <strong>Perfetto + AI Agent 实现Trace自动化分析尝试</strong>
  </p>
  <p align="center">
    基于 <a href="https://github.com/google/perfetto">Google Perfetto</a> 深度定制，将 AI Agent 融入 Trace 分析工作流
  </p>
  <p align="center">
    <a href="#核心功能">核心功能</a> •
    <a href="#架构设计">架构</a> •
    <a href="#快速开始">快速开始</a> •
    <a href="#项目规划">规划</a> •
    <a href="#参与贡献">贡献</a>
  </p>
</p>

---

## 项目简介

OpenPerfetto 是一个基于 [Google Perfetto](https://github.com/google/perfetto) 开源项目深度定制的 **AI Trace 分析工具**。项目在保留 Perfetto 全部原生功能的基础上，集成了 AI Agent 能力，旨在实现对系统级 Trace 数据的智能化分析。

**核心目标：**

- 在 Perfetto 中直接与 AI 协作分析，无需切换工具
- 自动识别性能问题场景并进行多维度分析
- 追溯直接原因与根本原因，给出可执行的优化建议
- 分析结论与 Trace 视图联动，支持一键跳转验证

> OpenPerfetto 以 Perfetto 插件形式集成，不修改 Perfetto 核心代码路径，不破坏任何原生功能。AI 能力是"加法"，而非"替换"。

---

## 核心功能

### 架构设计

OpenPerfetto 的 AI 架构并未借助通用 Agent 框架，而是基于 Perfetto 自身的技术体系——WASM SQL 引擎、插件机制、Track 渲染系统——量身设计。核心思路：**将 AI Agent 引擎直接嵌入前端网页，每个打开的网页就是一个独立的 AI 分析实例。**

Agent 的完整运行时——包括 Agent Loop（状态机驱动的"感知→规划→执行→验证"循环）、工具调度、上下文管理——均在前端 Perfetto UI 执行，直接复用 Perfetto 内置的 WASM 引擎查询 Trace 数据，无需上传 Trace 至后端处理。后端职责收敛为 LLM 请求代理与 Skills 系统管理，保持轻量且独立可扩展。

AI 对话以可折叠侧边栏的形式融入 Perfetto UI，用户在同一界面完成 Trace 浏览与 AI 协作分析——结论中的时间戳、标记、线程引用均可直接点击跳转至 Trace 对应位置，无需在不同分析工具之间切换确认，不打破原有的分析工作流。

```
┌──────────────────── 前端（Perfetto UI）───────────────────┐
│                                                           │
│  AI Chat UI → 场景分类 → 上下文构建 → 分析计划              │
│       ↓                                                   │
│  ┌─── Agent Loop ──────────────────────────────────┐      │
│  │  LLM 决策 ⇄ Tools 工具执行 → 三层验证 → 输出结论 │      │
│  └──────────────────────────────────────────────────┘     │
│                │                                          │
│                └─→ WASM SQL 引擎（离线查询）               │
│                                                           │
└───────────────────────┬───────────────────────────────────┘
                        │ WebSocket
┌───────────────────────▼───────────────────────────────────┐
│                    后端（Node.js）                         │
│                                                           │
│  LLM 代理 ──→ 外部 LLM 服务                                │
│  Skills 系统 ──→ 20+ YAML Skill 定义                       │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

**前后端职责划分：**

| 职责 | 前端 | 后端 |
|------|:----:|:----:|
| Trace 数据存储与查询 | ✅ WASM 引擎 | — |
| Agent 状态机与调度 | ✅ | — |
| 工具执行 | ✅ | — |
| 结果验证 | ✅ | — |
| UI 交互与渲染 | ✅ | — |
| LLM 调用代理 | — | ✅ |
| Skills 管理与执行 | — | ✅ |

### AI Agent 智能分析

| 能力 | 说明 |
|------|------|
| **场景识别** | 内置 12 种预定义分析场景：冷/温/热启动、滑动卡顿、ANR、锁竞争、Binder 阻塞、IO 分析等 |
| **因果推理** | 不仅定位"哪里慢了"，还分析直接原因与根本原因 |
| **结论输出** | 给出结构化的分析结论与下一步优化方向 |
| **三层验证** | L1 规则验证（23 条启发式规则）+ L2 计划遵从检查 + L3 LLM 交叉审查（预留） |

### Agent 对话与工具调用

- 支持流式渲染的 AI 对话界面
- 工具调用过程可视化，分析过程透明可追溯
- 对话中的时间戳可点击跳转至 Trace 对应位置
- 10+ 内置工具：SQL 查询、Skill 调用、标记添加、线程置顶、视图跳转等

### Skills 系统

- **9 类 20+ YAML 定义的 Skills**，覆盖启动、滑动、ANR、Binder、锁竞争、内存、网络、功耗、通用查询等场景
- Skills 通过 YAML 低代码定义，支持 SQL 模板、参数验证、输出模式声明
- 后端独立管理，新增 Skill 无需重新构建前端

### 前端插件框架

- 可折叠侧边栏，集成 AI 对话、搜索置顶、标记管理等工具面板
- 主题切换支持

### 搜索与置顶（Search & Pin）- 侧边栏功能拓展

- **模糊搜索**：使用 `进程名+线程名` 快速定位目标线程（如 `surf+vsync`）
- **预设场景**：一键置顶常用分析场景的线程组合，支持自定义模板
- **搜索历史**：自动保存最近搜索记录，便于跨 Trace 文件复用

### 标记与跳转（Marker）- 侧边栏功能拓展

- 选中 Slice 后按 `E` 键快速标记，或在任意位置按快捷键添加标记
- 标记显示为圆形序号（①②③……），包含进程、线程、时间戳、备注等完整上下文
- 侧边栏标记列表，点击即可一键跳转至目标时间位置
- AI 分析自动生成标记，与手动标记通过图标区分

---

## 快速开始

### 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10/11（需安装 WSL2）或 Linux |
| WSL 发行版 | Ubuntu 20.04+（Windows 用户） |
| 内存 | ≥ 16 GB |
| 磁盘 | ≥ 30 GB 可用空间 |

### 1. 获取代码

```bash
git clone https://github.com/TracerQi/openperfetto.git
cd openperfetto
```

> 项目自带完整构建工具链（Node.js、Emscripten SDK、GN、Ninja 等），无需额外安装。

### 2. 安装依赖

```bash
# 安装系统基础工具（WSL 环境）
sudo apt-get update && sudo apt-get install -y python3 gcc g++ make

# 安装前端依赖
cd ui && npm install --legacy-peer-deps && cd ..

# 安装后端依赖
cd server && npm install && cd ..
```

### 3. 配置构建参数

确保 `out/ui/args.gn` 包含以下内容（不存在则创建）：

```
is_debug = false
skip_buildtools_check = true
gcc_toolchain = "/usr"
```

### 4. 编译与启动

**前端编译与启动：**

```bash
# 完整编译（含 WASM），首次约 30-60 分钟，后续增量约 5-10 分钟
bash run_build.sh

# 或仅编译前端（跳过 WASM），适用于仅修改 TypeScript/SCSS 的场景
bash start_frontend.sh
```

> 编译完成后自动启动 dev server，监听 `http://localhost:10000`。

**后端启动（新开终端）：**

后端为标准 Node.js 服务，使用 npm 命令即可启动，无需额外脚本：

```bash
cd server
npm run dev
```

> 后端服务监听 `http://localhost:3001`。后端使用 `tsx watch` 模式运行，修改代码后会自动重启。

### 5. 配置 LLM

在 `server/` 目录下创建 `.env` 文件：

```bash
# LLM API 配置（必填）
OPENAI_API_KEY=sk-your-api-key-here

# LLM API 端点（可选）
LLM_BASE_URL=https://your-llm-api-endpoint/v1

# LLM 模型名称（可选）
LLM_MODEL=your-model-name
```

### 6. 访问

浏览器打开 `http://localhost:10000`，加载 Trace 文件后即可使用 AI 分析功能。

---

## 脚本与命令说明

**前端构建脚本**（位于项目根目录，自动配置 EMSDK、Node.js 等环境变量）：

| 脚本 | 用途 | 说明 |
|------|------|------|
| `run_build.sh` | 完整编译 | 包含 WASM 编译、TypeScript 编译、Rollup 打包、启动 dev server |
| `start_frontend.sh` | 纯前端编译 | 跳过 WASM 编译，仅编译 TypeScript 和前端资源，适用于日常前端开发 |
| `kill_build.sh` | 清理进程 | 一键终止所有构建进程并清理锁文件 |

**后端常用命令**（在 `server/` 目录下执行）：

| 命令 | 用途 |
|------|------|
| `npm install` | 安装后端依赖 |
| `npm run dev` | 启动开发服务（watch 模式，代码修改自动重启） |
| `npm run build` | 编译 TypeScript 为 JavaScript（生产部署） |
| `npm start` | 启动生产服务（需先执行 build） |

---

## 项目规划分享

OpenPerfetto 目前处于积极开发阶段，以下为主要规划方向：

- **Agent 引擎优化**：状态机优化、智能重试机制、子任务并行执行
- **Skill 体系完善**：SQL 模板调优、新增 composite/pipeline 类型 Skill、更多场景覆盖
- **数据流优化**：重新设计 SQL 查询 → 数据清洗 → LLM 消费 的完整数据管道
- **上下文管理**：对话摘要压缩、长对话管理、跨会话记忆
- **通用分析子工具**：启动耗时对比拆解、负载分析、IO 拆解等专项工具
- **后端知识库**：历史案例库、源码级知识库、团队经验库
- **Tools 扩展**：Track 展开/折叠、区间选择、截图导出、数据导出等
- **插件化扩展**：支持自定义 Tool/Skill 注册、外部数据源接入、报告模板定制

## 当前状态

> **OpenPerfetto 目前仍处于概念验证（Proof of Concept）阶段，尚不具备生产级可用性。**

本项目的核心目的是验证"AI Agent 与 Perfetto 深度结合"这一技术方向的可行性与价值。当前已完成基础架构搭建和核心流程打通，但在分析质量、稳定性和工程完善度方面仍存在较大差距，主要包括：

- **分析质量参差不齐**：12 个预定义分析场景的 Skill 尚未经过针对性调优，SQL 模板精细度不足，各场景的分析准确性和深度存在较大差异
- **数据流链路存在断点**：从 SQL 查询到 LLM 消费的数据流经过多个中间环节，各环节之间可能出现数据丢失或格式异常，影响最终分析质量
- **功能稳定性待提升**：流式输出偶发中断、验证规则误判、工具重复调用、上下文信息遗漏等问题尚未完全解决
- **LLM 上下文覆盖有限**：Token 预算限制下，大规模 Trace 的上下文裁剪可能遗漏关键信息，信息密度的优化是持续课题

如果你对"AI + Trace 分析"这一方向感兴趣，欢迎参与共建，一起推动项目从概念验证走向实际可用。

---

## 技术栈

| 模块 | 技术 |
|------|------|
| 前端 UI | TypeScript、Mithril.js、SCSS |
| 前端构建 | GN + Ninja、esbuild、Rollup、tsc |
| WASM 引擎 | Emscripten（C++ → WebAssembly） |
| 后端服务 | Node.js、Fastify、TypeScript |
| 通信协议 | WebSocket |
| Skill 定义 | YAML |

---

## 参与贡献

OpenPerfetto 是一个开源项目，欢迎任何形式的贡献：

- **Star**：如果你对这个项目感兴趣，请给我们一个 Star，这是最大的鼓励
- **Issue**：提交 Bug 报告或功能建议
- **Pull Request**：代码贡献、Skill 编写、文档完善
- **讨论**：架构设计建议、新场景需求

详细的编译部署文档请参阅 [本地编译与运行指南](docs/openperfetto/build-and-run.md)。

---

## 致谢

OpenPerfetto 的诞生离不开以下项目与社区的支持：

- [**Google Perfetto**](https://github.com/google/perfetto) — Google 强大而优雅的系统级 Trace 分析工具，OpenPerfetto 的基石
- [**perfetto-mcp**](https://github.com/antarikshc/perfetto-mcp) — Perfetto MCP 集成的探索性项目，提供了宝贵的参考
- [**AndroidPerformance**](https://androidperformance.com/) — 高质量的 Android 性能优化知识社区

---

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源。
