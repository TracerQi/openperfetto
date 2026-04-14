# OpenPerfetto 本地编译与运行指南

> 本文档基于实际编译验证经验编写，记录了在 Windows 11 WSL 环境下从零编译运行 OpenPerfetto 的完整流程与注意事项。

---

## 1. 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10/11（需安装 WSL2） |
| WSL 发行版 | Ubuntu 20.04+ 或其他 Debian 系 |
| 内存 | 至少 16 GB（WASM 编译峰值约 8 GB） |
| 磁盘 | 至少 30 GB 可用空间（含 buildtools、node_modules、编译产物） |

### WSL2 安装（如尚未安装）

```powershell
wsl --install
```

安装完成后重启电脑，进入 WSL 完成初始化。

---

## 2. 获取代码

```bash
git clone https://github.com/<your-org>/openperfetto.git
cd openperfetto
```

> 项目自带所有构建工具链（`buildtools/linux64/` 下含 Node.js、Emscripten SDK、clang 等），无需额外安装编译工具。GN 和 Ninja 在 `third_party/gn` 和 `third_party/ninja` 中。

---

## 3. 首次编译

### 3.1 前置准备

**确保 WSL 中有基本的系统工具**：

```bash
sudo apt-get update
sudo apt-get install -y python3 gcc g++ make
```

> 项目自带 Node.js v20.11.0（`buildtools/linux64/nodejs/bin/node`），无需单独安装 Node。运行脚本时会自动使用自带版本。

### 3.2 安装前端依赖

```bash
cd ui
rm -rf node_modules
npm install --legacy-peer-deps
cd ..
```

> `--legacy-peer-deps` 是必需的，项目存在 peer dependency 版本差异。

### 3.3 安装后端依赖

```bash
cd server
rm -rf node_modules
npm install
cd ..
```

### 3.4 配置 GN 构建参数

首次编译需要确保 `out/ui/args.gn` 包含正确的参数：

```
is_debug = false
skip_buildtools_check = true
gcc_toolchain = "/usr"
```

**参数说明**：

| 参数 | 作用 | 为什么需要 |
|------|------|-----------|
| `is_debug = false` | Release 模式编译 | 生产级性能 |
| `skip_buildtools_check = true` | 跳过 `tools/install-build-deps` 检查 | 该脚本会校验项目路径和依赖一致性，fork 项目后通常无法通过 |
| `gcc_toolchain = "/usr"` | 指定 GCC 工具链路径 | 部分宿主工具（protoc 等）需要本地 GCC 编译 |

如果 `args.gn` 不存在，可以直接创建；如果 `gn gen` 报错，删除 `out/ui/args.gn` 后重新运行构建脚本，`build.js` 会自动生成默认配置。

### 3.5 执行前端编译

```bash
bash run_build.sh
```

**首次编译耗时约 30-60 分钟**，主要时间花在 WASM 编译（Emscripten 编译约 1000 个 C++ 源文件为 .o，再链接为 .wasm）。

编译流程如下：

```
run_build.sh
  │
  ├─ 1. 清理残留构建进程（watch.lock + pkill）
  ├─ 2. 设置环境变量（PATH、EMSDK、NODE_OPTIONS）
  └─ 3. node ui/build.js
        ├─ gn gen out/ui       → 生成 Ninja 构建文件
        ├─ ninja -C out/ui     → 编译 C++ → WASM（首次最耗时）
        ├─ protoc / pbjs       → 生成 Proto JS 绑定
        ├─ tsc --watch         → TypeScript 编译
        ├─ rollup --watch      → 打包前端资源
        └─ HTTP server         → 启动 dev server :10000
```

**编译完成标志**：终端输出 `HTTP server is listening on http://localhost:10000`

### 3.6 启动后端服务

新开一个终端：

```bash
cd server
npm run dev
```

**后端启动标志**：终端输出 `OpenPerfetto Server started`，监听 `0.0.0.0:3001`

---

## 4. 验证编译结果

### 4.1 前端验证

| 检查项 | 验证方式 | 预期结果 |
|--------|---------|---------|
| TSC 编译 | 查看 `tsc_output.txt` | 0 errors |
| Rollup 打包 | 终端无 `Could not resolve` 错误 | 无报错 |
| Dev server | `curl -s -o /dev/null -w '%{http_code}' http://localhost:10000` | 返回 `200` |
| 浏览器访问 | 打开 http://localhost:10000 | 看到 Perfetto UI 界面 |

### 4.2 后端验证

| 检查项 | 验证方式 | 预期结果 |
|--------|---------|---------|
| 服务启动 | 终端输出 `port: 3001` | 端口 3001 监听 |
| 健康检查 | `curl http://localhost:3001/api/v1/health` | 返回 `{"status":"ok",...}` |
| WebSocket | 前端 UI 连接 `ws://localhost:3001/ws` | 连接成功 |
| Skills 加载 | 终端输出 `loaded: 20, errors: 0` | 无错误 |

> 注意：后端健康检查端点是 `/api/v1/health`，而非 `/health`。

---

## 5. 后端环境配置

后端需要 LLM API 才能提供 AI 分析功能。在 `server/` 目录下创建 `.env` 文件：

```bash
# server/.env （此文件已在 .gitignore 中，不会被提交）

# LLM API 配置（必填）
OPENAI_API_KEY=sk-your-api-key-here

# LLM 基础 URL（可选，默认在 config/default.yaml 中定义）
LLM_BASE_URL=https://your-llm-api-endpoint/v1

# LLM 模型（可选，默认在 config/default.yaml 中定义）
LLM_MODEL=your-model-name
```

> `.env` 文件已在 `.gitignore` 中，不会被提交到代码库。

---

## 6. 日常开发编译

### 6.1 修改前端代码后

由于代码位于 Windows NTFS 文件系统（`/mnt/d/...`），WSL 的 `fs.watch()` 在跨文件系统挂载时**无法可靠触发**文件变更事件。因此每次修改代码后必须**手动冷启动**重新编译：

```powershell
# PowerShell 中执行：清理残留 → 启动编译
wsl bash /mnt/d/1aLq/ProFile/openperfetto/kill_build.sh
Start-Sleep -Seconds 3
wsl bash -c "rm -f /mnt/d/1aLq/ProFile/openperfetto/out/ui/watch.lock; cd /mnt/d/1aLq/ProFile/openperfetto; bash run_build.sh"
```

**按修改类型选择脚本**：

| 修改类型 | 使用脚本 | 耗时参考 |
|---------|---------|---------|
| C++/WASM 修改 | `bash run_build.sh` | 8-10 分钟 |
| 仅 TypeScript/SCSS | `bash start_frontend.sh`（含 `--no-wasm`） | 5-8 分钟 |

### 6.2 修改后端代码后

后端使用 `tsx watch` 模式运行，修改 `server/src/` 下的文件会**自动检测变更并重启**，无需手动操作。

### 6.3 修改 GN 构建文件后

需要重新生成 Ninja 构建文件：

```bash
# 方式 1：删除 args.gn 后重新运行（build.js 自动 gn gen）
rm out/ui/args.gn
bash run_build.sh

# 方式 2：手动执行 gn gen
export PATH=./third_party/gn:./third_party/ninja:$PATH
gn gen out/ui --args='is_debug=false skip_buildtools_check=true gcc_toolchain="/usr"'
bash run_build.sh
```

---

## 7. 脚本速查

| 脚本 | 用途 | 关键参数 |
|------|------|---------|
| `run_build.sh` | 完整编译（含 WASM）+ watch + serve | `--only-wasm-memory64 --serve --watch` |
| `start_frontend.sh` | 纯前端编译（跳过 WASM）+ watch + serve | `--no-wasm --only-wasm-memory64 --serve --watch` |
| `kill_build.sh` | 一键清理所有构建进程 + 锁文件 | `pkill` + `rm watch.lock` |
| `restart_dev_server.sh` | 与 `run_build.sh` 相同（别名） | 同 `run_build.sh` |

> 所有 `.sh` 脚本使用 `SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"` 自动定位项目根目录，**不依赖文件夹名称**，项目改名或移动后无需修改脚本。

---

## 8. 常见问题与解决方案

### 8.1 `check_build_deps` 失败

**症状**：编译时报 `Build deps are stale. Please run tools/install-build-deps`

**原因**：`args.gn` 中缺少 `skip_buildtools_check = true`

**解决**：确保 `out/ui/args.gn` 包含以下三行：

```
is_debug = false
skip_buildtools_check = true
gcc_toolchain = "/usr"
```

然后重新执行 `gn gen out/ui` 和编译。

### 8.2 Emscripten 编译器路径错误

**症状**：`/bin/sh: 1: .../emscripten/em++: not found`

**原因**：Ninja 构建文件中包含旧的绝对路径（如项目改名后）

**解决**：重新生成 Ninja 文件：

```bash
export PATH=./third_party/gn:./third_party/ninja:$PATH
gn gen out/ui
```

### 8.3 符号链接失效

**症状**：`EEXIST: file already exists, symlink` 或 `Cannot find module '../gen/xxx'`

**原因**：项目文件夹改名后，`ui/out`、`ui/src/gen`、`out/ui/test/data` 等符号链接仍指向旧路径

**解决**：删除失效的符号链接，构建脚本会自动重建：

```bash
rm -f ui/out ui/src/gen
# out/ui/test/data 需要手动重建：
rm -f out/ui/test/data
ln -s /your/absolute/path/to/openperfetto/test/data out/ui/test/data
```

### 8.4 端口被占用 / dev server 端口回退

**症状**：`Port 10000 is in use, trying 10001...`

**解决**：双重清理（Windows 侧 + WSL 侧）：

```powershell
# Windows 侧清理
foreach ($port in @(10000, 10001)) {
  $proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
  if ($proc) { $proc | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
}

# WSL 侧清理
wsl bash /mnt/d/1aLq/ProFile/openperfetto/kill_build.sh

# 等待端口释放
Start-Sleep -Seconds 3
```

### 8.5 Node.js OOM

**症状**：`FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`

**解决**：确保环境变量 `NODE_OPTIONS=--max-old-space-size=8192` 已设置（`run_build.sh` 和 `start_frontend.sh` 中已包含）。

### 8.6 build.js 锁冲突

**症状**：`a build.js instance is already running`

**解决**：

```bash
rm -f out/ui/watch.lock
# 或者使用 kill_build.sh 一键清理
bash kill_build.sh
```

### 8.7 `.ninja_log` 损坏

**症状**：`ninja: warning: premature end of file; recovering`

**说明**：Ninja 会自动恢复，不影响编译。如需清理旧缓存：

```bash
rm -f out/ui/.ninja_deps out/ui/.ninja_log
```

### 8.8 残留多组 build.js 进程

**症状**：端口全部空闲但 dev server 启动失败，`ps aux | grep build.js` 显示多组进程

**解决**：

```bash
bash kill_build.sh
```

该脚本会依次 `pkill` 所有 `node ui/build.js`、`tsc --project --watch`、`rollup --watch` 进程，并清理 `watch.lock`。

---

## 9. 项目文件夹改名注意事项

如果你 fork 或改名了项目文件夹，需要额外执行以下清理：

1. **删除构建缓存**（含旧绝对路径）：

   ```bash
   rm -f out/ui/.ninja_deps out/ui/.ninja_log
   ```

2. **重新安装 node_modules**（符号链接可能失效）：

   ```bash
   cd ui && rm -rf node_modules && npm install --legacy-peer-deps && cd ..
   cd server && rm -rf node_modules && npm install && cd ..
   ```

3. **删除失效的符号链接**：

   ```bash
   rm -f ui/out ui/src/gen out/ui/test/data
   ```

4. **重新生成 Ninja 构建文件**（旧文件含硬编码绝对路径）：

   ```bash
   export PATH=./third_party/gn:./third_party/ninja:$PATH
   gn gen out/ui
   ```

5. **确保 `args.gn` 包含正确参数**（见 8.1 节）

---

## 10. 架构概览

```
openperfetto/
├── ui/                     # 前端 (TypeScript + SCSS + WASM)
│   ├── src/                # 前端源码
│   ├── build.js            # 前端构建编排脚本
│   └── node_modules/       # 前端依赖
├── server/                 # 后端 (Node.js + Fastify + TypeScript)
│   ├── src/                # 后端源码
│   ├── skills/library/     # AI 分析 Skill 定义 (YAML)
│   ├── config/             # 配置文件 (YAML)
│   └── node_modules/       # 后端依赖
├── src/                    # C++ 源码 (编译为 WASM)
├── protos/                 # Protocol Buffer 定义
├── buildtools/             # 构建工具链 (Node.js, Emscripten, clang)
│   └── linux64/            # Linux x64 预编译工具
├── third_party/            # GN, Ninja 等第三方工具
├── out/ui/                 # 编译输出目录
│   ├── wasm/               # WASM 编译产物 (traceconv, proto_utils)
│   ├── wasm_memory64/      # 64 位 WASM 产物 (trace_processor)
│   └── ui/                 # TSC 输出 + Rollup 产物 + dev server 根
├── run_build.sh            # 完整编译脚本 (含 WASM)
├── start_frontend.sh       # 纯前端编译脚本 (跳过 WASM)
└── kill_build.sh           # 清理构建进程脚本
```

**核心构建链路**：

```
C++ (.cc) → [emcc/em++] → .o → [emcc link] → .wasm
Proto (.proto) → [protoc] → .js/.d.ts
TypeScript (.ts) → [tsc] → .js
JS + SCSS → [Rollup] → bundled .js + .css
```

---

## 11. 环境变量参考

`run_build.sh` 和 `start_frontend.sh` 会自动设置以下环境变量：

| 变量 | 值 | 作用 |
|------|---|------|
| `PATH` | `buildtools/linux64/nodejs/bin:third_party/gn:third_party/ninja:/usr/bin:/bin` | 使用项目自带的 Node.js、GN、Ninja |
| `EMSDK` | `buildtools/linux64/emsdk` | Emscripten SDK 路径 |
| `EM_CONFIG` | `buildtools/linux64/emsdk/.emscripten` | Emscripten 配置文件路径 |
| `NODE_OPTIONS` | `--max-old-space-size=8192` | Node.js 堆内存上限，防止 OOM |

后端环境变量（`server/.env`）：

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | LLM API 密钥 |
| `LLM_BASE_URL` | 否 | LLM API 端点（默认在 `config/default.yaml` 中定义） |
| `LLM_MODEL` | 否 | LLM 模型名称（默认在 `config/default.yaml` 中定义） |

---

## 12. 关键注意事项

1. **WSL + NTFS 限制**：代码在 Windows NTFS 上（`/mnt/d/...`），I/O 性能较低，`fs.watch()` 不可靠，每次修改后必须手动冷启动重新编译
2. **Ninja 增量编译**：基于文件时间戳，终端断开不丢失 `.o` 文件，恢复后可继续增量编译
3. **首次全量编译**：约 30-60 分钟（WASM 编译占主要时间），后续增量约 5-10 分钟
4. **dev server 端口**：固定使用 `10000`，端口被占用时会回退到 `10001`（功能不完整），务必确保 `10000` 端口空闲
5. **构建锁机制**：`build.js` 使用 `out/ui/watch.lock` 防止多实例并发，异常退出后需手动删除
6. **脚本路径无关**：所有 `.sh` 脚本使用 `SCRIPT_DIR` 自动定位，项目改名或移动后无需修改
7. **pkill 兼容性**：`kill_build.sh` 中 `pkill -f '.*perfetto.*'` 会匹配 `openperfetto`（包含 "perfetto" 子串），进程清理功能不受改名影响
