# OpenPerfetto 项目启动与部署文档

本文档涵盖 OpenPerfetto 项目的日常启动、增量/全量构建、远端服务器部署以及 Task #51 部署经验总结。

---

## 1. 日常启动指南

每次启动项目需要打开 **两个 WSL 终端**，分别启动前端和后端。

### 1.1 前端启动（WSL 终端 1）

```bash
cd /mnt/d/1aLq/ProFile/openperfetto
bash run_build.sh
```

`run_build.sh` 脚本内容如下：

```bash
#!/bin/bash
rm -f /mnt/d/1aLq/ProFile/openperfetto/out/ui/watch.lock
cd /mnt/d/1aLq/ProFile/openperfetto
export PATH=/mnt/d/1aLq/ProFile/openperfetto/buildtools/linux64/nodejs/bin:/mnt/d/1aLq/ProFile/openperfetto/third_party/gn:/mnt/d/1aLq/ProFile/openperfetto/third_party/ninja:/usr/bin:/bin
export EMSDK=/mnt/d/1aLq/ProFile/openperfetto/buildtools/linux64/emsdk
export EM_CONFIG=/mnt/d/1aLq/ProFile/openperfetto/buildtools/linux64/emsdk/.emscripten
export NODE_OPTIONS=--max-old-space-size=8192
node ui/build.js --no-depscheck --only-wasm-memory64 --no-override-gn-args --serve --watch 2>&1
```

**关键参数说明**：

| 参数 | 作用 |
|------|------|
| `--no-depscheck` | 跳过 pnpm 依赖检查（因 pnpm-lock.yaml 未同步） |
| `--only-wasm-memory64` | 仅编译 memory64 WASM，减少编译时间 |
| `--no-override-gn-args` | 不覆盖已有的 GN 构建参数 |
| `--serve` | 启动 HTTP 开发服务器（端口 10000） |
| `--watch` | 文件变更自动重编译 |
| `NODE_OPTIONS=--max-old-space-size=8192` | 分配 8GB 堆内存，防止 Node.js OOM |

### 1.2 后端启动（WSL 终端 2）

```bash
cd /mnt/d/1aLq/ProFile/openperfetto/server
npm run dev
```

后端使用 `tsx watch` 模式运行，修改代码会自动重启。

### 1.3 验证服务是否正常

| 服务 | 地址 | 说明 |
|------|------|------|
| 前端 UI | http://localhost:10000 | Perfetto 主界面 |
| 后端 API | http://localhost:3001 | Fastify 后端服务 |
| 健康检查 | http://localhost:3001/health | 后端健康状态 |
| WebSocket | ws://localhost:3001/ws | 前端自动连接 |

### 1.4 后端配置参考

后端配置文件位于 `server/config/default.yaml`，关键配置项：

- **服务端口**：3001（`server.port`）
- **CORS 源**：`http://localhost:10000`（前端）和 `http://localhost:3000`
- **WebSocket**：心跳间隔 30s，超时 90s，最大连接数 100
- **LLM 提供商**：支持 OpenAI（gpt-4o）和 Anthropic（claude-sonnet-4-20250514），通过环境变量 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 配置

---

## 2. 修改后重新构建指南

### 场景 A：仅修改 TypeScript / 前端代码

- 如果 `build.js` 正在 `--watch` 模式运行，**保存文件后会自动增量编译**（TSC + Rollup），无需手动操作。
- 如果已停止，重新执行 `bash run_build.sh` 即可。Ninja 会增量跳过已编译的 WASM，仅重新执行 Rollup 打包。

### 场景 B：修改后端代码

- `tsx watch` 模式**自动检测变更并重启**，无需手动操作。
- 如果已停止，重新启动即可：

```bash
cd /mnt/d/1aLq/ProFile/openperfetto/server
npm run dev
```

### 场景 C：修改 C++ / WASM 相关代码（`src/` 目录下）

- 需要重新编译 WASM，Ninja 增量编译只重编修改的文件。
- 执行 `bash run_build.sh`，Ninja 会自动判断哪些 `.o` 需要重编。

### 场景 D：修改 GN 构建文件（`BUILD.gn` 等）

- 需要重新生成 Ninja 文件。两种方式：
  1. 删除 `out/ui/args.gn` 后重新运行 `bash run_build.sh`
  2. 手动执行：`gn gen out/ui --args='...'`

### 场景 E：全量重新编译

- 删除 `out/ui/` 目录后重新运行 `bash run_build.sh`。
- 全量编译耗时较长（WASM 约 30-60 分钟，取决于机器性能）。
- **建议**：除非遇到无法解决的编译错误，否则优先使用增量编译。

### 编译建议

1. **优先使用增量编译**：Ninja 基于文件时间戳自动判断哪些目标需要重编。
2. **`.ninja_log` 损坏处理**：如果显示 "premature end of file"，Ninja 会自动恢复，重新检查所有目标的时间戳（不丢失已编译的 `.o` 文件）。
3. **WSL 性能注意**：WSL 挂载 NTFS 的 I/O 性能较低，Rollup 打包约需 10 分钟。
4. **首次构建**：建议分配充足时间（1-2 小时），后续增量编译通常很快。

---

## 3. 远端 Linux 服务器部署指南

### 3.1 服务器最低配置要求

| 项目 | 最低要求 | 推荐配置 |
|------|---------|---------|
| CPU | 4 核 | 8 核+ |
| 内存 | 16GB | 32GB（编译需要 8GB 给 Node.js） |
| 磁盘 | 50GB | 100GB SSD |
| OS | Ubuntu 20.04+ / Debian 11+ | Ubuntu 22.04 LTS |
| Python | 3.8+ | 3.10+ |
| Node.js | 18+ | 20 LTS |

### 3.2 系统依赖安装

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-dev libc6-dev gcc git curl unzip
```

### 3.3 Node.js 安装（推荐 nvm）

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### 3.4 部署步骤

**第一步：克隆代码**

```bash
git clone <仓库地址> perfetto
cd perfetto
```

**第二步：安装构建工具（GN / Ninja / Emscripten）**

```bash
tools/install-build-deps --ui --build-os linux --build-arch x64
```

**第三步：安装前端依赖**

```bash
cd ui
npm install --legacy-peer-deps
cd ..
```

**第四步：安装后端依赖**

```bash
cd server
npm install
cd ..
```

**第五步：构建前端（一次性构建，无 watch）**

```bash
export PATH=$(pwd)/buildtools/linux64/nodejs/bin:$(pwd)/third_party/gn:$(pwd)/third_party/ninja:$PATH
export EMSDK=$(pwd)/buildtools/linux64/emsdk
export EM_CONFIG=$(pwd)/buildtools/linux64/emsdk/.emscripten
export NODE_OPTIONS=--max-old-space-size=8192
node ui/build.js --no-depscheck --only-wasm-memory64 --no-override-gn-args
```

> 注意：去掉 `--serve --watch`，执行一次性构建。

**第六步：编译并启动后端**

```bash
cd server
npm run build
npm start
```

或者使用 PM2 守护进程：

```bash
npm install -g pm2
cd server
pm2 start npm --name "openperfetto-server" -- start
```

**第七步：前端静态文件托管**

前端构建产物位于 `out/ui/dist/` 目录下，使用 Nginx 托管。

### 3.5 Nginx 配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/perfetto/out/ui/dist/;
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket 代理
    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:3001;
    }
}
```

### 3.6 生产部署建议

- **前端**：使用 Nginx 托管静态文件（`out/ui/dist/`）
- **后端**：使用 PM2 或 systemd 管理进程，确保崩溃自动重启
- **LLM API Key**：设置环境变量 `OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY`
- **WebSocket 代理**：Nginx 必须配置 WebSocket 升级头（`/ws → localhost:3001`）
- **HTTPS**：生产环境建议配置 SSL 证书（Let's Encrypt）

---

## 4. Task #51 部署经验总结

本章记录 Task #51（OpenPerfetto 首次部署）的完整过程，包括重要行动、关键问题及解决方案、经验教训。

### 4.1 重要行动

按时间顺序：

1. **后端服务搭建**：基于 Node.js 20.20.2 + Fastify 5.x 搭建后端服务，监听端口 3001。
2. **WebSocket 端口统一**：将 WebSocket 端口从 8765 统一到 3001（修改 `server/src/index.ts` 和前端 `websocket_client.ts`），使后端 HTTP 与 WebSocket 共用同一端口。
3. **构建工具手动安装**：GN / Ninja / pnpm / Emscripten 因 WSL 网络问题无法自动下载，由用户在 Windows 主机下载后手动放入 WSL 路径。
4. **前端依赖安装**：使用 npm + npmmirror 镜像源替代 pnpm（解决 NTFS 权限问题和 lockfile 不同步问题）。
5. **WASM 编译**：352 个 Ninja 目标全部编译通过。
6. **SCSS 导入修复**：从 TS 直接 `import './styles.scss'` 改为 Perfetto 插件标准 SCSS 约定（使用 `styles.scss` 包装文件）。
7. **Python 3.8 兼容性修复**：`removesuffix()` 方法在 Python 3.8 中不可用，改用切片方式 `str[:-4]`。
8. **Node.js OOM 修复**：Rollup 打包大型项目超出默认堆内存，设置 `NODE_OPTIONS=--max-old-space-size=8192` 分配 8GB。

### 4.2 关键问题与解决方案

| 问题 | 根因 | 解决方案 |
|------|------|---------|
| WSL 无法下载构建工具 | WSL NAT 模式无法访问 Windows 代理 | 用户在 Windows 主机下载后放入 WSL 路径 |
| pnpm `--frozen-lockfile` 失败 | `package.json` 添加了 ts-jest 但未更新 lockfile | 使用 `--no-depscheck` 跳过检查 |
| pnpm EACCES 错误 | NTFS 挂载权限限制 | 改用 npm + `--legacy-peer-deps` |
| libc6-dev 缺失 | WSL 精简安装缺少 C 头文件 | `sudo apt-get install libc6-dev` |
| gcc 缺失 | WSL 缺少 GCC 运行时库 | `sudo apt-get install gcc` |
| Python `removesuffix` 不可用 | Python 3.8 不支持（需 3.9+） | 改用 `str[:-4]` 切片 |
| Rollup SCSS 解析失败 | 插件 `index.ts` 直接 import `.scss` | 改用 Perfetto SCSS 约定（`styles.scss` 包装文件） |
| Node.js 堆内存溢出 | Rollup 打包大型项目超出默认内存 | `NODE_OPTIONS=--max-old-space-size=8192` |
| `.ninja_log` 损坏 | 构建进程被中断 | Ninja 自动恢复，重新检查时间戳（不丢失 `.o` 文件） |

### 4.3 关键经验教训

1. **WSL I/O 性能**：WSL 挂载 NTFS 性能较低，大型项目构建耗时较长（Rollup 打包约 10 分钟）。建议条件允许时使用原生 Linux 文件系统。
2. **Ninja 增量编译可靠性**：Ninja 增量编译非常可靠，终端断开或进程中断不会丢失已编译的 `.o` 文件，恢复后可继续增量编译。
3. **环境要求严格**：Perfetto 构建系统对环境要求严格（Python 版本、C 开发头文件、Emscripten 版本等），建议使用 Ubuntu 20.04+ 原生 Linux 环境。
4. **网络问题是最大障碍**：WSL 环境中网络问题是最大障碍，提前准备好构建工具的离线包可大幅节省时间。
5. **前后端协议对齐**：WebSocket 端口和协议格式必须前后端严格一致，否则会出现连接失败但无明显错误提示的情况。
