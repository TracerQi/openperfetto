# 修改代码后快速编译验证参考

> 本文档是代码修改后编译验证的标准参考。与 [deployment.md](deployment.md) 互补，专注于日常开发中的增量编译场景。

---

## 0. 修改代码后编译验证（最常用）

> **重要说明**：由于代码文件位于 Windows NTFS 文件系统（`/mnt/d/...`），WSL 内的 `fs.watch()` 在跨文件系统挂载时无法可靠触发文件变更事件。因此 watch 自动增量编译在本项目环境中不可用，**每次修改代码后必须手动触发冷启动**才能使改动生效。

### 每次修改后：执行冷启动

在 **PowerShell** 中执行以下命令完成「杀残留进程 → 清锁 → 启动编译」全流程：

```powershell
# 1. 清理残留的构建进程（Windows 侧 + WSL 侧双重清理）
foreach ($port in @(10000, 10001)) {
  $proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
  if ($proc) { $proc | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
}
wsl bash /mnt/d/1aLq/ProFile/perfetto/kill_build.sh

# 2. 等待端口完全释放（约 2-3 秒）
Start-Sleep -Seconds 3

# 3. 启动增量编译 + dev server（WSL 内执行）
wsl bash -c "rm -f /mnt/d/1aLq/ProFile/perfetto/out/ui/watch.lock; cd /mnt/d/1aLq/ProFile/perfetto; bash run_build.sh"
```

编译完成后 dev server 自动监听 **http://localhost:10000**（输出 `HTTP server is listening on http://localhost:10000`），刷新浏览器即可看到最新改动。

> **耗时参考**：WASM 已缓存时，TSC 编译约 1-2 分钟，Rollup 打包约 8-10 分钟（WSL + NTFS）。

> **纯前端修改提速**：如果仅修改了 TypeScript/SCSS，未涉及 C++/WASM，可用 `start_frontend.sh`（含 `--no-wasm` 参数），跳过 WASM 编译，构建约 5-8 分钟（vs `run_build.sh` 的 8-10 分钟）：
> ```powershell
> wsl bash -c "rm -f /mnt/d/1aLq/ProFile/perfetto/out/ui/watch.lock; cd /mnt/d/1aLq/ProFile/perfetto; bash start_frontend.sh"
> ```

> **常见陷阱：残留多实例**：如果之前的会话未正常退出，WSL 内可能残留多组 build.js 进程（可通过 `wsl ps aux | grep build.js | grep -v grep` 检查），多实例互相冲突会导致 dev server 启动失败。此时必须先执行 `wsl bash /mnt/d/1aLq/ProFile/perfetto/kill_build.sh` 清理所有残留进程，再启动新的编译。

---

## 1. 快速编译流程概览

```
修改代码
  │
  ├─ 前端 TypeScript/SCSS ──→ 冷启动：清理残留进程 → bash start_frontend.sh（跳过 WASM，约 2-3 分钟）→ 刷新浏览器验证
  │
  ├─ 后端 Node.js ──────────→ cd server && npm run dev → 验证
  │
  ├─ C++/WASM ──────────────→ 冷启动：清理残留进程 → bash run_build.sh（含 WASM，约 8-10 分钟）→ 刷新浏览器验证
  │
  └─ GN 构建文件 ───────────→ gn gen → bash run_build.sh → 验证
```

**核心原则：每次修改后必须冷启动重新编译。** WSL 挂载 NTFS 时 `fs.watch()` 不可靠，文件变更事件无法被稳定检测，因此每次改动后需手动触发构建。Ninja 基于文件时间戳进行增量编译，仅重编修改的文件，终端断开不丢失已编译的 `.o` 文件。

**重要**：启动编译前务必确认端口 10000 已释放，否则 dev server 会自动回退到 10001、10002 等备用端口。务必以 **http://localhost:10000** 为准，备用端口不保证功能完整。

> **端口释放验证**：杀端口后执行 `wsl bash -c "curl -s -o /dev/null -w '%{http_code}' http://localhost:10000"`，若返回 `200` 说明端口仍被占用；无响应则端口已释放。注意：WSL 内的 dev server 在 Windows 侧 `netstat` 中可能看不到。

---

## 2. 按修改类型分类的编译指南

### 2.1 修改前端 TypeScript 代码（最常见）

**核心原则：每次修改后必须冷启动重新编译。** 由于代码位于 Windows NTFS 文件系统，WSL 内的 `fs.watch()` 无法可靠检测文件变更，不支持自动增量编译。

**仅修改 TypeScript/SCSS（推荐，约 5-8 分钟）**

使用 `start_frontend.sh` 跳过 WASM 编译，速度最快：

```powershell
# PowerShell 中执行（含清理 + 启动）
foreach ($port in @(10000, 10001)) {
  $proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
  if ($proc) { $proc | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
}
wsl bash /mnt/d/1aLq/ProFile/perfetto/kill_build.sh
Start-Sleep -Seconds 3
wsl bash -c "rm -f /mnt/d/1aLq/ProFile/perfetto/out/ui/watch.lock; cd /mnt/d/1aLq/ProFile/perfetto; bash start_frontend.sh"
```

**涉及 C++/WASM 修改（约 8-10 分钟）**

使用 `run_build.sh` 完整重编：

```powershell
wsl bash -c "rm -f /mnt/d/1aLq/ProFile/perfetto/out/ui/watch.lock; cd /mnt/d/1aLq/ProFile/perfetto; bash run_build.sh"
```

**验证编译完成**

看到 `HTTP server is listening on http://localhost:10000` 输出后，检查 TSC 输出文件时间戳：

```bash
wsl ls -la /mnt/d/1aLq/ProFile/perfetto/out/ui/ui/tsc/frontend/index.js
```

确认时间戳与修改时间一致，然后刷新浏览器。

### 2.2 修改后端代码

后端使用 `tsx watch` 模式运行，修改 `server/src/` 下的文件会**自动检测变更并重启**。

**手动重启**

```bash
# 在后端终端中 Ctrl+C 停止，然后：
cd /mnt/d/1aLq/ProFile/perfetto/server
npm run dev
```

**生产编译**

```bash
cd /mnt/d/1aLq/ProFile/perfetto/server
npm run build
```

### 2.3 修改 C++/WASM 代码

修改 `src/` 目录下的 C++ 代码后，Ninja 增量编译只重编修改的文件：

```bash
cd /mnt/d/1aLq/ProFile/perfetto
bash run_build.sh
```

- Ninja 会自动判断哪些 `.o` 需要重编
- 增量编译通常几分钟内完成
- 全量编译（首次或清除后）约 30-60 分钟

### 2.4 修改 GN 构建文件

修改 `BUILD.gn` 等构建配置后，需要重新生成 Ninja 文件：

```bash
# 方式 1：删除 args.gn 后重新运行（自动 gn gen）
rm /mnt/d/1aLq/ProFile/perfetto/out/ui/args.gn
bash run_build.sh

# 方式 2：手动执行 gn gen
export PATH=/mnt/d/1aLq/ProFile/perfetto/third_party/gn:$PATH
gn gen out/ui --args='is_debug=false'
bash run_build.sh
```

> 注意：如果使用 `--no-override-gn-args` 参数（`run_build.sh` 默认包含），`build.js` 不会自动执行 `gn gen`，需要手动处理。

### 2.5 修改 SCSS 样式

修改 `.scss` 文件后，同样需要冷启动重新编译，Sass 编译后输出到 `out/ui/ui/dist/<version>/perfetto.css`。参考 [2.1 节](#21-修改前端-typescript-代码最常见)使用 `start_frontend.sh` 执行冷启动（约 2-3 分钟）。

**重要约定**：Perfetto 插件中不要在 TypeScript 中直接 `import './styles.scss'`，而应使用 `styles.scss` 包装文件。入口 SCSS 文件为 `ui/src/assets/perfetto.scss`，所有插件样式通过它统一引入。

---

## 3. 编译环境快速设置

### 3.1 环境变量设置（复制即用）

```bash
export PATH=/mnt/d/1aLq/ProFile/perfetto/buildtools/linux64/nodejs/bin:/mnt/d/1aLq/ProFile/perfetto/third_party/gn:/mnt/d/1aLq/ProFile/perfetto/third_party/ninja:/usr/bin:/bin
export EMSDK=/mnt/d/1aLq/ProFile/perfetto/buildtools/linux64/emsdk
export EM_CONFIG=/mnt/d/1aLq/ProFile/perfetto/buildtools/linux64/emsdk/.emscripten
export NODE_OPTIONS=--max-old-space-size=8192
```

### 3.2 前端构建命令

```bash
# 仅编译不启动服务器（一次性构建）
node ui/build.js --no-depscheck --only-wasm-memory64 --no-override-gn-args
```

**Windows PowerShell 中通过 WSL 启动（标准冷启动流程）**：

```powershell
# 第 1 步：清理残留的构建进程（Windows 侧 + WSL 侧双重清理）
foreach ($port in @(10000, 10001)) {
  $proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
  if ($proc) { $proc | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
}
wsl bash /mnt/d/1aLq/ProFile/perfetto/kill_build.sh

# 第 2 步：等待端口释放
Start-Sleep -Seconds 3

# 第 3 步-A：含 C++/WASM 修改时使用（约 8-10 分钟）
wsl bash -c "rm -f /mnt/d/1aLq/ProFile/perfetto/out/ui/watch.lock; cd /mnt/d/1aLq/ProFile/perfetto; bash run_build.sh"

# 第 3 步-B：仅修改 TypeScript/SCSS 时使用（约 5-8 分钟，跳过 WASM）
wsl bash -c "rm -f /mnt/d/1aLq/ProFile/perfetto/out/ui/watch.lock; cd /mnt/d/1aLq/ProFile/perfetto; bash start_frontend.sh"
```

> **实战提示**：
> - 编译输出中出现 `HTTP server is listening on http://localhost:10000` 表示 dev server 启动成功，此时刷新浏览器即可看到最新改动
> - 如果看到 `Port 10000 is in use, trying 10001...` 说明端口未释放干净，需 Ctrl+C 终止当前编译，重新执行第 1-2 步后重启
> - 如果看到 `EADDRINUSE` 错误，同样重新执行第 1-2 步

**`run_build.sh` / `start_frontend.sh` 做了什么**：
1. 检测并清理已有构建实例（读 watch.lock 中的 PID，杀旧进程，清理残留子进程）
2. 设置环境变量（PATH、EMSDK、NODE_OPTIONS）
3. 执行 `build.js`（`run_build.sh` 含 WASM，`start_frontend.sh` 跳过 WASM）
4. 启动 TSC 编译 + Rollup 打包 + dev server `--serve`

**相关脚本速查**：

| 脚本 | 用途 | 耗时参考 | 关键参数 |
|------|------|----------|----------|
| `run_build.sh` | 完整增量编译（含 WASM）+ watch + serve | 约 8-10 分钟 | `--only-wasm-memory64 --serve --watch` |
| `start_frontend.sh` | 纯前端编译（跳过 WASM）+ watch + serve | 约 5-8 分钟 | `--no-wasm --only-wasm-memory64 --no-override-gn-args --serve --watch` |
| `restart_dev_server.sh` | 与 `run_build.sh` 相同（别名）| 同 `run_build.sh` | 同 `run_build.sh` |
| `kill_build.sh` | 杀 WSL 内构建进程 + 清锁 | - | `pkill` + `rm watch.lock` |

### 3.3 后端构建命令

```bash
cd /mnt/d/1aLq/ProFile/perfetto/server

# 开发模式（tsx watch 自动重启）
npm run dev

# 生产编译
npm run build
```

---

## 4. 编译验证检查清单

- [ ] TSC 编译 0 errors
- [ ] Rollup 打包完成（无 `Could not resolve` 错误）
- [ ] dev server 启动在 port 10000
- [ ] 后端服务运行在 port 3001
- [ ] 浏览器访问 http://localhost:10000 正常
- [ ] 浏览器控制台无 CSP 错误
- [ ] WebSocket 连接到 ws://localhost:3001/ws 成功

**快速验证命令**：

```bash
# 检查前端端口
wsl curl -s -o /dev/null -w "%{http_code}" http://localhost:10000

# 检查后端健康状态
wsl curl http://localhost:3001/health
```

---

## 5. 常见编译问题速查

| 问题 | 症状 | 快速修复 |
|------|------|--------|
| Node.js OOM | FATAL ERROR: Allocation failed | 确认 `NODE_OPTIONS=--max-old-space-size=8192` |
| Rollup SCSS 错误 | Could not resolve '.scss' | 使用 `styles.scss` 包装文件，勿在 TS 中直接 import |
| CSP 阻止 WebSocket | Console 报 CSP violation | 检查 `ui/src/frontend/index.ts` 中 `connect-src` 配置 |
| 端口被占用 / dev server 回退 | `Port 10000 is in use, trying 10001...` 或 EADDRINUSE | **双重清理**（Windows 侧 + WSL 侧）：**PowerShell**: `foreach($p in @(10000,10001)){$proc=Get-NetTCPConnection -LocalPort $p -EA 0 \| Select -Exp OwningProcess \| Sort -Unique; if($proc){$proc \| %{Stop-Process -Id $_ -Force}}}` + **WSL**: `wsl bash -c "fuser -k 10000/tcp; fuser -k 10001/tcp; bash /mnt/d/1aLq/ProFile/perfetto/kill_build.sh"`，等待 3 秒后重试 |
| WSL 内残留多组 build.js 进程 | 端口全部空闲但 dev server 启动失败，`wsl ps aux \| grep build.js` 显示多组进程 | `wsl bash /mnt/d/1aLq/ProFile/perfetto/kill_build.sh` 一键清理所有残留构建进程 + 锁文件，然后重新启动 |
| `.ninja_log` 损坏 | premature end of file | Ninja 自动恢复，无需处理 |
| Python 3.8 不兼容 | AttributeError: removesuffix | 避免使用 3.9+ 新语法（如 `removesuffix`），改用切片 `str[:-4]` |
| pnpm lockfile 不同步 | frozen-lockfile 失败 | 使用 `--no-depscheck` 跳过（`run_build.sh` 已包含） |
| build.js 锁冲突 | a build.js instance is already running | `wsl bash -c "rm -f /mnt/d/1aLq/ProFile/perfetto/out/ui/watch.lock"`（`run_build.sh` 启动时自动清除）。或使用 `wsl bash /mnt/d/1aLq/ProFile/perfetto/kill_build.sh` 一键清理 |
| dev server 端口回退后如何恢复 | 浏览器访问 10001 但功能异常 | Ctrl+C 终止编译 → 杀端口（Windows + WSL 双重清理）→ 等待 3 秒 → 重新启动编译 |

---

## 6. 关键注意事项

1. **WSL + NTFS 性能**：挂载 NTFS 的 I/O 性能较低，Rollup 打包约 10 分钟；同时 `fs.watch()` 在跨文件系统挂载时不可靠，每次修改后必须手动冷启动重新编译。条件允许建议使用原生 Linux 文件系统。
2. **Ninja 增量编译可靠**：基于文件时间戳，终端断开不丢失 `.o` 文件，恢复后可继续增量编译。
3. **首次全量编译**：约 1-2 小时（WASM 编译 + Rollup 打包），后续增量编译（冷启动 + Ninja 增量）约 2-10 分钟。
4. **核心文件修改需验证**：修改 `ui/src/frontend/index.ts`（CSP 配置等）后，必须确认重编译已生效。
5. **时间戳验证**：检查 `out/ui/ui/tsc/` 下对应 `.js` 文件的时间戳，确认与源文件修改时间一致。
6. **构建锁机制**：`build.js` 使用 `out/ui/watch.lock` 防止多实例并发构建，`run_build.sh` 启动时会自动清除旧锁。
7. **Omnibox 不隐藏**：原始 Perfetto 顶部搜索栏（Omnibox）必须保留显示，新侧边栏搜索框仅提供扩展功能，不可替代或隐藏原 Omnibox。CSS 中不应出现 `body.openperfetto-active .pf-omnibox { display: none }` 之类的规则。
