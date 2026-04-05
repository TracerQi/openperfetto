# 修改代码后快速编译验证参考

> 本文档是代码修改后编译验证的标准参考。与 [deployment.md](deployment.md) 互补，专注于日常开发中的增量编译场景。

---

## 1. 快速编译流程概览

```
修改代码
  │
  ├─ 前端 TypeScript ──→ watch 模式运行中？──→ 是 → 自动增量编译（TSC + Rollup）→ 验证
  │                                          └→ 否 → bash run_build.sh → 验证
  │
  ├─ 后端 Node.js ─────→ tsx watch 运行中？──→ 是 → 自动重启 → 验证
  │                                          └→ 否 → cd server && npm run dev → 验证
  │
  ├─ C++/WASM ─────────→ bash run_build.sh（Ninja 增量编译）→ 验证
  │
  ├─ GN 构建文件 ──────→ gn gen → bash run_build.sh → 验证
  │
  └─ SCSS 样式 ────────→ watch 模式自动处理 → 验证
```

**核心原则：增量编译优先。** Ninja 基于文件时间戳判断重编目标，终端断开不丢失已编译的 `.o` 文件，恢复后可继续。

---

## 2. 按修改类型分类的编译指南

### 2.1 修改前端 TypeScript 代码（最常见）

**watch 模式运行中（推荐）**

`build.js --watch` 会同时运行 TSC `--watch` 和 Rollup `--watch`，保存文件后自动触发增量编译：

1. TSC 检测到文件变更 → 增量编译 `.ts` → 输出到 `out/ui/ui/tsc/`
2. Rollup 检测到 TSC 输出变更 → 重新打包 bundle → 输出到 `out/ui/ui/dist/`
3. dev server 通过 Server-Sent Events 通知浏览器 live reload

**watch 模式未运行**

```bash
cd /mnt/d/1aLq/ProFile/perfetto
bash run_build.sh
```

Ninja 会增量跳过已编译的 WASM，仅重新执行 TSC + Rollup 打包。

**WSL 跨文件系统 watch 已知问题**

WSL 挂载 NTFS 时，`fs.watch()` 可能不触发文件变更事件。如果修改了文件但 watch 未响应，手动 touch 触发：

```bash
# 示例：修改了 index.ts 但 watch 未检测到
wsl touch /mnt/d/1aLq/ProFile/perfetto/ui/src/frontend/index.ts
```

**验证编译完成**

检查 TSC 输出文件时间戳：

```bash
wsl ls -la /mnt/d/1aLq/ProFile/perfetto/out/ui/ui/tsc/frontend/index.js
```

确认时间戳与修改时间一致。

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

watch 模式下，修改 `.scss` 文件会自动触发 Sass 编译，输出到 `out/ui/ui/dist/<version>/perfetto.css`。

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
# 一键启动（开发模式，含 watch + dev server）
cd /mnt/d/1aLq/ProFile/perfetto
bash run_build.sh

# 仅编译不启动服务器（一次性构建）
node ui/build.js --no-depscheck --only-wasm-memory64 --no-override-gn-args
```

**`run_build.sh` 做了什么**：
1. 清除旧的 `watch.lock` 文件
2. 设置环境变量（PATH、EMSDK、NODE_OPTIONS）
3. 执行 `build.js --no-depscheck --only-wasm-memory64 --no-override-gn-args --serve --watch`

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
| watch 未检测变更 | 文件改了但没重编 | `wsl touch <文件路径>` |
| Node.js OOM | FATAL ERROR: Allocation failed | 确认 `NODE_OPTIONS=--max-old-space-size=8192` |
| Rollup SCSS 错误 | Could not resolve '.scss' | 使用 `styles.scss` 包装文件，勿在 TS 中直接 import |
| CSP 阻止 WebSocket | Console 报 CSP violation | 检查 `ui/src/frontend/index.ts` 中 `connect-src` 配置 |
| 端口被占用 | EADDRINUSE | `wsl fuser -k <端口>/tcp` |
| `.ninja_log` 损坏 | premature end of file | Ninja 自动恢复，无需处理 |
| Python 3.8 不兼容 | AttributeError: removesuffix | 避免使用 3.9+ 新语法（如 `removesuffix`），改用切片 `str[:-4]` |
| pnpm lockfile 不同步 | frozen-lockfile 失败 | 使用 `--no-depscheck` 跳过（`run_build.sh` 已包含） |
| build.js 锁冲突 | a build.js instance is already running | `rm /mnt/d/1aLq/ProFile/perfetto/out/ui/watch.lock`（`run_build.sh` 启动时自动清除） |

---

## 6. 关键注意事项

1. **WSL + NTFS 性能**：挂载 NTFS 的 I/O 性能较低，Rollup 打包约 10 分钟。条件允许建议使用原生 Linux 文件系统。
2. **Ninja 增量编译可靠**：基于文件时间戳，终端断开不丢失 `.o` 文件。
3. **首次全量编译**：约 1-2 小时（WASM 编译 + Rollup 打包），后续增量编译很快。
4. **核心文件修改需验证**：修改 `ui/src/frontend/index.ts`（CSP 配置等）后，必须确认重编译已生效。
5. **时间戳验证**：检查 `out/ui/ui/tsc/` 下对应 `.js` 文件的时间戳，确认与源文件修改时间一致。
6. **构建锁机制**：`build.js` 使用 `out/ui/watch.lock` 防止多实例并发构建，`run_build.sh` 启动时会自动清除旧锁。
