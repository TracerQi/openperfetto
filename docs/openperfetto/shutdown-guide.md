# 前后端服务关闭指南

> 干净、快速、安全的关闭流程，确保下次启动无问题。

---

## 服务架构概览

| 服务 | 端口 | 运行环境 |
|------|------|----------|
| 前端 (dev server) | 10000 | WSL |
| 后端 (Node.js) | 3001 | WSL |

---

## 一键关闭命令（推荐）

在 **PowerShell** 中执行以下命令，一键完成所有清理：

```powershell
# 1. 清理前端构建进程和锁文件
wsl bash /mnt/d/1aLq/ProFile/openperfetto/kill_build.sh

# 2. 清理后端 Node.js 进程
wsl bash -c "pkill -f 'tsx watch' 2>/dev/null; pkill -f 'node.*server' 2>/dev/null; pkill -f 'node.*tsx' 2>/dev/null"

# 3. 释放 Windows 侧端口
foreach ($port in @(10000, 10001, 3001)) {
  $proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
  if ($proc) { $proc | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
}
```

---

## 分步关闭流程

### 第一步：关闭前端

```powershell
wsl bash /mnt/d/1aLq/ProFile/openperfetto/kill_build.sh
```

此脚本会：
- 终止所有 `build.js` 相关进程
- 删除 `watch.lock` 锁文件
- 清理残留子进程

### 第二步：关闭后端

```powershell
wsl bash -c "pkill -f 'tsx watch'; pkill -f 'node.*server'; pkill -f 'node.*tsx'"
```

### 第三步：释放 Windows 端口（可选）

如果 WSL 侧进程已清理但 Windows 端口仍被占用：

```powershell
foreach ($port in @(10000, 10001, 3001)) {
  $proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
  if ($proc) { $proc | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
}
```

---

## 验证关闭完成

```powershell
# 检查前端端口（无响应表示已关闭）
wsl bash -c "curl -s -o /dev/null -w '%{http_code}' http://localhost:10000 --connect-timeout 2"

# 检查残留进程数量（应为 0）
wsl bash -c "ps aux | grep -E 'build.js|node.*server|tsx' | grep -v grep | wc -l"
```

---

## 下次启动命令

### 前端

```powershell
wsl bash -c "rm -f /mnt/d/1aLq/ProFile/openperfetto/out/ui/watch.lock; cd /mnt/d/1aLq/ProFile/openperfetto; bash run_build.sh"
```

### 后端（新开终端窗口）

```powershell
wsl bash -c "cd /mnt/d/1aLq/ProFile/openperfetto/server; npm run dev"
```

---

## 注意事项

1. **关闭顺序**：先前端后后端，避免端口冲突
2. **锁文件**：`kill_build.sh` 会自动清理 `watch.lock`，无需手动删除
3. **双重清理**：WSL 进程和 Windows 端口是独立的，都需要清理
4. **下次启动**：启动前无需手动删锁，脚本会自动处理

---

## 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 端口仍被占用 | Windows 侧进程未清理 | 执行第三步释放端口命令 |
| 残留 build.js 进程 | 异常退出未清理 | 执行 `kill_build.sh` |
| 下次启动报锁冲突 | 锁文件未正确清理 | 手动删除 `out/ui/watch.lock` |
