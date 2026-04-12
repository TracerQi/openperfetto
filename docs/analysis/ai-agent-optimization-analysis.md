# OpenPerfetto AI Agent 架构分析与优化方案

## 一、分析背景

OpenPerfetto 是对 Perfetto 的扩展，旨在实现 AI Agent 对 trace 的自动化分析。当前已实现 AI Agent 对话功能，但在实际使用中暴露出多个问题。本文档通过以下三个维度进行系统性分析：

1. **实际对话日志分析**：基于 Settings 冷启动分析对话的全量日志，逐条识别异常行为
2. **参考项目对比**：与 perfetto-mcp 项目的架构设计进行深度对比，提炼可借鉴的设计决策
3. **当前架构深度剖析**：从 OpenPerfetto 的前端 Agent Loop、后端 Skill 系统、数据流链路三个层面定位架构缺陷

分析目标是：**识别根本原因，而非表面症状；提出系统性方案，而非补丁式修复**。

---

## 二、AI 对话问题分析（基于 Settings 冷启动分析对话）

### 2.1 P0 严重问题

#### 问题1：工具重复调用

- **现象**: 对话中同一 Skill（如 `startup_blocking_calls`）被相同参数调用了多次。在一次完整的 Settings 冷启动分析中，`startup_blocking_calls` 至少被调用了 3 次，每次传入的参数完全一致（`package_name: "com.android.settings"`）。
- **影响**:
  - 浪费 LLM Token 和 Trace Processor 计算资源
  - 增加端到端延迟（每次调用涉及 WebSocket 通信 + SQL 执行）
  - 可能产生冲突的 Artifact 数据（不同时间点查询结果可能不同）
  - 用户体验下降（看到重复的工具调用令人困惑）
- **根因方向**:
  1. **Agent Loop 缺少工具调用去重机制**: 当前 `agent_loop.ts` 在执行 `invoke_skill` 时不检查是否已有相同调用的结果。每次 LLM 决定调用工具，系统都无条件执行。
  2. **LLM 无法感知已获取的数据**: 系统提示词（System Prompt）中没有包含"已调用工具列表"和"已有 Artifact 摘要"，LLM 的上下文中缺乏这些关键信息，因此无法做出"已经有了，不需要再查"的判断。
  3. **Artifact 状态未被反馈到 LLM**: ArtifactStore 中存储了工具执行结果，但在后续 LLM 调用时，这些 Artifact 的存在信息没有被结构化地注入到上下文中。

> **当前 → 目标**:
> - 当前: LLM 每次推理都从"无状态"出发，不知道之前做了什么
> - 目标: LLM 每次推理前都能看到完整的"已执行操作清单"和"已有数据清单"

---

#### 问题2：时间戳数据质量验证失败

- **现象**: 系统验证环节报错"art_6 中时间戳不单调递增"，随后进入修正循环。修正逻辑重新调用相同的 Skill，但由于 SQL 模板中硬编码了 `ORDER BY dur DESC`（按耗时降序排列），导致 `ts` 列天然不单调递增。重试多次后达到最大重试次数（通常为 3 次），分析被迫中止。
- **影响**:
  - 数据质量不可信——验证机制发现了问题但无法修正
  - 验证循环变成了资源浪费的无效循环
  - 分析链路中断，下游分析缺少关键数据
- **根因方向**:
  1. **SQL 模板设计缺陷**: Skill YAML 中的 `sqlTemplate` 使用 `ORDER BY dur DESC` 排序，这是为了让"最耗时的调用排在前面"，但验证规则要求时间戳单调递增。这两个需求产生了内在矛盾。

     ```sql
     -- 当前 SQL 模板（简化）
     SELECT ts, dur, name FROM slice
     WHERE ...
     ORDER BY dur DESC  -- 导致 ts 不单调递增
     LIMIT 20
     ```

  2. **验证失败后的修正逻辑只是"重新查询"**: 修正机制没有分析失败原因，而是简单地重新调用同一个 Skill，传入相同参数。由于 SQL 模板没变，结果当然也不会变。
  3. **修正机制缺乏对 SQL 的针对性修改能力**: 当前架构中，SQL 由后端 SkillProcessor 从 YAML 模板生成，前端的验证模块无法修改 SQL 的 ORDER BY 子句。验证和修正之间存在"知道问题但无法修改"的断裂。
  4. **验证规则与 Skill 语义不匹配**: 并非所有查询结果都需要时间戳单调递增。按耗时排序的 Top-N 查询，时间戳不单调递增是正常的。验证规则应该根据查询语义动态调整。

> **当前 → 目标**:
> - 当前: 验证规则一刀切，修正逻辑只是重试
> - 目标: 验证规则与 Skill 语义匹配，修正逻辑能针对性修改 SQL

---

#### 问题3：异常处理陷入"虚假修正"模式

- **现象**: AI 收到验证失败通知后，生成的回复中包含类似"好的，我会重新获取数据"的文本，但实际并未执行任何有效的修正动作。随后进入下一轮循环，再次收到相同的验证失败通知，再次"确认"，如此反复直到达到最大重试次数。
- **影响**:
  - 验证-修正循环变成无效空转
  - 3 次重试 × 每次约 10-15 秒 = 30-45 秒的纯浪费
  - 用户看到 AI "在努力修复"但实际什么都没做
- **根因方向**:
  1. **验证失败的错误信息不够具体**: 当前验证失败消息类似 `"art_6 中时间戳不单调递增"`。这告诉了 LLM "什么出了问题"，但没有告诉它"为什么出问题"和"怎么修"。LLM 缺乏足够的信息来做出有效修正。

     ```
     // 当前错误信息（不够具体）
     "Validation failed: timestamps in art_6 are not monotonically increasing"

     // 应该提供的错误信息（具体且可操作）
     "Validation failed: timestamps in art_6 are not monotonically increasing.
      Root cause: The SQL query uses ORDER BY dur DESC, which conflicts with ts ordering.
      Fix: Re-execute skill 'startup_blocking_calls' with additional ORDER BY ts ASC,
      or skip timestamp monotonicity check for duration-sorted results."
     ```

  2. **LLM 缺乏对 Artifact 状态的清晰感知**: LLM 不知道 art_6 中具体有什么数据、SQL 查询是什么、排序方式是什么。它只知道"验证失败了"。
  3. **修正流程没有强制性的结构化约束**: 当前的修正流程只是把错误信息放进上下文，然后让 LLM 自由发挥。没有强制 LLM 必须：（a）分析错误原因，（b）提出修正方案，（c）执行修正操作。LLM 可以选择"口头确认"然后不做任何事。

> **当前 → 目标**:
> - 当前: 验证失败 → 模糊错误信息 → LLM 自由发挥 → 无效修正
> - 目标: 验证失败 → 结构化错误+修正指引 → 强制执行修正动作 → 重新验证

---

### 2.2 P1 高优先级问题

#### 问题4：报告中混入不完整文本片段

- **现象**: 最终报告中出现如 `"平均每次调度运行1.95让我导航到启动的关键时间ms"` 这样的混乱文本。这明显是两段不同文本的拼接：`"平均每次调度运行1.95"` + `"让我导航到启动的关键时间"` + `"ms"`。
- **根因**: 流式输出（Streaming）过程中，LLM 的 `text_delta` 事件和 `tool_use` 事件之间存在竞争条件。具体来说：
  1. LLM 生成文本 `"平均每次调度运行1.95"`
  2. LLM 决定调用工具（内部思考 `"让我导航到启动的关键时间"`）
  3. 文本缓冲区在工具调用前没有被正确刷新
  4. LLM 继续生成 `"ms"`
  5. 三段文本被错误地拼接在一起

  **当前实现的问题**: `agent_loop.ts` 中的流式文本处理没有在工具调用边界处插入明确的分隔符或刷新操作。

> **当前 → 目标**:
> - 当前: 流式文本和工具调用的边界不清晰，缓冲区可能混合不同语义的文本
> - 目标: 工具调用前后强制刷新缓冲区，确保文本和工具调用之间有清晰的边界

---

#### 问题5：工具调用后数据未被使用

- **现象**: 调用了 `fetch_artifact` 获取 art_9 的完整数据，但后续分析和报告中完全没有引用 art_9 的内容。art_9 包含的 CPU 调度数据被完全忽略。
- **根因**:
  1. **LLM 对工具结果没有强制引用机制**: 工具返回的数据只是被追加到对话历史中，LLM 可以选择忽略它。
  2. **工具返回的数据量可能过大**: 如果 art_9 包含数百行数据，它可能超出了 LLM 的有效注意力范围（即使在上下文窗口内，长距离信息也容易被忽略）。
  3. **上下文窗口压力**: 随着对话进行，上下文中积累了大量的工具调用、文本回复、验证信息，新获取的数据可能被推到了上下文的"远端"。

> **当前 → 目标**:
> - 当前: 工具结果被动地追加到上下文中，LLM 可能忽略
> - 目标: 工具结果以摘要形式主动注入，关键数据点被高亮标注

---

#### 问题6：阶段执行与报告内容不对应

- **现象**: 分析流程中执行了阶段2（获取 blocking_calls）和阶段3（获取 cpu_analysis），但最终报告中没有展示这些工具返回的具体数据。报告中只有阶段1（app_startup_breakdown）的数据被详细引用。
- **根因**:
  1. **工具返回的 Artifact 数据没有被结构化地注入到 LLM 的上下文中**: 阶段2和3的结果存储在 ArtifactStore 中，但在生成报告时，LLM 可能已经"忘记"了这些数据。
  2. **报告生成缺乏模板约束**: 当前系统没有强制报告必须引用所有已完成阶段的数据。LLM 在生成报告时，倾向于使用距离最近的（最后获取的）数据。
  3. **验证机制不检查报告完整性**: 当前验证只检查数据质量（如时间戳单调性），不检查"报告是否引用了所有已获取的数据"。

> **当前 → 目标**:
> - 当前: 报告内容完全由 LLM 自由决定，可能遗漏已获取的数据
> - 目标: 报告生成前注入"必须引用的数据清单"，验证环节检查引用完整性

---

#### 问题7：SQL 查询参数过度泛化

- **现象**: 使用 `p.name LIKE '%settings%'` 而不是精确匹配 `p.name = 'com.android.settings'`。这会匹配到所有包含 "settings" 的进程，如 `com.android.providers.settings`、`settings_daemon` 等，导致分析结果混入了无关进程的数据。
- **根因**: Skill 的 SQL 模板中使用了 `LIKE '%${package_name}%'` 模式：

  ```yaml
  # 当前 Skill YAML 模板（简化）
  sqlTemplate: |
    SELECT ...
    FROM process p
    WHERE p.name LIKE '%${package_name}%'
    ...
  ```

  即使前端传入完整包名 `com.android.settings`，经过模板替换后变成 `LIKE '%com.android.settings%'`，仍然是模糊匹配。

  这个设计的初衷可能是"用户可能只输入部分包名"，但在分析场景中，精确匹配更安全。

> **当前 → 目标**:
> - 当前: 所有包名匹配都是模糊匹配，无法精确定位目标进程
> - 目标: 根据参数定义中的 matchMode 字段选择精确/模糊匹配

---

### 2.3 P2 中优先级问题

#### 问题8：数据来源透明度不足

- **现象**: 报告中引用了具体的数据值（如"启动耗时 1.2 秒"），但没有标注这个数据来自哪个 Artifact、哪一行、哪个字段。
- **根因**: 系统没有强制要求 LLM 在报告中标注数据来源。LLM 倾向于直接引用数值而省略来源信息。

#### 问题9：缺少数据对比验证

- **现象**: 报告中的分析结论缺乏交叉验证。例如"CPU 密集阶段"的结论只基于 cpu_analysis 数据，没有与 blocking_calls 数据进行交叉比对。
- **根因**: 分析 Skill 之间相互独立，系统没有设计交叉验证的机制。

#### 问题10：建议缺乏可操作细节

- **现象**: 优化建议如"减少启动阶段的阻塞调用"过于笼统，没有指出具体应该优化哪个调用、预期可以节省多少时间。
- **根因**: 分析 Skill 只提供原始数据，缺乏"数据 → 建议"的推理模板。

#### 问题11：性能基准值无依据

- **现象**: 报告中使用"正常范围应在 500ms 以内"这样的基准值，但没有说明这个基准来自哪里。
- **根因**: 系统没有维护标准的性能基准知识库，LLM 使用的是其训练数据中的模糊记忆。

> **P2 问题的统一根因**: 系统没有强制要求 LLM 在分析时引用具体 Artifact 和数据行。需要在报告生成模板和验证规则中加入"引用完整性"和"结论可追溯性"的约束。

---

## 三、参考实现分析：perfetto-mcp 的关键设计

> **项目路径**: `D:\1aLq\ProFile\perfetto-mcp`

### 3.1 架构概览

perfetto-mcp 采用五层分层架构，每一层职责明确、边界清晰：

```
┌─────────────────────────────────┐
│       MCP 客户端层               │  Claude Desktop / Cursor 等
├─────────────────────────────────┤
│       MCP 服务器层               │  server.py (FastMCP)
│  工具注册、路由、协议适配          │
├─────────────────────────────────┤
│       工具执行层                  │  BaseTool 派生类 (10+)
│  参数验证→SQL构建→执行→格式化      │  每个工具是完整分析单元
├─────────────────────────────────┤
│       连接管理层                  │  ConnectionManager
│  持久化连接、健康检查、自动重连     │
├─────────────────────────────────┤
│       SQL 处理层                  │  query_helpers.py
│  脚本限制、格式化、安全校验         │
└─────────────────────────────────┘
```

**关键特征**:
- **10+ 分析工具**，每个专注单一分析场景（如 `detect_anrs`、`find_slices`、`analyze_startup`）
- **单连接模型**，按 trace 文件路径缓存连接
- **统一的 JSON 信封**，所有工具返回格式一致
- **五层数据质量防线**，从参数到结果全链路保障

### 3.2 关键设计决策（值得借鉴）

#### 决策1：工具即完整分析单元

每个 Tool 是一个**自包含的分析单元**，包含参数验证、SQL 构建、查询执行、结果格式化的完整链路。这与 OpenPerfetto 将 SQL 生成和 SQL 执行分离到不同层的做法形成鲜明对比。

以 `SliceFinderTool` 的 `find_slices()` 方法为例，其内部执行链路：

```python
class SliceFinderTool(BaseTool):
    async def find_slices(self, trace_path: str, name: str, 
                          match_mode: str = "contains",
                          min_duration_ms: float = None,
                          limit: int = 100) -> dict:
        # 1. 参数验证与归一化
        limit = max(1, min(limit, 500))  # 范围约束: 1-500
        if min_duration_ms is not None:
            min_duration_ns = int(min_duration_ms * 1_000_000)  # ms → ns 转换
        
        # 2. 动态构建 SQL（根据 match_mode 选择策略）
        where_clauses = []
        if match_mode == "exact":
            where_clauses.append(f"s.name = '{self._escape(name)}'")
        elif match_mode == "contains":
            where_clauses.append(f"s.name LIKE '%{self._escape(name)}%'")
        elif match_mode == "glob":
            where_clauses.append(f"s.name GLOB '{name}'")
        
        if min_duration_ns:
            where_clauses.append(f"s.dur >= {min_duration_ns}")
        
        # 3. 两阶段查询
        # 阶段A: 聚合统计
        agg_sql = f"""
            SELECT s.name, COUNT(*) as count, 
                   AVG(s.dur) as avg_dur, SUM(s.dur) as total_dur
            FROM slice s WHERE {' AND '.join(where_clauses)}
            GROUP BY s.name ORDER BY total_dur DESC LIMIT {limit}
        """
        agg_result = await self.execute_query(trace_path, agg_sql)
        
        # 阶段B: 获取示例明细
        detail_sql = f"""
            SELECT s.ts, s.dur, s.name, s.track_id
            FROM slice s WHERE {' AND '.join(where_clauses)}
            ORDER BY s.dur DESC LIMIT {min(limit, 20)}
        """
        detail_result = await self.execute_query(trace_path, detail_sql)
        
        # 4. 结果格式化（ns → ms 转换）
        for row in agg_result:
            row['avg_dur_ms'] = row['avg_dur'] / 1_000_000
            row['total_dur_ms'] = row['total_dur'] / 1_000_000
        
        # 5. 统一信封包装
        return self._build_envelope(
            trace_path=trace_path,
            success=True,
            result={"aggregation": agg_result, "details": detail_result}
        )
```

**设计优势**:
- SQL 构建与执行在同一个方法内，不存在中间断点
- 参数验证前置，不可能有非法参数进入 SQL
- 结果格式化内置，返回给 AI 的数据已经是人类可读格式
- 两阶段查询（聚合+明细）提供了多层次的分析视角

#### 决策2：统一的响应信封

所有工具返回统一的 JSON 信封格式：

```json
{
  "tracePath": "/path/to/trace.perfetto-trace",
  "processName": "com.android.settings",
  "success": true,
  "error": null,
  "result": {
    "aggregation": [
      {"name": "bindApplication", "count": 1, "avg_dur_ms": 245.3, "total_dur_ms": 245.3},
      {"name": "inflate", "count": 47, "avg_dur_ms": 3.2, "total_dur_ms": 150.4}
    ],
    "details": [
      {"ts_ms": 1234.5, "dur_ms": 245.3, "name": "bindApplication", "track_id": 42}
    ],
    "summary": {
      "total_slices": 48,
      "total_duration_ms": 395.7,
      "unique_names": 2
    }
  }
}
```

**错误信封示例**:

```json
{
  "tracePath": "/path/to/trace.perfetto-trace",
  "processName": null,
  "success": false,
  "error": {
    "code": "DATA_UNAVAILABLE",
    "message": "No ANR data found in this trace",
    "details": "The trace does not contain the 'android_anrs' table. This usually means ANR monitoring was not enabled during trace collection."
  },
  "result": null
}
```

**设计优势**:
- AI 可以一致地解析所有工具的输出，不需要为每个工具写不同的解析逻辑
- 错误信息结构化（code + message + details），便于 LLM 理解错误类型并决定重试策略
- `success` 字段提供明确的成功/失败语义，不依赖对结果内容的推断
- `details` 字段提供人类可读的解释，帮助 LLM 向用户传达有意义的信息

#### 决策3：五层数据质量防线

```
           请求                                         响应
            │                                           ▲
            ▼                                           │
  ┌─────────────────────┐                    ┌─────────────────────┐
  │  第1层：参数验证      │                    │  第5层：异常处理      │
  │  类型检查、范围约束    │                    │  统一错误格式         │
  │  (1-500)、非空检查    │                    │  结构化错误码         │
  │  单位转换(ms→ns)     │                    └─────────────────────┘
  └──────────┬──────────┘                              ▲
             ▼                                         │
  ┌─────────────────────┐                    ┌─────────────────────┐
  │  第2层：SQL 安全      │                    │  第4层：结果格式化     │
  │  脚本大小≤1MB        │                    │  JSON可序列化检查     │
  │  语句数≤200          │                    │  单位统一(ns→ms)     │
  │  特殊字符转义         │                    │  摘要统计计算         │
  └──────────┬──────────┘                    └─────────────────────┘
             ▼                                         ▲
  ┌─────────────────────┐                              │
  │  第3层：连接管理      │──── 执行查询 ────────────────┘
  │  健康检查(SELECT 1)  │
  │  自动重连(1次)       │
  │  线程安全(粗粒度锁)   │
  └─────────────────────┘
```

**各层详细说明**:

| 防线层级 | 职责 | 具体机制 | 失败时行为 |
|---------|------|---------|----------|
| 第1层：参数验证 | 确保输入合法 | 类型检查、范围约束（limit: 1-500）、非空检查、单位转换（ms→ns） | 返回 `INVALID_PARAMETER` 错误码 |
| 第2层：SQL 安全 | 防止危险 SQL | 脚本大小 ≤ 1MB、语句数 ≤ 200、特殊字符转义（`'` → `''`） | 返回 `QUERY_TOO_LARGE` 错误码 |
| 第3层：连接管理 | 确保连接可用 | 每次 `get_connection()` 执行 `SELECT 1` 健康检查、连接类错误自动重连1次 | 返回 `CONNECTION_ERROR` 错误码 |
| 第4层：结果格式化 | 确保输出规范 | JSON 可序列化验证、单位统一转换（ns→ms）、摘要统计计算 | 返回 `FORMAT_ERROR` 错误码 |
| 第5层：异常处理 | 确保不崩溃 | 所有异常捕获并转为标准错误信封、区分业务异常和系统异常 | 返回对应错误码 + 详细描述 |

#### 决策4：连接管理器的持久化与健康检查

```python
class ConnectionManager:
    def __init__(self):
        self._connections: Dict[str, TraceProcessor] = {}
        self._lock = threading.Lock()
        atexit.register(self._cleanup)  # 进程退出时清理
    
    def get_connection(self, trace_path: str) -> TraceProcessor:
        with self._lock:
            # 1. 检查缓存
            if trace_path in self._connections:
                conn = self._connections[trace_path]
                # 2. 健康检查
                if self._is_healthy(conn):
                    return conn
                else:
                    # 连接不健康，清除并重新创建
                    self._close_connection(trace_path)
            
            # 3. 创建新连接
            conn = self._create_connection(trace_path)
            self._connections[trace_path] = conn
            return conn
    
    def _is_healthy(self, conn: TraceProcessor) -> bool:
        try:
            conn.query("SELECT 1")  # 轻量健康检查
            return True
        except Exception:
            return False
    
    def _cleanup(self):
        """进程退出时关闭所有连接"""
        with self._lock:
            for path in list(self._connections.keys()):
                self._close_connection(path)
```

**设计要点**:
- **单连接模型**: 按 `trace_path` 缓存，同一个 trace 复用同一个连接
- **每次使用前健康检查**: 执行 `SELECT 1`，成本极低但能有效检测死连接
- **异常分类重试策略**:
  - `FileNotFoundError`：业务级错误，不重试（trace 文件不存在，重试也没用）
  - `ConnectionError`：系统级错误，重试 1 次（可能是临时性问题）
- **线程安全**: 粗粒度锁保护连接池
- **atexit 清理钩子**: 确保进程退出时正确关闭所有连接

#### 决策5：优雅降级

当 trace 中缺少特定数据模块时，返回明确的错误信息而非崩溃或空数据：

```python
async def detect_anrs(self, trace_path: str) -> dict:
    try:
        # 先检查表是否存在
        tables = await self.execute_query(
            trace_path, 
            "SELECT name FROM sqlite_master WHERE type='table' AND name='android_anrs'"
        )
        if not tables:
            return self._build_envelope(
                trace_path=trace_path,
                success=False,
                error={
                    "code": "DATA_UNAVAILABLE",
                    "message": "No ANR data found in this trace",
                    "details": "The trace does not contain the 'android_anrs' table. "
                               "This usually means ANR monitoring was not enabled "
                               "during trace collection."
                }
            )
        # 正常查询逻辑...
    except Exception as e:
        return self._build_envelope(
            trace_path=trace_path,
            success=False,
            error={
                "code": "QUERY_ERROR",
                "message": str(e),
                "details": traceback.format_exc()
            }
        )
```

**设计优势**:
- AI 收到 `DATA_UNAVAILABLE` 后可以明确告诉用户"这个 trace 没有 ANR 数据"，而不是"分析失败了"
- `details` 字段解释了为什么数据不可用，帮助用户理解是 trace 采集配置的问题
- 与返回空结果相比，错误码提供了更清晰的语义

### 3.3 数据流对比

**perfetto-mcp 的数据流（闭环）**:

```
用户请求
  │
  ▼
MCP 协议解析
  │
  ▼
工具选择与路由 (server.py)
  │
  ▼
┌────────────────────────────────────────┐
│  工具内部（自包含闭环）                    │
│                                        │
│  参数验证 → SQL 构建 → 连接获取           │
│       → SQL 执行 → 结果格式化             │
│       → 信封包装                         │
│                                        │
│  ✅ 无中间断点，无外部依赖                  │
└────────────────────────────────────────┘
  │
  ▼
JSON 结果返回 (MCP 协议)
  │
  ▼
客户端（Claude/Cursor）直接使用
```

**OpenPerfetto 的数据流（断裂）**:

```
用户请求
  │
  ▼
Agent Loop 状态机 (agent_loop.ts)
  │
  ▼
LLM 决定调用工具
  │
  ▼
invoke_skill (WebSocket) ──────────────────► 后端 SkillProcessor
  │                                              │
  │                                              ▼
  │                                         参数验证 + SQL 生成
  │                                              │
  │                                              ▼
  │          ◄──────────────────────────── 返回 SQL 文本
  │                                         ⚠️ SQL 未执行！
  ▼
前端 execute_sql ──────────────────────────► Trace Processor
  │                                              │
  │          ◄──────────────────────────── 返回查询结果
  ▼
ArtifactStore 存储
  │
  ▼
LLM 继续分析（可能看不到 Artifact 数据）
  │
  ▼
验证（可能发现问题但无法修正）
```

**关键差异**:

| 维度 | perfetto-mcp | OpenPerfetto |
|------|-------------|-------------|
| SQL 执行位置 | 工具内部 | 前端（与生成分离） |
| 结果处理 | 工具内部格式化 | ArtifactStore 存储后由 LLM 引用 |
| 中间断点 | 无 | 至少 2 个（SQL 传输、结果存储） |
| 错误处理 | 工具内统一 | 分散在前端和后端 |
| 数据格式 | 统一 JSON 信封 | 非结构化（依赖 LLM 解析） |

---

## 三-A、具体实现逐文件对比

> 本章基于逐文件阅读和对比，对 perfetto-mcp 与 OpenPerfetto 的每个工具/Skill 实现进行深度剖析，揭示两套系统在执行闭环、业务逻辑深度、数据质量保障等方面的具体差异。

### A.1 工具逐文件对比

#### A.1.1 SQL 查询工具对比

**perfetto-mcp: `sql_query.py` (78行)**

- 直接调用 `TraceProcessor.query()` 执行 SQL
- 通过 `connection_manager` 获取持久化连接
- `validate_sql_query()` 检查 SQL 大小和语句数量
- `format_query_result_row()` 格式化每行结果
- 无自动 LIMIT 保护
- 无超时保护
- 返回统一 JSON 信封（通过 `BaseTool.run_formatted()`）

核心流程：

```python
def execute_sql_query(self, trace_path: str, sql_query: str) -> str:
    # 1. validate_sql_query 验证 SQL 合法性
    # 2. connection_manager 获取 TraceProcessor 连接
    # 3. tp.query(sql_query) 执行查询
    # 4. 逐行转 dict
    # 5. 返回 JSON 信封
```

错误处理——分类捕获：

```python
try:
    result = tp.query(sql_query)
except ToolError as te:
    # 工具级错误（参数无效等）
except FileNotFoundError as fnf:
    # Trace 文件不存在
except ConnectionError as ce:
    # TraceProcessor 连接失败
except Exception as e:
    # 通用捕获兜底
```

**OpenPerfetto: `execute_sql.ts` (185行)**

- 使用前端 WASM TraceProcessor 执行查询
- 自动添加 LIMIT（默认 200，上限 5000）
- 30s `Promise.race` 超时保护
- BigInt → 字符串转换
- 结果存入 `ArtifactStore`（支持压缩）
- 返回 `artifactRef` + metadata 摘要

核心流程：

```typescript
async execute(args): Promise<ToolExecutionResult> {
    // 1. 参数验证 maxRows
    // 2. 自动添加 LIMIT
    // 3. Promise.race 30s 超时执行
    // 4. 列类型推断 inferColumnType
    // 5. BigInt 处理
    // 6. 存储到 ArtifactStore
    // 7. 返回 artifactRef + 摘要
}
```

列类型推断逻辑：

```typescript
inferColumnType(name: string) {
    if (name.includes('ts') || name.includes('time')) return 'timestamp';
    if (name.includes('dur')) return 'duration';
    // ...
}
```

**对比表：**

| 维度 | perfetto-mcp (`sql_query.py`) | OpenPerfetto (`execute_sql.ts`) |
|------|------|------|
| 数据获取 | TraceProcessor 直接连接 | 前端 WASM 引擎 |
| 连接管理 | connection_manager 持久化 | 前端集成引擎 |
| LIMIT 策略 | 无自动 LIMIT | 自动添加，上限 5000 |
| 超时保护 | 无 | 30s Promise.race |
| 结果存储 | 内存直返 | ArtifactStore（压缩缓存） |
| BigInt 处理 | format_query_result_row | 显式 toString() |
| 返回格式 | 完整 JSON 信封 | artifactRef + 摘要 |

**OpenPerfetto 应学习的点：**
- perfetto-mcp 返回完整数据，LLM 立即可用；OpenPerfetto 返回 `artifactRef`，LLM 需再调用 `fetch_artifact` 才能获取实际数据
- perfetto-mcp 的分类异常处理（`ToolError`/`FileNotFoundError`/`ConnectionError`）比 OpenPerfetto 的通用 `catch` 更精准，便于 LLM 理解错误原因

**OpenPerfetto 的优势：**
- 自动 LIMIT + 超时保护更安全，防止 OOM 和长时间阻塞
- ArtifactStore 提供缓存和压缩，适合大结果集

---

#### A.1.2 Skill 调用工具对比

**perfetto-mcp: 无等价中间层**

工具直接包含完整业务逻辑，从参数验证到 SQL 执行到结果格式化一气呵成，无需中间调用层。

**OpenPerfetto: `invoke_skill.ts` (251行)**

数据流跨越 4 层：

```
Agent → InvokeSkillTool.execute()
  → WebSocket.send({ type: 'invoke_skill', skillId, params })
  → 后端 SkillProcessor 查找 YAML → 参数验证 → SQL 模板渲染
  → WebSocket 返回 { type: 'tool_result', data: { sql, params } }
  → 前端获取 SQL 文本
  → 前端 TraceProcessor 执行 SQL
  → 结果存 ArtifactStore
  → 返回 artifactRef
```

**核心差异：执行闭环 vs 执行断裂**

| 维度 | perfetto-mcp | OpenPerfetto |
|------|------|------|
| 调用层级 | 1 层（直接执行） | 4 层（invoke → WS → SkillProcessor → WS → 执行） |
| SQL 执行 | 工具内部完成 | 前端 WASM（与 SQL 生成分离） |
| 结果可用性 | 立即可用 | 需额外 fetch_artifact |
| 中间断点 | 0 个 | 至少 4 个 |
| 错误定位 | 明确（工具内部） | 模糊（哪层失败？） |

---

#### A.1.3 ANR 检测对比

**perfetto-mcp: `anr_detection.py` (160行) + `anr_root_cause.py` (470行)**

`anr_detection.py` 关键特性：
- 使用 `INCLUDE PERFETTO MODULE android.anrs` 标准模块
- 复杂子查询获取 `main_thread_state` 和 `gc_events_near_anr`
- `_analyze_anr_severity()` 方法计算严重度（MEDIUM/HIGH/CRITICAL）
- 优雅降级：模块不可用时回退到基本 slice 查询

```python
sql_query = """
INCLUDE PERFETTO MODULE android.anrs;
SELECT 
  process_name, pid, ts,
  (SELECT state FROM thread_state ts
   JOIN thread t USING(utid)
   WHERE t.upid = android_anrs.upid 
     AND t.is_main_thread = 1
     AND ts.ts <= android_anrs.ts
   ORDER BY ts.ts DESC LIMIT 1) as main_thread_state,
  (SELECT COUNT(*) FROM slice s
   WHERE s.name LIKE '%GC%'
     AND s.ts BETWEEN android_anrs.ts - 5e9 AND android_anrs.ts) as gc_events_near_anr
FROM android_anrs
"""

def _analyze_anr_severity(self, anr_data):
    severity = "MEDIUM"
    if main_thread_state in ['D', 'S']:
        severity = "HIGH"
    if gc_events > 10:
        severity = "CRITICAL"
    return severity
```

`anr_root_cause.py` 关键特性：
- 多轮分析：ANR 事件 → 主线程状态 → 锁竞争 → Binder 调用 → CPU 调度
- 每轮独立 SQL + 独立异常处理
- 最终聚合所有分析结果，给出综合根因判断

**OpenPerfetto: `detect_anr_window.yaml` + `anr_root_cause.yaml`**

`detect_anr_window.yaml` 核心 SQL：

```yaml
type: sql_query
sqlTemplate: |
  SELECT ts, dur, name 
  FROM slice 
  WHERE name LIKE '%ANR%' AND process_name = 'processName'
  ORDER BY ts
```

存在的问题：
- 使用 `LIKE '%ANR%'` 匹配不精确，可能误匹配（如 `WARNING_ANR_STYLE` 等无关 slice）
- 未使用 `android.anrs` 标准 Perfetto 模块
- 无严重度计算逻辑
- 无降级方案
- 查询结果未做业务层聚合

**对比表：**

| 维度 | perfetto-mcp | OpenPerfetto |
|------|------|------|
| ANR 识别方式 | `android.anrs` 标准模块 | `LIKE '%ANR%'` 文本匹配 |
| 严重度分析 | 有（`_analyze_anr_severity`） | 无 |
| 降级方案 | 有（模块不可用时回退） | 无 |
| 根因分析深度 | 5 轮独立分析 | 单次 SQL |
| 上下文信息 | main_thread_state, gc_events | 仅基本字段 |

---

#### A.1.4 CPU 分析对比

**perfetto-mcp: `cpu_utilization.py` (217行)**

双层 Fallback 机制——先尝试高级模块，失败后自动降级：

```python
def _query_frequency_summary(self, tp):
    # 层1: 尝试 android.dvfs 模块
    try:
        rows = list(tp.query(dvfs_sql))
    except Exception as e:
        if "android.dvfs" in msg or "no such" in msg:
            per_cpu = []  # 模块不可用，准备备用方案
        else:
            return None  # 完全失败
    
    # 层2: 如果 dvfs 无数据，尝试 cpu_counter_track
    if not per_cpu:
        try:
            rows = list(tp.query(fallback_sql))
        except Exception:
            return None
    
    return {"avgCpuFreqKHz": avg_all, "perCpu": per_cpu}
```

特性：
- 两层独立查询策略，确保至少一层返回有效数据
- 工具内部完成聚合计算（平均频率、per-CPU 统计）
- 返回结构化结果，LLM 无需自行计算

**OpenPerfetto: `cpu_scheduling_analysis.yaml`**

```yaml
type: sql_query
sqlTemplate: |
  SELECT cpu, ts, dur, utid
  FROM sched_slice
  WHERE utid IN (
    SELECT utid FROM thread WHERE upid = (
      SELECT upid FROM process WHERE name = 'processName'
    )
  )
  ORDER BY ts
  LIMIT 1000
```

存在的问题：
- 无 Fallback 机制，查询失败即完全失败
- 无 CPU 频率分析能力
- 无聚合计算（平均利用率、per-CPU 统计），返回原始 `sched_slice` 数据
- `LIMIT 1000` 可能截断重要数据，且截断发生在 `ORDER BY ts` 之后，丢失尾部事件
- 结果为原始调度片段，需 LLM 自行理解和计算

**对比表：**

| 维度 | perfetto-mcp (`cpu_utilization.py`) | OpenPerfetto (`cpu_scheduling_analysis.yaml`) |
|------|------|------|
| 查询策略 | 双层 Fallback | 单次查询 |
| CPU 频率分析 | 有（android.dvfs + counter_track） | 无 |
| 聚合计算 | 工具内计算平均值、per-CPU | 无，返回原始数据 |
| 降级处理 | 模块不可用自动降级 | 无 |
| 结果可用性 | 直接可用的统计数据 | 需 LLM 自行计算 |

---

#### A.1.5 Slice 查找对比

**perfetto-mcp: `find_slices.py` (299行)**

三种匹配模式 + 两阶段查询：

```python
supported_modes = {"contains", "exact", "glob"}

# 阶段1: 基本查找 + 聚合统计
summary_query = f"""
  SELECT name, COUNT(*), SUM(dur)/1e6, AVG(dur)/1e6, MAX(dur)/1e6
  FROM slice WHERE {match_clause}
  GROUP BY name
  ORDER BY SUM(dur) DESC LIMIT {limit}
"""

# 阶段2: 取每个 name 的 top 示例（最长的 3 个）
example_query = f"""
  SELECT * FROM slice WHERE name = '{name}'
  ORDER BY dur DESC LIMIT 3
"""
```

特性：
- `match_mode` 参数支持 `contains`/`exact`/`glob` 三种匹配模式
- `time_range` 参数支持时间范围过滤
- SQL 转义保护（`replace("'", "''")`）
- 参数范围强制（`limit`: 1-500）
- 返回聚合统计 + 具体示例，两阶段结果组合

**OpenPerfetto: 无直接对应 Skill**

OpenPerfetto 没有预定义的 Slice 查找 Skill，依赖 LLM 自行编写 SQL 或使用 `execute_sql` 工具手动查询。这意味着：
- LLM 需要知道 `slice` 表结构
- 每次可能生成不同质量的 SQL
- 无标准化的匹配模式
- 无自动聚合统计
- 查询质量完全依赖 LLM 的 SQL 能力

---

### A.2 Skills/YAML 质量逐文件分析

以下是对 OpenPerfetto 20 个 YAML Skill 文件的质量审计结果，共发现 10 个可修复问题，按优先级分类：

#### 高优先级问题 (HIGH)

| # | 文件 | 问题 | 详情 |
|---|------|------|------|
| 1 | `process_overview.yaml` | SQL 注入风险 | `processName` 参数直接拼入 SQL 模板，无转义/参数化处理。恶意输入如 `'; DROP TABLE slice; --` 可导致 SQL 注入 |
| 2 | `anr_root_cause.yaml` | 复杂条件表达式解析风险 | 多层嵌套 WHERE 条件可能因参数格式异常导致 SQL 语法错误，且错误信息不明确 |

#### 中优先级问题 (MEDIUM)

| # | 文件 | 问题 | 详情 |
|---|------|------|------|
| 3 | `memory_trend_analysis.yaml` | LIKE 过度泛化 | `name LIKE '%processName%'` 可能匹配无关进程（如 `com.example.app` 匹配到 `com.example.app.service`） |
| 4 | `cpu_scheduling_analysis.yaml` | 无 Fallback 逻辑 | 依赖单一 `sched_slice` 表，无降级方案 |
| 5 | `detect_anr_window.yaml` | 未使用标准 Perfetto 模块 | 使用 `LIKE '%ANR%'` 而非 `android.anrs` 标准模块，精度不足 |
| 6 | `startup_blocking_calls.yaml` | 无 `dur` 过滤 | 可能返回大量微秒级短调用，淹没关键阻塞调用 |
| 7 | `frame_rendering_analysis.yaml` | 浮点精度问题 | `dur/1e6` 无 `ROUND` 处理，浮点精度可能导致前端显示和验证问题 |

#### 低优先级问题 (LOW)

| # | 文件 | 问题 | 详情 |
|---|------|------|------|
| 8 | 多个 YAML 文件 | 缺少 `description` 字段 | LLM 难以准确理解 Skill 用途，可能选择错误的 Skill |
| 9 | 多个 YAML 文件 | 缺少 `examples` 字段 | 无使用示例，LLM 可能传递错误的参数格式 |
| 10 | `detect_lock_contention.yaml` | 需求定位模糊 | 仅返回基本锁事件，未区分轻重等级，分析价值有限 |

---

### A.3 数据处理流程对比

#### A.3.1 参数验证对比

**perfetto-mcp: 每个工具内部严格验证**

```python
# find_slices.py 示例 —— 逐参数严格验证
def _validate_and_normalize():
    if not isinstance(pattern, str) or not pattern.strip():
        raise ToolError("INVALID_PARAMETERS", "'pattern' must be non-empty")
    safe_pattern = pattern.strip().replace("'", "''")
    if match_mode not in {"contains", "exact", "glob"}:
        raise ToolError(...)
    limit_int = max(1, min(500, int(limit)))
    return safe_pattern, match_mode, limit_int, ...
```

特点：
- SQL 转义（单引号替换）
- 参数范围强制（`max(1, min(500, ...))`）
- 类型转换和默认值填充
- 分类异常（`ToolError` 携带错误代码）

**OpenPerfetto: 通用 JSON Schema 验证 (`tool_registry.ts`)**

```typescript
validateArgs(args, schema): string | null {
    // 1. 检查 required 字段是否存在
    // 2. 检查类型匹配 (string/number/integer/enum)
    return null; // 或返回错误字符串
}
```

后端补充 Zod Schema 验证（`yaml_parser.ts`），但仅做类型检查。

**对比结论：**
- perfetto-mcp 的验证更严格：SQL 转义、范围强制、类型转换一应俱全
- OpenPerfetto 的验证更通用但更浅：只检查类型和 required，缺少业务级验证
- OpenPerfetto 缺少 SQL 转义、范围强制等关键保护

#### A.3.2 SQL 生成对比

**perfetto-mcp: 工具内代码生成**

```python
# 字符串拼接，有基本转义
summary_query = f"SELECT ... FROM slice WHERE UPPER(name) = UPPER('{safe_name}')"
```

优点：灵活，可动态构建复杂查询（多阶段、条件分支）
缺点：SQL 注入风险（虽有转义但不完整）

**OpenPerfetto: YAML 模板 + 占位符替换**

```yaml
sqlTemplate: |
  SELECT ts, dur, name 
  FROM slice 
  WHERE process_name = 'processName'
```

优点：声明式，易于管理和审查
缺点：灵活性差，无法动态构建复杂查询；占位符替换本质上也是字符串拼接，同样存在注入风险

#### A.3.3 结果格式化对比

**perfetto-mcp: 统一 JSON 信封**

```python
# BaseTool.run_formatted() 统一格式
{
    "tracePath": "/path/to/trace",
    "processName": "com.example",
    "success": true,
    "error": null,
    "result": { /* 具体数据 */ }
}
```

每个工具都通过 `BaseTool` 返回相同结构，LLM 可立即解析和使用。

**OpenPerfetto: ArtifactStore + 间接引用**

```typescript
// 工具返回
{ success: true, artifactRef: "art_12", data: { metadata: {...} } }
// LLM 需要再调用 fetch_artifact("art_12") 获取实际数据
```

数据和引用分离，LLM 需要额外调用才能获取数据。

**对比表：**

| 维度 | perfetto-mcp | OpenPerfetto |
|------|------|------|
| 结果可用性 | 立即可用 | 需额外 fetch_artifact |
| LLM 理解成本 | 低（一次调用获得全部） | 高（需理解 artifactRef 机制） |
| 数据一致性 | 强（同步返回） | 弱（异步存取可能不一致） |
| 格式统一性 | 强（BaseTool 统一信封） | 中（各工具 metadata 格式不同） |

---

### 章节小结

通过逐文件对比，核心发现如下：

1. **执行闭环 vs 执行断裂**: perfetto-mcp 每个工具从参数验证到结果格式化一气呵成；OpenPerfetto 的 `invoke_skill` 链路跨越 4 层，SQL 生成和执行分离。
2. **业务逻辑深度**: perfetto-mcp 工具内含严重度计算、多轮分析、降级方案；OpenPerfetto YAML Skill 仅是 SQL 模板，无业务逻辑。
3. **数据质量保障**: perfetto-mcp 有参数转义、范围强制、分类异常处理；OpenPerfetto 的验证较浅。
4. **Fallback 机制**: perfetto-mcp 几乎每个分析工具都有降级方案；OpenPerfetto 完全缺失。
5. **YAML 质量**: 存在 SQL 注入风险、LIKE 过度泛化、精度问题等 10 个可修复问题。

这些发现直接指向第五章的根因分析和第六章的优化方案。

---

## 四、OpenPerfetto 当前架构深度分析

> **项目路径**: `d:\1aLq\ProFile\perfetto`

### 4.1 架构概览

OpenPerfetto 采用三层架构：

```
┌──────────────────────────────────────────────────────────┐
│  前端 Agent Loop 层                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │ AgentLoop    │  │ ContextMgr   │  │ PlanningGate   │   │
│  │ 状态机控制    │  │ 上下文管理    │  │ 规划门禁       │   │
│  │ 9类工具注册   │  │ Token预算    │  │ Prerequisites  │   │
│  └─────────────┘  └──────────────┘  └────────────────┘   │
├──────────────────────────────────────────────────────────┤
│  后端服务层 (Node.js Fastify)                              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │ LLM Proxy    │  │ SkillProc    │  │ WebSocket路由   │   │
│  │ 多Provider   │  │ YAML解析     │  │ 连接池管理      │   │
│  │ 熔断器       │  │ SQL生成      │  │ 心跳/清理       │   │
│  └─────────────┘  └──────────────┘  └────────────────┘   │
├──────────────────────────────────────────────────────────┤
│  数据处理层                                               │
│  ┌────────────────────────────────────────────────────┐   │
│  │  Trace Processor (C++ 引擎, WASM 编译)               │   │
│  │  ⚠️ 注意：后端服务层与此层的集成存在缺口                 │   │
│  └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

**架构特征**:
- 前端（TypeScript / Preact）承担了大量逻辑：Agent 状态机、工具编排、Artifact 管理、验证
- 后端（Node.js / Fastify）主要负责 LLM 代理和 Skill YAML 解析/SQL 生成
- 数据处理（Trace Processor）以 WASM 形式在浏览器端运行，后端并不直接与其通信
- **关键缺口**: 后端能生成 SQL 但不能执行 SQL，前端能执行 SQL 但不负责生成 SQL

### 4.2 Skills 系统

#### 4.2.1 Skill 定义格式

20 个预定义 Skills，以 YAML 格式存储在 `server/skills/library/` 目录下：

```yaml
# 示例: startup_blocking_calls.yaml
id: startup_blocking_calls
name: "Startup Blocking Calls Analysis"
version: "1.0"
category: startup
type: sql_query
description: "Identifies blocking calls during app startup"

parameters:
  - name: package_name
    type: string
    required: true
    description: "Target application package name"
    pattern: "^[a-zA-Z][a-zA-Z0-9_.]*$"
  - name: limit
    type: integer
    required: false
    default: 20
    min: 1
    max: 100
    description: "Maximum number of results"

sqlTemplate: |
  SELECT s.ts, s.dur, s.name, t.name as track_name
  FROM slice s
  JOIN thread_track t ON s.track_id = t.id
  JOIN thread th ON t.utid = th.utid
  JOIN process p ON th.upid = p.upid
  WHERE p.name LIKE '%${package_name}%'
    AND s.dur > 1000000
  ORDER BY dur DESC
  LIMIT ${limit}

outputSchema:
  columns:
    - name: ts
      type: integer
      unit: ns
    - name: dur
      type: integer
      unit: ns
    - name: name
      type: string
    - name: track_name
      type: string
```

#### 4.2.2 Skill 类型体系

| 类型 | 说明 | 数量 | 示例 |
|------|------|------|------|
| `sql_query` | 单一 SQL 查询 | 12 | `startup_blocking_calls`, `cpu_scheduling` |
| `sql_metric` | 使用 TraceProcessor 内置 metric | 3 | `android_startup_metric` |
| `composite` | 组合多个子 Skill | 2 | `full_startup_analysis` |
| `pipeline` | 多步顺序执行 | 2 | `startup_pipeline` |
| `diagnostic` | 诊断型（条件分支） | 1 | `auto_diagnostic` |

#### 4.2.3 Skill 分类与场景映射

前端维护 `SCENE_SKILL_MAP` 映射表，根据用户提问的场景推荐合适的 Skills：

| 场景类别 | 包含 Skills | 触发关键词 |
|---------|------------|----------|
| startup | app_startup_breakdown, startup_blocking_calls, startup_cpu_analysis | 启动、冷启动、startup |
| scrolling | scroll_jank_analysis, frame_timing | 滑动、卡顿、jank |
| anr | anr_detection, main_thread_analysis | ANR、无响应 |
| memory | memory_allocation, heap_analysis | 内存、OOM、leak |
| battery | wakelock_analysis, cpu_frequency | 功耗、电量、battery |
| rendering | gpu_analysis, surface_flinger | 渲染、帧率、GPU |
| io | io_latency, binder_analysis | IO、磁盘、binder |
| scheduling | cpu_scheduling, thread_state | 调度、线程、CPU |
| general | general_overview | 概览、总结 |

#### 4.2.4 参数验证（Zod Schema）

SkillProcessor 使用 Zod Schema 对参数进行强类型验证：

```typescript
// 根据 YAML 参数定义动态生成 Zod Schema
function buildParamSchema(paramDef: SkillParam): z.ZodType {
  let schema: z.ZodType;
  
  switch (paramDef.type) {
    case 'string':
      schema = z.string();
      if (paramDef.pattern) schema = (schema as z.ZodString).regex(new RegExp(paramDef.pattern));
      if (paramDef.enum) schema = z.enum(paramDef.enum as [string, ...string[]]);
      break;
    case 'integer':
      schema = z.number().int();
      if (paramDef.min !== undefined) schema = (schema as z.ZodNumber).min(paramDef.min);
      if (paramDef.max !== undefined) schema = (schema as z.ZodNumber).max(paramDef.max);
      break;
    // ...
  }
  
  if (!paramDef.required) {
    schema = schema.optional().default(paramDef.default);
  }
  
  return schema;
}
```

### 4.3 数据流（当前）

完整的数据流链路，标注每个环节的问题：

```
用户提问 "分析 Settings 冷启动性能"
    │
    ▼
[1] 场景分类 (LLM)
    │  Agent Loop 调用 LLM 对用户提问进行场景分类
    │  → 输出: category = "startup"
    │  ⚠️ 分类依赖 LLM，可能不稳定
    │
    ▼
[2] 上下文构建 (ContextManager)
    │  根据 Token 预算裁剪上下文
    │  注入系统提示词、场景相关 Skills 列表
    │  ⚠️ 不包含已有 Artifact 状态信息
    │
    ▼
[3] 规划门禁 (PlanningGate)
    │  检查 Prerequisites（如 trace 是否已加载）
    │  生成分析计划（Plan）
    │  ⚠️ 计划粒度较粗，缺乏执行约束
    │
    ▼
[4] LLM 流式处理
    │  发送上下文到 LLM，接收流式响应
    │  处理 text_delta / tool_use / done 事件
    │  ⚠️ text_delta 和 tool_use 边界处理不够精确
    │
    ▼
[5] 工具调用 (invoke_skill)
    │  前端通过 WebSocket 发送 invoke_skill 请求到后端
    │  ⚠️ 不检查是否已有相同调用的结果
    │
    ▼
[6] 后端 SkillProcessor
    │  验证参数 (Zod Schema)
    │  从 YAML 模板生成 SQL
    │  ⚠️ 只生成 SQL，不执行 SQL
    │
    ▼
[7] 返回 SQL 文本
    │  WebSocket 返回 skill_result，内含 SQL 文本
    │  ⚠️ 数据流断裂点 #1：SQL 需要前端另行执行
    │
    ▼
[8] 前端 execute_sql
    │  前端提取 SQL，通过 Trace Processor WASM 执行
    │  ⚠️ 数据流断裂点 #2：执行环境与生成环境不同
    │
    ▼
[9] ArtifactStore 存储
    │  将查询结果存入 ArtifactStore
    │  ⚠️ 只增不删，无版本管理，无状态标记
    │
    ▼
[10] LLM 继续分析
    │  LLM 可能引用 Artifact 数据进行分析
    │  ⚠️ Artifact 数据可能不在 LLM 上下文中
    │
    ▼
[11] 验证 (VERIFYING)
    │  对 Artifact 数据进行质量验证
    │  ⚠️ 验证失败的修正机制无效
    │
    ▼
[12] 展示
    最终报告呈现给用户
```

### 4.4 关键组件分析

#### 4.4.1 WebSocket 通信协议

**客户端 → 服务器消息类型**:

| 消息类型 | 用途 | Payload |
|---------|------|---------|
| `ping` | 心跳检测 | `{ type: "ping" }` |
| `chat` | 用户对话消息 | `{ type: "chat", message: string, context?: object }` |
| `invoke_skill` | 调用 Skill | `{ type: "invoke_skill", skillId: string, params: object }` |
| `execute_sql` | 直接执行 SQL | `{ type: "execute_sql", sql: string }` |

**服务器 → 客户端消息类型**:

| 消息类型 | 用途 | Payload |
|---------|------|---------|
| `pong` | 心跳响应 | `{ type: "pong" }` |
| `chat_delta` | 流式文本片段 | `{ type: "chat_delta", delta: string }` |
| `tool_use` | 工具调用通知 | `{ type: "tool_use", tool: string, args: object }` |
| `error` | 错误通知 | `{ type: "error", code: string, message: string }` |
| `skill_result` | Skill 执行结果 | `{ type: "skill_result", skillId: string, sql: string, ... }` |

**连接池管理**:
- 最大连接数限制
- 30 秒心跳间隔
- 僵尸连接自动清理（超过 2 分钟无心跳）
- **问题**: 背压时直接丢弃非高优消息（如 `chat_delta`），可能导致文本不完整

#### 4.4.2 LLMProxy

```typescript
class LLMProxy {
  private providers: Map<string, LLMProvider>;
  private circuitBreaker: CircuitBreaker;
  
  // 熔断器三态管理
  // CLOSED: 正常状态，所有请求通过
  // OPEN: 熔断状态，所有请求直接拒绝（30秒后转 HALF_OPEN）
  // HALF_OPEN: 半开状态，允许一个请求通过，成功则转 CLOSED，失败则转 OPEN
  
  // 阈值: 连续 5 次失败触发熔断
  // 重置时间: 30 秒
}
```

**问题**:
1. **无 Provider 级别独立熔断**: 如果 OpenAI 不可用，整个 LLMProxy 熔断，即使 Anthropic 是健康的
2. **无重试策略**: 请求失败直接返回错误，没有 retry with backoff
3. **无降级策略**: 熔断时没有 fallback Provider

#### 4.4.3 Agent Loop 状态机

```
                    ┌──────────────┐
                    │  CLASSIFYING  │
                    │  场景分类     │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ BUILDING_CTX  │
                    │ 构建上下文    │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ AWAITING_PLAN │
                    │ 等待规划      │
                    └──────┬───────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │      AWAITING_LLM       │◄──────────┐
              │      等待 LLM 响应       │           │
              └──────────┬──────────────┘           │
                         │                          │
                    ┌────┴────┐                     │
                    │         │                     │
               text_delta  tool_use                 │
                    │         │                     │
                    ▼         ▼                     │
              ┌──────┐  ┌──────────────┐            │
              │ 输出  │  │EXECUTING_TOOL│            │
              │ 文本  │  │ 执行工具     │            │
              └──────┘  └──────┬───────┘            │
                               │                    │
                               ▼                    │
                        ┌──────────────┐            │
                        │  VERIFYING    │────────────┘
                        │  验证结果     │  (验证失败, 重试)
                        └──────┬───────┘
                               │ (验证通过或全部完成)
                               ▼
                        ┌──────────────┐
                        │   COMPLETE    │
                        │   完成       │
                        └──────────────┘
```

**PlanningGate 规划门禁**:
- 在 `AWAITING_PLAN` 阶段，检查分析的前提条件（Prerequisites）
- 前提条件包括: trace 文件已加载、包名已确认、分析场景已识别
- 前提条件不满足时，会要求用户补充信息

**问题**:
- 工具执行状态与 LLM 上下文同步不足: 工具执行完成后，结果存入 ArtifactStore，但在下次 LLM 调用时，上下文可能没有包含这些结果
- 验证失败的重试逻辑过于简单: 只是回到 `AWAITING_LLM`，让 LLM 自己决定如何修正

---

## 五、根因分析：对话问题到架构缺陷的映射

### 5.1 根因矩阵

| 对话问题 | 严重等级 | 直接原因 | 架构缺陷 | perfetto-mcp 如何规避 |
|---------|---------|---------|---------|---------------------|
| **P0-1 工具重复调用** | P0 | Agent Loop 执行 `invoke_skill` 前不检查调用历史 | 缺少调用历史感知机制；LLM 上下文不含已调用工具信息 | `BaseTool` 的 `execute_with_connection` 统一管理，工具返回结果直接在 MCP 协议中可见 |
| **P0-2 时间戳验证失败** | P0 | SQL 模板 `ORDER BY dur DESC` 导致 ts 乱序 | SQL 模板无质量预校验；验证规则与 Skill 语义不匹配 | SQL 构建在工具内部完成，有参数验证前置；两阶段查询分离排序需求 |
| **P0-3 虚假修正循环** | P0 | 验证失败错误信息不够具体，LLM 无法理解如何修正 | 验证-修正缺乏结构化约束；错误信息未包含修正指引 | 统一错误码（code + message + details）提供足够信息指导修正 |
| **P1-4 报告文本混乱** | P1 | 流式输出缓冲区在工具调用边界未正确刷新 | 文本刷新时机不精确；缺乏流式输出状态机 | MCP 协议天然分离文本和工具调用，不存在混合可能 |
| **P1-5 工具数据未使用** | P1 | Artifact 数据未被注入 LLM 上下文 | 工具结果与 LLM 上下文断裂 | 工具结果直接作为 JSON 返回给 MCP 客户端，自动成为对话上下文 |
| **P1-6 阶段执行与报告不对应** | P1 | 多阶段分析结果散落在 ArtifactStore，报告生成时 LLM 无法完整引用 | 缺乏报告完整性验证 | 每个工具返回完整结果，不需要跨工具聚合 |
| **P1-7 SQL 参数泛化** | P1 | YAML 模板中 `LIKE '%${package_name}%'` 模式 | SQL 模板缺乏精确匹配模式；参数定义无 matchMode 字段 | 支持 exact/contains/glob 三种匹配模式，根据场景选择 |
| **P2-8 数据来源不透明** | P2 | 报告中未标注数据来自哪个 Artifact | 缺少引用追溯机制 | 每个结果自带 tracePath 和查询信息 |
| **P2-9 缺少交叉验证** | P2 | Skills 之间独立执行，无交叉验证 | 缺少 Skill 关联机制 | 工具独立但结果统一格式，AI 可自行交叉分析 |
| **P2-10 建议不可操作** | P2 | 分析 Skill 只提供原始数据 | 缺少"数据→建议"推理模板 | 工具提供摘要统计，AI 基于数据生成建议 |
| **P2-11 基准值无依据** | P2 | 系统无性能基准知识库 | 缺少参考基准数据 | 未专门解决，但错误信息更清晰 |

### 5.2 架构层面的系统性根因

#### 根因A：数据流链路断裂

**核心问题**: OpenPerfetto 的数据流在"后端生成 SQL → 前端执行 SQL → 结果存 ArtifactStore"这一段存在**两次跨边界传输**，每次传输都是一个潜在的失败点和信息损失点。

**后果链**:

```
SQL 生成与执行分离
    │
    ├──► 执行环境不同（后端 Node.js vs 前端 WASM）
    │       │
    │       └──► 无法在生成时验证 SQL 可执行性
    │
    ├──► 结果格式不统一
    │       │
    │       └──► ArtifactStore 数据结构不规范
    │               │
    │               └──► LLM 无法可靠解析
    │                       │
    │                       └──► 分析质量下降
    │
    └──► 错误处理分散
            │
            ├──► SQL 语法错误在前端才被发现
            ├──► 后端无法提供针对执行错误的修正建议
            └──► 错误信息缺乏上下文
```

**与 perfetto-mcp 对比**: perfetto-mcp 的工具内部完成"SQL 构建 + 执行 + 格式化"的完整闭环，不存在跨层传输。

---

#### 根因B：工具抽象层级不当

**核心问题**: OpenPerfetto 的工具是**"操作级"抽象**，而 perfetto-mcp 的工具是**"分析单元级"抽象**。

| 维度 | OpenPerfetto（操作级） | perfetto-mcp（分析单元级） |
|------|---------------------|------------------------|
| 工具粒度 | `invoke_skill`、`execute_sql`、`fetch_artifact` 是独立工具 | `detect_anrs`、`find_slices` 每个工具完成一个完整分析 |
| 完成一次分析需要 | LLM 编排 3-5 个工具调用 | LLM 调用 1 个工具 |
| 编排逻辑 | 依赖 LLM 推理 | 内置于工具代码 |
| 出错概率 | 高（每个编排步骤都可能出错） | 低（闭环内部处理） |

**后果链**:

```
操作级抽象
    │
    ├──► LLM 需要编排多个工具完成一次分析
    │       │
    │       ├──► 编排逻辑依赖 LLM 推理能力
    │       │       │
    │       │       └──► 容易出错/遗漏/重复
    │       │
    │       └──► 编排步骤越多，上下文越长
    │               │
    │               └──► Token 消耗增加，延迟增加
    │
    └──► 工具之间的数据传递依赖中间存储（ArtifactStore）
            │
            └──► 中间存储的数据可能不完整/不规范
```

---

#### 根因C：Artifact 生命周期管理缺失

**核心问题**: ArtifactStore 是一个**只增不替、无状态管理**的数据存储。

**当前 Artifact 生命周期**:

```
创建 (invoke_skill 返回结果)
    │
    ▼
存储 (ArtifactStore.set)
    │
    ▼
引用 (LLM 通过 fetch_artifact 获取)
    │
    ▼
永久存在（无清理、无失效、无版本）
```

**问题**:
1. **验证失败后旧数据持续存在**: art_6 被标记为"时间戳验证失败"，但数据仍然在 ArtifactStore 中，LLM 可能再次引用它
2. **重新执行后产生新 Artifact**: 修正后可能生成 art_7，但 art_6 没有被标记为"已替代"
3. **LLM 无法区分有效和无效 Artifact**: 上下文中可能同时存在 art_6（无效）和 art_7（有效），LLM 可能错误地引用 art_6

---

#### 根因D：LLM 上下文与工具状态不同步

**核心问题**: LLM 在每次推理时缺乏关键的状态信息。

**LLM 应该知道但不知道的信息**:

| 信息类别 | 当前状态 | 影响 |
|---------|---------|------|
| 已存在的 Artifact 列表及内容摘要 | ❌ 不在上下文中 | LLM 可能重复获取已有数据 |
| 已调用的工具历史及参数 | ❌ 不在上下文中 | LLM 可能重复调用相同工具 |
| 验证失败的具体原因和修正指引 | ⚠️ 仅有模糊错误信息 | LLM 无法有效修正问题 |
| 剩余 Token 预算 | ❌ 不在上下文中 | LLM 可能生成超出预算的内容 |
| 当前分析进度 | ❌ 不在上下文中 | LLM 可能遗漏未完成的分析阶段 |

---

## 六、系统性优化方案

### 6.1 方案一：重构 Skill 执行为闭环模式 ~~（P0，核心方案）~~ [不可行 - 与架构约束冲突]

> **[架构约束冲突 - 方案不可行]**
> 
> 本方案提出将 SQL 执行移至后端（通过 TraceProcessorBridge），但当前 OpenPerfetto 的核心架构约束是：
> **trace 解析和 SQL 查询的执行在前端 WASM Trace Processor 中完成**。将 SQL 执行移至后端
> 违反了这一架构设计原则。因此本方案不予实施，保留作为参考分析。
> 
> 可行的替代路径是方案二至方案七，在维持"前端执行 SQL"架构不变的前提下，
> 从 Artifact 生命周期、工具去重、验证闭环、SQL 模板质量、流式可靠性、LLM 上下文等维度进行优化。

#### 目标

将当前的"SQL 生成 → 远程执行 → 结果存储"断裂链路，改造为"Skill 内部闭环执行"。

#### 当前链路 vs 优化后链路

**当前链路（断裂）**:

```
LLM
 │
 ▼ invoke_skill(skillId, params)
前端 Agent Loop
 │
 ▼ WebSocket
后端 SkillProcessor
 │  ├─ validateParams()     ✅ 在后端
 │  └─ generateSQL()        ✅ 在后端
 │
 ▼ 返回 SQL 文本
前端 Agent Loop
 │
 ▼ execute_sql(sql)
Trace Processor (WASM)     ⚠️ 执行在前端
 │
 ▼ 返回结果
ArtifactStore              ⚠️ 存储在前端
 │
 ▼ fetch_artifact(artifactId)
LLM                        ⚠️ 需要再次调用工具获取数据
```

**优化后链路（闭环）**:

```
LLM
 │
 ▼ invoke_skill(skillId, params)
前端 Agent Loop
 │
 ▼ WebSocket
后端 SkillProcessor
 │  ├─ validateParams()                ✅ 在后端
 │  ├─ generateSQL()                   ✅ 在后端
 │  ├─ TraceProcessorBridge.execute()  ✅ 在后端（新增）
 │  └─ formatResult()                  ✅ 在后端（新增）
 │
 ▼ 返回完整结果（统一信封）
前端 Agent Loop
 │  └─ ArtifactStore.set()            自动存储
 │
 ▼ 结果摘要自动注入 LLM 上下文
LLM                                   无需再次调用工具
```

#### 具体实现要点

##### 1. 新增 TraceProcessorBridge 模块

**文件路径**: `server/src/services/trace_processor_bridge.ts`

```typescript
import { EventEmitter } from 'events';

interface TraceProcessorConnection {
  id: string;
  tracePath: string;
  status: 'connecting' | 'ready' | 'error' | 'closed';
  lastHealthCheck: number;
  instance: TraceProcessorInstance; // WASM 或 HTTP 实例
}

interface QueryResult {
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  executionTimeMs: number;
}

class TraceProcessorBridge extends EventEmitter {
  private connections: Map<string, TraceProcessorConnection> = new Map();
  private readonly healthCheckIntervalMs = 30_000;
  private readonly connectionTimeoutMs = 10_000;
  private readonly maxConnections = 5;

  /**
   * 获取或创建到指定 trace 文件的连接
   * 参考 perfetto-mcp 的 ConnectionManager 设计
   */
  async getConnection(tracePath: string): Promise<TraceProcessorConnection> {
    // 1. 检查缓存
    const existing = this.connections.get(tracePath);
    if (existing && existing.status === 'ready') {
      // 2. 健康检查
      if (await this.isHealthy(existing)) {
        return existing;
      }
      // 连接不健康，清除
      await this.closeConnection(tracePath);
    }

    // 3. 检查连接数上限
    if (this.connections.size >= this.maxConnections) {
      await this.evictOldestConnection();
    }

    // 4. 创建新连接
    return await this.createConnection(tracePath);
  }

  /**
   * 执行 SQL 查询
   */
  async executeSql(tracePath: string, sql: string): Promise<QueryResult> {
    const startTime = Date.now();
    const conn = await this.getConnection(tracePath);
    
    try {
      const rawResult = await conn.instance.query(sql);
      return {
        columns: this.extractColumns(rawResult),
        rows: this.extractRows(rawResult),
        rowCount: rawResult.numRows,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      // 区分连接错误和查询错误
      if (this.isConnectionError(error)) {
        // 连接错误：尝试重连一次
        await this.closeConnection(tracePath);
        const newConn = await this.createConnection(tracePath);
        const rawResult = await newConn.instance.query(sql);
        return {
          columns: this.extractColumns(rawResult),
          rows: this.extractRows(rawResult),
          rowCount: rawResult.numRows,
          executionTimeMs: Date.now() - startTime,
        };
      }
      // 查询错误：直接抛出
      throw error;
    }
  }

  /**
   * 轻量健康检查
   */
  private async isHealthy(conn: TraceProcessorConnection): Promise<boolean> {
    try {
      await conn.instance.query('SELECT 1');
      conn.lastHealthCheck = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 淘汰最旧的连接（LRU 策略）
   */
  private async evictOldestConnection(): Promise<void> {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [path, conn] of this.connections) {
      if (conn.lastHealthCheck < oldestTime) {
        oldestTime = conn.lastHealthCheck;
        oldest = path;
      }
    }
    if (oldest) {
      await this.closeConnection(oldest);
    }
  }
}
```

##### 2. 改造 SkillProcessor

**文件路径**: `server/src/services/skill_processor.ts`

在现有的 `validateParams()` 和 `generateSQL()` 基础上，新增 `executeSkillComplete()` 方法：

```typescript
interface SkillExecutionResult {
  success: boolean;
  skillId: string;
  skillName: string;
  query: string;           // 实际执行的 SQL
  executionTimeMs: number;
  error?: {
    code: string;          // 标准错误码
    message: string;       // 人类可读的错误描述
    details?: string;      // 详细的技术信息
  };
  result: {
    columns: Array<{
      name: string;
      type: string;
      unit?: string;       // 'ms' | 'ns' | 'bytes' | '%' 等
    }>;
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    truncated: boolean;    // 是否因 LIMIT 而截断
    metadata?: {
      orderBy?: string;    // 排序方式（用于验证规则匹配）
      filterConditions?: string[];  // 过滤条件（用于透明度）
    };
  };
  summary?: {              // 自动计算的摘要统计
    numericColumns: Record<string, {
      min: number; max: number; avg: number; sum: number;
    }>;
  };
}

class SkillProcessor {
  private bridge: TraceProcessorBridge;

  /**
   * 完整闭环执行 Skill
   * 参数验证 → SQL 生成 → SQL 执行 → 结果格式化 → 信封包装
   */
  async executeSkillComplete(
    skillId: string,
    params: Record<string, unknown>,
    tracePath: string
  ): Promise<SkillExecutionResult> {
    const skill = this.registry.getSkill(skillId);
    if (!skill) {
      return this.buildErrorResult(skillId, 'SKILL_NOT_FOUND',
        `Skill '${skillId}' not found in registry`);
    }

    // 1. 参数验证
    const validationResult = this.validateParams(skill, params);
    if (!validationResult.success) {
      return this.buildErrorResult(skillId, 'INVALID_PARAMETERS',
        validationResult.error.message,
        `Parameters: ${JSON.stringify(params)}\n` +
        `Validation errors: ${JSON.stringify(validationResult.error.details)}`);
    }

    // 2. SQL 生成
    const sql = this.generateSQL(skill, validationResult.data);

    // 3. SQL 预校验（新增）
    const preCheck = this.preCheckSQL(sql, skill);
    if (!preCheck.passed) {
      return this.buildErrorResult(skillId, 'SQL_PRECHECK_FAILED',
        preCheck.message, preCheck.details);
    }

    // 4. SQL 执行
    try {
      const queryResult = await this.bridge.executeSql(tracePath, sql);

      // 5. 结果格式化
      const formattedResult = this.formatResult(queryResult, skill);

      // 6. 构建信封
      return {
        success: true,
        skillId,
        skillName: skill.name,
        query: sql,
        executionTimeMs: queryResult.executionTimeMs,
        result: formattedResult,
        summary: this.computeSummary(queryResult, skill),
      };
    } catch (error) {
      return this.buildErrorResult(skillId, 'QUERY_EXECUTION_ERROR',
        `SQL execution failed: ${error.message}`,
        `SQL: ${sql}\nStack: ${error.stack}`);
    }
  }

  /**
   * SQL 预校验
   */
  private preCheckSQL(sql: string, skill: SkillDefinition): PreCheckResult {
    const issues: string[] = [];

    // 检查 SQL 大小
    if (sql.length > 1_000_000) {
      issues.push('SQL exceeds 1MB size limit');
    }

    // 对时间序列类 Skill，检查 ORDER BY
    if (skill.outputSchema?.columns?.some(c => c.name === 'ts' && c.unit === 'ns')) {
      if (!sql.toUpperCase().includes('ORDER BY')) {
        issues.push('Time-series query missing ORDER BY clause');
      }
    }

    // 检查是否有 LIMIT
    if (!sql.toUpperCase().includes('LIMIT')) {
      issues.push('Query missing LIMIT clause, may return too many rows');
    }

    return {
      passed: issues.length === 0,
      message: issues.join('; '),
      details: `SQL: ${sql}`,
    };
  }

  /**
   * 结果格式化：单位转换、列类型标注
   */
  private formatResult(queryResult: QueryResult, skill: SkillDefinition) {
    const columns = queryResult.columns.map(col => {
      const schemaDef = skill.outputSchema?.columns?.find(c => c.name === col.name);
      return {
        name: col.name,
        type: col.type,
        unit: schemaDef?.unit,
      };
    });

    // 单位转换：ns → ms
    const rows = queryResult.rows.map(row => {
      const converted = { ...row };
      for (const col of columns) {
        if (col.unit === 'ns' && typeof converted[col.name] === 'number') {
          converted[`${col.name}_ms`] = (converted[col.name] as number) / 1_000_000;
        }
      }
      return converted;
    });

    return {
      columns,
      rows,
      rowCount: queryResult.rowCount,
      truncated: sql.toUpperCase().includes('LIMIT'),
    };
  }
}
```

##### 3. 结果自动包含 outputSchema 验证

在 `executeSkillComplete()` 返回前，自动验证：
- 返回的列是否与 `outputSchema.columns` 匹配
- 数据类型是否一致
- 单位转换是否已执行

```typescript
/**
 * 输出 Schema 验证
 */
private validateOutputSchema(
  result: QueryResult, 
  skill: SkillDefinition
): OutputValidationResult {
  if (!skill.outputSchema?.columns) {
    return { valid: true, warnings: [] };
  }

  const warnings: string[] = [];
  const expectedColumns = skill.outputSchema.columns.map(c => c.name);
  const actualColumns = result.columns.map(c => c.name);

  // 检查缺失的列
  for (const expected of expectedColumns) {
    if (!actualColumns.includes(expected)) {
      warnings.push(`Expected column '${expected}' not found in result`);
    }
  }

  // 检查多余的列
  for (const actual of actualColumns) {
    if (!expectedColumns.includes(actual)) {
      warnings.push(`Unexpected column '${actual}' in result`);
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
```

---

### 6.2 方案二：Artifact 生命周期管理（P0）

#### 目标

建立 Artifact 版本控制和状态管理，解决"虚假修正"和"过期数据引用"问题。

#### 当前 → 目标

- **当前**: Artifact 只增不删，无状态标记，LLM 可能引用无效数据
- **目标**: Artifact 有状态流转、版本控制、自动清理机制

#### Artifact 状态模型

```
                ┌──────────┐
                │ PENDING   │   Skill 开始执行，Artifact 已创建但无数据
                └────┬─────┘
                     │
              ┌──────┴──────┐
              │              │
              ▼              ▼
        ┌──────────┐  ┌──────────┐
        │  VALID    │  │  FAILED   │   执行成功 / 执行失败
        └────┬─────┘  └────┬─────┘
             │              │
             ▼              │
        ┌──────────┐        │
        │INVALIDATED│◄──────┘   验证失败 或 被新版本替代
        └──────────┘
```

#### 实现要点

##### 1. Artifact 数据结构增强

```typescript
interface Artifact {
  id: string;                   // 如 "art_1"
  version: number;              // 版本号: 1, 2, 3, ...
  status: 'PENDING' | 'VALID' | 'FAILED' | 'INVALIDATED';
  
  // 来源信息
  sourceSkillId: string;        // 产生此 Artifact 的 Skill
  sourceParams: Record<string, unknown>;  // Skill 参数
  sourceSQL: string;            // 实际执行的 SQL
  
  // 数据
  data: SkillExecutionResult | null;  // 执行结果（PENDING 时为 null）
  
  // 时间信息
  createdAt: number;
  updatedAt: number;
  
  // 版本关系
  previousVersion?: string;     // 前一版本的 Artifact ID
  replacedBy?: string;          // 替代此版本的新 Artifact ID
  
  // 验证信息
  validationResult?: {
    passed: boolean;
    failures: ValidationFailure[];
    checkedAt: number;
  };
}
```

##### 2. ArtifactStore 增强

```typescript
class ArtifactStore {
  private artifacts: Map<string, Artifact> = new Map();
  private skillArtifactMap: Map<string, string[]> = new Map();  // skillId+paramsHash → artifactIds

  /**
   * 创建新 Artifact（PENDING 状态）
   */
  createPending(skillId: string, params: Record<string, unknown>): string {
    const id = this.generateId();
    const artifact: Artifact = {
      id,
      version: this.getNextVersion(skillId, params),
      status: 'PENDING',
      sourceSkillId: skillId,
      sourceParams: params,
      sourceSQL: '',
      data: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.artifacts.set(id, artifact);
    return id;
  }

  /**
   * 更新 Artifact 为 VALID（执行成功）
   */
  markValid(id: string, result: SkillExecutionResult): void {
    const artifact = this.artifacts.get(id);
    if (!artifact) throw new Error(`Artifact ${id} not found`);
    
    artifact.status = 'VALID';
    artifact.data = result;
    artifact.sourceSQL = result.query;
    artifact.updatedAt = Date.now();
    
    // 将同一 Skill+Params 的旧版本标记为 INVALIDATED
    this.invalidatePreviousVersions(artifact);
  }

  /**
   * 标记 Artifact 为 INVALIDATED
   */
  markInvalidated(id: string, reason: string): void {
    const artifact = this.artifacts.get(id);
    if (!artifact) return;
    artifact.status = 'INVALIDATED';
    artifact.updatedAt = Date.now();
  }

  /**
   * 获取所有 VALID 状态的 Artifact 摘要
   * 用于注入 LLM 上下文
   */
  getValidArtifactSummaries(): ArtifactSummary[] {
    return Array.from(this.artifacts.values())
      .filter(a => a.status === 'VALID')
      .map(a => ({
        id: a.id,
        skillId: a.sourceSkillId,
        version: a.version,
        status: a.status,
        rowCount: a.data?.result?.rowCount ?? 0,
        columns: a.data?.result?.columns?.map(c => c.name) ?? [],
        summary: a.data?.summary,
        createdAt: a.createdAt,
      }));
  }

  /**
   * 获取完整的 Artifact 状态报告
   * 用于注入 LLM 上下文
   */
  getStatusReport(): string {
    const artifacts = Array.from(this.artifacts.values());
    if (artifacts.length === 0) return '当前没有已获取的分析数据。';

    let report = '当前已获取的分析数据:\n';
    for (const a of artifacts) {
      const statusIcon = {
        VALID: '✅',
        PENDING: '⏳',
        FAILED: '❌',
        INVALIDATED: '🚫',
      }[a.status];
      
      report += `- ${a.id} (${a.sourceSkillId}, v${a.version}, ${statusIcon} ${a.status})`;
      if (a.status === 'VALID' && a.data) {
        report += `: ${a.data.result.rowCount}行数据`;
        if (a.data.summary) {
          report += `，关键指标: ${JSON.stringify(a.data.summary.numericColumns)}`;
        }
      } else if (a.status === 'INVALIDATED') {
        report += `: 已失效，需重新获取`;
      } else if (a.status === 'FAILED') {
        report += `: 执行失败 - ${a.data?.error?.message}`;
      }
      report += '\n';
    }
    return report;
  }
}
```

##### 3. Artifact 摘要注入到 LLM 上下文

在每次 LLM 调用前，由 ContextManager 自动注入 Artifact 状态：

```typescript
// context_manager.ts 中的增强
class ContextManager {
  buildContext(artifactStore: ArtifactStore, callHistory: ToolCallHistory): LLMContext {
    const context = this.buildBaseContext();
    
    // 注入 Artifact 状态摘要
    context.systemPrompt += '\n\n' + artifactStore.getStatusReport();
    
    // 注入工具调用历史
    context.systemPrompt += '\n\n' + callHistory.getSummary();
    
    return context;
  }
}
```

**注入效果示例**:

```
当前已获取的分析数据:
- art_1 (app_startup_breakdown, v1, ✅ VALID): 12行数据，关键指标: {"dur_ms": {"min": 0.5, "max": 245.3, "avg": 32.9, "sum": 395.1}}
- art_2 (startup_blocking_calls, v1, 🚫 INVALIDATED): 已失效，需重新获取
- art_3 (startup_blocking_calls, v2, ✅ VALID): 20行数据，关键指标: {"dur_ms": {"min": 1.2, "max": 89.7, "avg": 15.6, "sum": 312.4}}
- art_4 (startup_cpu_analysis, v1, ✅ VALID): 8行数据，关键指标: {"cpu_percent": {"min": 12.3, "max": 98.7, "avg": 45.2}}
```

---

### 6.3 方案三：工具调用去重与编排优化（P0）

#### 目标

防止 LLM 重复调用相同工具，并优化工具编排效率。

#### 当前 → 目标

- **当前**: LLM 每次决定调用工具，系统无条件执行
- **目标**: 系统自动检测重复调用，复用已有结果

#### 实现要点

##### 1. 调用历史记录

```typescript
interface CallHistoryEntry {
  callKey: string;           // skillId + paramsHash
  artifactId: string;        // 关联的 Artifact ID
  timestamp: number;
  status: 'success' | 'failed';
}

class ToolCallHistory {
  private history: Map<string, CallHistoryEntry> = new Map();
  private readonly defaultTTLMs = 5 * 60 * 1000;  // 5分钟 TTL

  /**
   * 计算调用键（用于去重）
   */
  computeCallKey(skillId: string, params: Record<string, unknown>): string {
    const sortedParams = JSON.stringify(params, Object.keys(params).sort());
    return `${skillId}::${this.hash(sortedParams)}`;
  }

  /**
   * 检查是否有相同的成功调用
   */
  findExisting(skillId: string, params: Record<string, unknown>): CallHistoryEntry | null {
    const key = this.computeCallKey(skillId, params);
    const entry = this.history.get(key);
    
    if (!entry) return null;
    if (entry.status !== 'success') return null;
    if (this.isExpired(entry)) return null;
    
    return entry;
  }

  /**
   * 记录新的调用
   */
  record(skillId: string, params: Record<string, unknown>, 
         artifactId: string, status: 'success' | 'failed'): void {
    const key = this.computeCallKey(skillId, params);
    this.history.set(key, {
      callKey: key,
      artifactId,
      timestamp: Date.now(),
      status,
    });
  }

  /**
   * 生成调用历史摘要（注入 LLM 上下文）
   */
  getSummary(): string {
    if (this.history.size === 0) return '尚未调用任何分析工具。';
    
    let summary = '已调用的分析工具:\n';
    for (const [key, entry] of this.history) {
      const statusIcon = entry.status === 'success' ? '✅' : '❌';
      summary += `- ${statusIcon} ${key} → ${entry.artifactId}\n`;
    }
    summary += '\n⚠️ 请不要重复调用已成功执行的工具（除非需要不同的参数）。';
    return summary;
  }
}
```

##### 2. 工具调用拦截器

```typescript
interface InterceptResult {
  action: 'EXECUTE' | 'REUSE' | 'BLOCK';
  artifactId?: string;      // REUSE 时提供
  reason?: string;           // BLOCK 时提供
}

class ToolCallInterceptor {
  private callHistory: ToolCallHistory;
  private artifactStore: ArtifactStore;

  /**
   * 拦截工具调用，决定执行策略
   */
  async intercept(
    toolName: string, 
    args: Record<string, unknown>
  ): Promise<InterceptResult> {
    if (toolName !== 'invoke_skill') {
      return { action: 'EXECUTE' };
    }

    const skillId = args.skillId as string;
    const params = args.params as Record<string, unknown>;

    // 1. 检查是否有相同的成功调用
    const existing = this.callHistory.findExisting(skillId, params);
    if (existing) {
      // 2. 验证关联的 Artifact 仍然有效
      const artifact = this.artifactStore.get(existing.artifactId);
      if (artifact && artifact.status === 'VALID') {
        return {
          action: 'REUSE',
          artifactId: existing.artifactId,
          reason: `Skill '${skillId}' with same parameters was already executed. ` +
                  `Result available in ${existing.artifactId}.`,
        };
      }
    }

    return { action: 'EXECUTE' };
  }
}
```

##### 3. Agent Loop 集成

在 `agent_loop.ts` 的工具执行环节加入拦截逻辑：

```typescript
// agent_loop.ts 中的增强
async handleToolUse(toolName: string, args: Record<string, unknown>) {
  // 拦截检查
  const interceptResult = await this.interceptor.intercept(toolName, args);
  
  switch (interceptResult.action) {
    case 'REUSE':
      // 不执行工具，直接返回已有结果
      return {
        type: 'tool_result',
        content: `已有相同查询的结果: ${interceptResult.artifactId}。` +
                 `请直接使用该 Artifact 的数据，无需重新查询。`,
        artifactId: interceptResult.artifactId,
      };
    
    case 'EXECUTE':
      // 正常执行
      const result = await this.executeToolCall(toolName, args);
      // 记录调用历史
      this.callHistory.record(
        args.skillId as string, 
        args.params as Record<string, unknown>,
        result.artifactId,
        result.success ? 'success' : 'failed'
      );
      return result;
    
    case 'BLOCK':
      return {
        type: 'tool_result',
        content: `工具调用被阻止: ${interceptResult.reason}`,
      };
  }
}
```

---

### 6.4 方案四：验证-修正的结构化闭环（P1）

#### 目标

验证失败时提供精确的修正指引，强制执行修正动作，避免 LLM"虚假修正"。

#### 当前 → 目标

- **当前**: 验证失败 → 模糊错误信息 → LLM 自由发挥 → 无效修正 → 达到最大重试
- **目标**: 验证失败 → 结构化错误 + 精确修正指引 → 自动/半自动修正 → 重新验证

#### 实现要点

##### 1. 结构化验证失败信息

```typescript
interface ValidationFailure {
  ruleId: string;                    // 规则 ID，如 "TIMESTAMP_MONOTONIC"
  artifactId: string;                // 验证失败的 Artifact
  severity: 'error' | 'warning';     // 严重等级
  description: string;               // 人类可读的描述
  
  // 关键：具体修正指引
  fixGuidance: {
    action: FixAction;
    targetSkillId?: string;
    suggestedSqlModification?: string;
    suggestedParameters?: Record<string, unknown>;
    autoFixAvailable: boolean;       // 是否可以自动修正
  };
  
  // 诊断信息
  diagnostics: {
    actualValue?: unknown;           // 实际值
    expectedValue?: unknown;         // 期望值
    affectedRows?: number[];         // 受影响的行号
    relevantSqlClause?: string;      // 相关的 SQL 子句
  };
}

type FixAction = 
  | 'RE_EXECUTE_SKILL'        // 重新执行 Skill（可能需要不同参数）
  | 'MODIFY_SQL_ORDER_BY'     // 修改 ORDER BY 子句
  | 'MODIFY_SQL_WHERE'        // 修改 WHERE 子句
  | 'CHANGE_PARAMETER'        // 修改 Skill 参数
  | 'SKIP_VALIDATION_RULE'    // 跳过此验证规则（规则不适用时）
  | 'MANUAL_FIX_REQUIRED';    // 需要人工修正
```

##### 2. 验证规则与 Skill 语义匹配

```typescript
class SemanticValidator {
  /**
   * 根据 Skill 语义选择适用的验证规则
   */
  getApplicableRules(skill: SkillDefinition, result: SkillExecutionResult): ValidationRule[] {
    const rules: ValidationRule[] = [];
    
    // 通用规则：所有 Skill 都适用
    rules.push(new NonEmptyResultRule());
    rules.push(new ColumnSchemaMatchRule());
    
    // 条件规则：根据 Skill 语义决定
    const orderByClause = result.result.metadata?.orderBy;
    
    if (orderByClause?.includes('ts ASC') || orderByClause?.includes('ts')) {
      // 只有按时间排序的结果才检查时间戳单调性
      rules.push(new TimestampMonotonicRule());
    }
    
    if (skill.type === 'sql_metric') {
      // 指标类 Skill 检查数值合理性
      rules.push(new NumericRangeRule());
    }
    
    return rules;
  }
}
```

##### 3. 验证失败示例（对比当前 vs 优化后）

**当前的验证失败信息**:
```
Validation failed: timestamps in art_6 are not monotonically increasing
```

**优化后的验证失败信息**:
```json
{
  "ruleId": "TIMESTAMP_MONOTONIC",
  "artifactId": "art_6",
  "severity": "warning",
  "description": "art_6 中的时间戳 (ts) 不单调递增。这是因为查询结果按 dur DESC 排序，不符合时间序列排序要求。",
  "fixGuidance": {
    "action": "SKIP_VALIDATION_RULE",
    "autoFixAvailable": true,
    "reason": "该 Skill (startup_blocking_calls) 的语义是按耗时排序的 Top-N 查询，时间戳不单调递增是正常的。"
  },
  "diagnostics": {
    "relevantSqlClause": "ORDER BY dur DESC",
    "affectedRows": [3, 5, 8, 12],
    "actualValue": "ts values: [1000, 500, 800, 300, ...]",
    "expectedValue": "ts values should be monotonically increasing"
  }
}
```

##### 4. 自动修正机制

```typescript
class AutoFixer {
  /**
   * 尝试自动修正验证失败
   */
  async attemptAutoFix(failure: ValidationFailure): Promise<AutoFixResult> {
    if (!failure.fixGuidance.autoFixAvailable) {
      return { fixed: false, reason: 'Auto-fix not available for this failure' };
    }

    switch (failure.fixGuidance.action) {
      case 'SKIP_VALIDATION_RULE':
        // 自动跳过不适用的验证规则
        return {
          fixed: true,
          action: 'Skipped validation rule',
          reason: failure.fixGuidance.reason,
        };

      case 'MODIFY_SQL_ORDER_BY':
        // 自动修改 ORDER BY 子句并重新执行
        const modifiedSql = this.modifyOrderBy(
          failure.diagnostics.relevantSqlClause!,
          failure.fixGuidance.suggestedSqlModification!
        );
        return {
          fixed: true,
          action: 'Modified ORDER BY clause',
          modifiedSql,
        };

      default:
        return { fixed: false, reason: `Action '${failure.fixGuidance.action}' requires manual intervention` };
    }
  }
}
```

---

### 6.5 方案五：SQL 模板质量强化（P1）

#### 目标

从根源上减少 SQL 质量问题，确保生成的 SQL 在语义、安全性、性能上都符合要求。

#### 当前 → 目标

- **当前**: SQL 模板直接字符串替换，无预校验，无匹配模式控制
- **目标**: SQL 模板预编译验证，参数化查询，多匹配模式支持

#### 实现要点

##### 1. SQL 模板预编译验证

在 SkillRegistry 加载 YAML 时，对每个 Skill 的 `sqlTemplate` 进行静态分析：

```typescript
class SQLTemplateValidator {
  /**
   * 在 Skill 注册时预检查 SQL 模板
   */
  validateTemplate(skill: SkillDefinition): TemplateValidationResult {
    const template = skill.sqlTemplate;
    const issues: TemplateIssue[] = [];

    // 1. 检查时间序列查询是否有 ORDER BY ts
    if (this.isTimeSeriesQuery(skill)) {
      if (!this.hasOrderByTimestamp(template)) {
        issues.push({
          severity: 'warning',
          message: `Time-series skill '${skill.id}' missing ORDER BY ts ASC. ` +
                   `Consider adding ORDER BY ts ASC for timestamp monotonicity.`,
          autoFix: 'Add ORDER BY ts ASC before LIMIT clause',
        });
      }
    }

    // 2. 检查是否有 LIMIT
    if (!template.toUpperCase().includes('LIMIT')) {
      issues.push({
        severity: 'error',
        message: `Skill '${skill.id}' missing LIMIT clause. ` +
                 `All queries must have a LIMIT to prevent large result sets.`,
        autoFix: 'Add LIMIT ${limit} at the end',
      });
    }

    // 3. 检查 LIKE 模式是否过度泛化
    const likePatterns = this.extractLikePatterns(template);
    for (const pattern of likePatterns) {
      if (pattern.includes('%${') && pattern.includes('}%')) {
        issues.push({
          severity: 'warning',
          message: `Skill '${skill.id}' uses overly broad LIKE pattern: ${pattern}. ` +
                   `Consider using exact match or adding matchMode parameter.`,
          autoFix: 'Replace with parameterized match mode',
        });
      }
    }

    // 4. 检查参数替换完整性
    const templateParams = this.extractTemplateParams(template);
    const definedParams = skill.parameters.map(p => p.name);
    for (const tp of templateParams) {
      if (!definedParams.includes(tp)) {
        issues.push({
          severity: 'error',
          message: `Template parameter '${tp}' in skill '${skill.id}' ` +
                   `not defined in parameters section.`,
        });
      }
    }

    return {
      valid: !issues.some(i => i.severity === 'error'),
      issues,
    };
  }
}
```

##### 2. 参数化查询替代字符串替换

**当前方式（不安全，不灵活）**:

```typescript
// 当前: 简单的字符串替换
function generateSQL(template: string, params: Record<string, unknown>): string {
  let sql = template;
  for (const [key, value] of Object.entries(params)) {
    sql = sql.replace(`\${${key}}`, String(value));
  }
  return sql;
}
```

**优化后方式（安全，支持多匹配模式）**:

```typescript
class SQLBuilder {
  /**
   * 安全的 SQL 构建器
   */
  buildSQL(skill: SkillDefinition, params: Record<string, unknown>): string {
    let sql = skill.sqlTemplate;
    
    for (const paramDef of skill.parameters) {
      const value = params[paramDef.name];
      const placeholder = `\${${paramDef.name}}`;
      
      if (!sql.includes(placeholder)) continue;
      
      if (paramDef.type === 'string') {
        // 根据 matchMode 选择匹配策略
        const matchMode = paramDef.matchMode || 'exact';
        sql = sql.replace(
          this.buildLikePattern(placeholder),
          this.buildMatchExpression(paramDef.columnRef, value as string, matchMode)
        );
      } else {
        // 数值类型直接替换（已通过 Zod 验证）
        sql = sql.replace(placeholder, this.escapeValue(value));
      }
    }
    
    return sql;
  }

  /**
   * 根据匹配模式构建 SQL 表达式
   */
  private buildMatchExpression(
    columnRef: string, value: string, matchMode: string
  ): string {
    const escaped = this.escapeString(value);
    
    switch (matchMode) {
      case 'exact':
        return `${columnRef} = '${escaped}'`;
      case 'contains':
        return `${columnRef} LIKE '%${escaped}%'`;
      case 'prefix':
        return `${columnRef} LIKE '${escaped}%'`;
      case 'glob':
        return `${columnRef} GLOB '${escaped}'`;
      default:
        return `${columnRef} = '${escaped}'`;
    }
  }

  /**
   * SQL 字符串转义
   */
  private escapeString(value: string): string {
    return value.replace(/'/g, "''");  // 单引号转义
  }
}
```

##### 3. Skill YAML 增强：matchMode 字段

```yaml
# 优化后的 Skill YAML 示例
parameters:
  - name: package_name
    type: string
    required: true
    description: "Target application package name"
    pattern: "^[a-zA-Z][a-zA-Z0-9_.]*$"
    matchMode: exact           # 新增字段: exact | contains | prefix | glob
    columnRef: p.name          # 新增字段: 对应 SQL 中的列引用

sqlTemplate: |
  SELECT s.ts, s.dur, s.name, t.name as track_name
  FROM slice s
  JOIN thread_track t ON s.track_id = t.id
  JOIN thread th ON t.utid = th.utid
  JOIN process p ON th.upid = p.upid
  WHERE ${package_name_match}     -- 使用匹配表达式占位符
    AND s.dur > 1000000
  ORDER BY dur DESC
  LIMIT ${limit}
```

---

### 6.6 方案六：流式输出可靠性增强（P1）

#### 目标

解决文本混乱（P1-4）和 WebSocket 背压消息丢失问题。

#### 当前 → 目标

- **当前**: 流式文本缓冲区边界不清晰，背压时直接丢弃消息
- **目标**: 精确的缓冲区刷新控制，可靠的消息传输保证

#### 实现要点

##### 1. 流式缓冲区精确控制

```typescript
class StreamBuffer {
  private buffer: string = '';
  private isToolCallInProgress: boolean = false;
  private sequenceNumber: number = 0;

  /**
   * 5个强制刷新时机
   */
  
  // 时机1: 工具调用前
  onBeforeToolCall(): void {
    this.flush('before_tool_call');
    this.isToolCallInProgress = true;
  }

  // 时机2: 工具调用完成后
  onAfterToolCall(): void {
    this.isToolCallInProgress = false;
    this.flush('after_tool_call');
  }

  // 时机3: 状态转换时
  onStateTransition(from: string, to: string): void {
    this.flush(`state_transition:${from}->${to}`);
  }

  // 时机4: LLM 响应完成时
  onLLMResponseComplete(): void {
    this.flush('llm_response_complete');
  }

  // 时机5: 缓冲区达到阈值时
  appendText(text: string): void {
    if (this.isToolCallInProgress) {
      // 工具调用期间的文本不追加到缓冲区（丢弃 LLM 的"思考"文本）
      return;
    }
    this.buffer += text;
    if (this.buffer.length > 200) {  // 200字符阈值
      this.flush('buffer_threshold');
    }
  }

  private flush(reason: string): void {
    if (this.buffer.length === 0) return;
    
    this.emit('flush', {
      text: this.buffer,
      sequenceNumber: this.sequenceNumber++,
      reason,
    });
    this.buffer = '';
  }
}
```

##### 2. WebSocket 背压改为缓冲 + 重传

```typescript
class ReliableWebSocket {
  private sendQueue: Array<{ message: WebSocketMessage; seq: number }> = [];
  private readonly maxQueueSize = 1000;
  private readonly highWaterMark = 800;
  private nextSeq: number = 0;

  /**
   * 可靠发送：背压时缓冲而非丢弃
   */
  send(message: WebSocketMessage): void {
    const seq = this.nextSeq++;
    
    if (this.isBackpressured()) {
      // 缓冲区快满时，丢弃低优先级消息
      if (this.sendQueue.length >= this.maxQueueSize) {
        if (message.priority === 'low') {
          this.emit('message_dropped', { seq, reason: 'queue_full' });
          return;
        }
        // 高优先级消息挤掉最旧的低优先级消息
        this.evictLowestPriority();
      }
      this.sendQueue.push({ message, seq });
      return;
    }

    // 正常发送
    try {
      this.ws.send(JSON.stringify({ ...message, seq }));
    } catch (error) {
      // 发送失败，入队等待重试
      this.sendQueue.push({ message, seq });
    }
  }

  /**
   * 处理客户端的消息确认
   */
  onAck(ackSeq: number): void {
    // 移除已确认的消息
    this.sendQueue = this.sendQueue.filter(item => item.seq > ackSeq);
  }

  /**
   * 处理客户端的重传请求
   */
  onRetransmitRequest(fromSeq: number): void {
    const toRetransmit = this.sendQueue.filter(item => item.seq >= fromSeq);
    for (const item of toRetransmit) {
      this.ws.send(JSON.stringify({ ...item.message, seq: item.seq, retransmit: true }));
    }
  }
}
```

##### 3. 消息序号与确认机制

```typescript
// 客户端消息格式增强
interface ClientMessage {
  type: string;
  seq?: number;            // 消息序号
  ack?: number;            // 确认已收到的最大序号
  payload: unknown;
}

// 服务端消息格式增强
interface ServerMessage {
  type: string;
  seq: number;             // 消息序号（必须）
  retransmit?: boolean;    // 是否为重传消息
  payload: unknown;
}

// 客户端检测丢失逻辑
class ClientMessageTracker {
  private lastReceivedSeq: number = -1;
  private gaps: Array<[number, number]> = [];

  onMessage(msg: ServerMessage): void {
    if (msg.seq > this.lastReceivedSeq + 1) {
      // 检测到序号间隙
      this.gaps.push([this.lastReceivedSeq + 1, msg.seq - 1]);
      this.requestRetransmit(this.lastReceivedSeq + 1);
    }
    this.lastReceivedSeq = Math.max(this.lastReceivedSeq, msg.seq);
  }
}
```

---

### 6.7 方案七：LLM 上下文增强（P1）

#### 目标

让 LLM 拥有完整的分析状态感知能力，减少重复调用、遗漏数据、无效修正等问题。

#### 当前 → 目标

- **当前**: LLM 每次推理从近似"无状态"出发，不知道已有哪些数据、做了哪些操作
- **目标**: LLM 每次推理前获得完整的状态快照，包括数据、操作历史、验证状态、进度

#### 实现要点

##### 1. 动态上下文注入

每次 LLM 调用前，由 ContextManager 构建完整的状态上下文：

```typescript
class EnhancedContextManager {
  /**
   * 构建增强版上下文
   */
  buildEnhancedContext(
    artifactStore: ArtifactStore,
    callHistory: ToolCallHistory,
    analysisProgress: AnalysisProgress,
    tokenBudget: number
  ): EnhancedContext {
    const sections: ContextSection[] = [];

    // Section 1: Artifact 状态摘要
    sections.push({
      priority: 'high',
      title: '当前已获取的分析数据',
      content: artifactStore.getStatusReport(),
      estimatedTokens: this.estimateTokens(artifactStore.getStatusReport()),
    });

    // Section 2: 工具调用历史
    sections.push({
      priority: 'high',
      title: '已调用的分析工具',
      content: callHistory.getSummary(),
      estimatedTokens: this.estimateTokens(callHistory.getSummary()),
    });

    // Section 3: 分析进度
    sections.push({
      priority: 'medium',
      title: '分析进度',
      content: analysisProgress.getProgressReport(),
      estimatedTokens: this.estimateTokens(analysisProgress.getProgressReport()),
    });

    // Section 4: 关键数据点（从 VALID Artifact 中提取）
    const keyDataPoints = this.extractKeyDataPoints(artifactStore);
    if (keyDataPoints) {
      sections.push({
        priority: 'medium',
        title: '关键数据摘要',
        content: keyDataPoints,
        estimatedTokens: this.estimateTokens(keyDataPoints),
      });
    }

    // 根据 Token 预算裁剪
    return this.fitToBudget(sections, tokenBudget);
  }
}
```

##### 2. Artifact 数据摘要（智能截断）

```typescript
class ArtifactSummarizer {
  /**
   * 为大数据集生成智能摘要
   */
  summarize(artifact: Artifact, maxRows: number = 5): string {
    if (!artifact.data?.result) return '无数据';
    
    const result = artifact.data.result;
    
    // 小数据集：完整展示
    if (result.rowCount <= maxRows) {
      return this.formatTable(result.columns, result.rows);
    }
    
    // 大数据集：展示前 N 行 + 统计摘要
    let summary = `共 ${result.rowCount} 行数据`;
    if (result.truncated) {
      summary += `（已截断，实际可能更多）`;
    }
    summary += '\n\n';
    
    // 前 N 行
    summary += `前 ${maxRows} 行:\n`;
    summary += this.formatTable(result.columns, result.rows.slice(0, maxRows));
    summary += '\n';
    
    // 统计摘要
    if (artifact.data.summary?.numericColumns) {
      summary += '数值列统计:\n';
      for (const [colName, stats] of Object.entries(artifact.data.summary.numericColumns)) {
        summary += `  ${colName}: min=${stats.min}, max=${stats.max}, ` +
                   `avg=${stats.avg.toFixed(2)}, sum=${stats.sum.toFixed(2)}\n`;
      }
    }
    
    summary += `\n提示: 使用 fetch_artifact("${artifact.id}") 获取完整数据。`;
    
    return summary;
  }
}
```

##### 3. 分析进度追踪

```typescript
class AnalysisProgress {
  private phases: Map<string, PhaseStatus> = new Map();

  /**
   * 注册分析阶段（从 Plan 中提取）
   */
  registerPhases(plan: AnalysisPlan): void {
    for (const phase of plan.phases) {
      this.phases.set(phase.id, {
        name: phase.name,
        status: 'pending',
        skillId: phase.skillId,
        artifactId: null,
      });
    }
  }

  /**
   * 更新阶段状态
   */
  updatePhase(phaseId: string, status: string, artifactId?: string): void {
    const phase = this.phases.get(phaseId);
    if (phase) {
      phase.status = status;
      if (artifactId) phase.artifactId = artifactId;
    }
  }

  /**
   * 生成进度报告
   */
  getProgressReport(): string {
    let report = '分析进度:\n';
    
    for (const [id, phase] of this.phases) {
      const icon = {
        'pending': '⏳',
        'in_progress': '🔄',
        'completed': '✅',
        'failed': '❌',
        'needs_fix': '🔧',
      }[phase.status] || '❓';
      
      report += `${icon} ${phase.name}`;
      
      switch (phase.status) {
        case 'completed':
          report += `（已完成，${phase.artifactId}）`;
          break;
        case 'failed':
          report += `（执行失败，需要诊断）`;
          break;
        case 'needs_fix':
          report += `（验证失败，需修正）`;
          break;
        case 'pending':
          report += `（待执行）`;
          break;
        case 'in_progress':
          report += `（执行中...）`;
          break;
      }
      
      report += '\n';
    }
    
    const total = this.phases.size;
    const completed = Array.from(this.phases.values()).filter(p => p.status === 'completed').length;
    report += `\n总进度: ${completed}/${total} 阶段已完成`;
    
    return report;
  }
}
```

**注入效果示例**:

```
分析进度:
✅ 阶段1：启动阶段分解（已完成，art_1）
🔧 阶段2：阻塞调用分析（验证失败，需修正）
⏳ 阶段3：CPU调度分析（待执行）
⏳ 阶段4：生成分析报告（待执行）

总进度: 1/4 阶段已完成
```

---

## 七、实施路线图

### Phase 1: 核心闭环（1-2周）

| 工作项 | 预计时间 | 依赖 | 产出物 |
|--------|---------|------|-------|
| TraceProcessorBridge 模块开发 | 3天 | 无 | `server/src/services/trace_processor_bridge.ts` |
| SkillProcessor 闭环改造 | 2天 | TraceProcessorBridge | 修改 `server/src/services/skill_processor.ts` |
| 统一结果信封定义 | 1天 | 无 | TypeScript 接口定义 |
| Artifact 生命周期管理 | 2天 | 无 | 修改 ArtifactStore |
| WebSocket 协议升级（支持闭环结果） | 1天 | SkillProcessor | 修改 `server/src/routes/websocket.ts` |
| 前端 Agent Loop 适配 | 2天 | 以上全部 | 修改 `agent_loop.ts` |
| 集成测试 | 2天 | 以上全部 | 测试用例 |

**Phase 1 验收标准**:
- [ ] `invoke_skill` 返回完整结果（包含数据），而非 SQL 文本
- [ ] Artifact 有状态流转（PENDING → VALID / FAILED / INVALIDATED）
- [ ] 验证失败后旧 Artifact 自动标记为 INVALIDATED

### Phase 2: 质量强化（1周）

| 工作项 | 预计时间 | 依赖 | 产出物 |
|--------|---------|------|-------|
| 工具调用拦截器 | 1天 | Phase 1 | `ToolCallInterceptor` |
| 调用历史记录 | 1天 | Phase 1 | `ToolCallHistory` |
| 结构化验证失败信息 | 1天 | Phase 1 | 修改验证模块 |
| 自动修正机制 | 1天 | 验证模块 | `AutoFixer` |
| SQL 模板预编译验证 | 1天 | 无 | `SQLTemplateValidator` |
| matchMode 参数支持 | 1天 | SQL 模板 | 修改 Skill YAML + SQLBuilder |
| 集成测试 | 1天 | 以上全部 | 测试用例 |

**Phase 2 验收标准**:
- [ ] 相同参数的重复工具调用被自动拦截，复用已有结果
- [ ] 验证失败时提供结构化的修正指引
- [ ] `LIKE` 模式过度泛化在模板加载时被检测并警告

### Phase 3: 体验优化（1周）

| 工作项 | 预计时间 | 依赖 | 产出物 |
|--------|---------|------|-------|
| StreamBuffer 精确控制 | 1天 | 无 | `StreamBuffer` |
| WebSocket 消息序号 | 1天 | 无 | 修改 WebSocket 协议 |
| 增强版 System Prompt | 1天 | Phase 1+2 | 修改 `context_manager.ts` |
| 动态状态摘要注入 | 1天 | Phase 2 | `StateInjector` |
| 分析进度追踪 | 1天 | Phase 2 | `ProgressTracker` |
| 端到端集成测试 | 2天 | 以上全部 | 测试用例 |

**Phase 3 验收标准**:
- [ ] 流式输出无乱序、无截断
- [ ] LLM 每次推理前能看到已执行操作清单和已有数据摘要
- [ ] 背压时消息进入缓冲队列而非被丢弃

---

## 八、附录

### 附录 A：架构对比总表

| 对比维度 | perfetto-mcp | OpenPerfetto | 差距评估 |
|---------|-------------|-------------|----------|
| 工具抽象粒度 | 分析单元级（每工具完整闭环） | 操作级（invoke/execute/fetch 分离） | 🔴 重大差距 |
| SQL 执行位置 | 工具内部直接执行 | 前端 WASM（与后端生成分离） | 🔴 重大差距 |
| 结果返回方式 | 统一 JSON 信封直返 | ArtifactStore 间接引用 | 🟡 中等差距 |
| 参数验证深度 | 逐参数业务级验证 + SQL 转义 | 通用 JSON Schema + Zod 类型检查 | 🟡 中等差距 |
| 降级/Fallback | 几乎所有工具都有降级方案 | 完全缺失 | 🔴 重大差距 |
| 业务逻辑位置 | 工具代码内（严重度、聚合） | 无（YAML 仅含 SQL 模板） | 🔴 重大差距 |
| 连接管理 | ConnectionManager 持久化+健康检查+重连 | 前端 WASM 集成（无显式管理） | 🟢 差距小 |
| 错误信息质量 | 分类异常 + 结构化错误描述 | 通用 catch + 字符串错误 | 🟡 中等差距 |
| SQL 安全防护 | 基本转义 + 查询验证 | 自动 LIMIT + 黑/白名单 + 模式检查 | 🟢 OpenPerfetto 更好 |
| 结果缓存/压缩 | 无 | ArtifactStore 自动压缩缓存 | 🟢 OpenPerfetto 更好 |
| 超时保护 | 无 | 30s Promise.race | 🟢 OpenPerfetto 更好 |
| 可扩展性 | 新增工具需写 Python 类 | YAML 声明式 + 热重载 | 🟢 OpenPerfetto 更好 |

### 附录 B：文件引用速查表

#### perfetto-mcp 关键文件

| 文件路径 | 功能 | 行数 | 本文引用章节 |
|---------|------|------|------------|
| `perfetto-mcp/src/perfetto_mcp/tools/base.py` | BaseTool 基类，统一 JSON 信封 | 166 | 三、三-A |
| `perfetto-mcp/src/perfetto_mcp/tools/sql_query.py` | 通用 SQL 查询 | 78 | 三-A.1.1 |
| `perfetto-mcp/src/perfetto_mcp/tools/find_slices.py` | Slice 查找，三种匹配模式 | 299 | 三-A.1.5 |
| `perfetto-mcp/src/perfetto_mcp/tools/anr_detection.py` | ANR 检测 + 严重度计算 | 160 | 三-A.1.3 |
| `perfetto-mcp/src/perfetto_mcp/tools/anr_root_cause.py` | ANR 根因多轮分析 | 470 | 三-A.1.3 |
| `perfetto-mcp/src/perfetto_mcp/tools/cpu_utilization.py` | CPU 分析，双层 Fallback | 217 | 三-A.1.4 |
| `perfetto-mcp/src/perfetto_mcp/tools/thread_contention_analyzer.py` | 线程竞争 + 降级 | 563 | 三-A.1.3 |
| `perfetto-mcp/src/perfetto_mcp/connection_manager.py` | 持久化连接管理 | — | 三 |
| `perfetto-mcp/src/perfetto_mcp/utils/query_helpers.py` | SQL 验证、行格式化 | — | 三 |
| `perfetto-mcp/src/perfetto_mcp/server.py` | FastMCP 服务器 | — | 三 |

#### OpenPerfetto 关键文件

| 文件路径 | 功能 | 行数 | 本文引用章节 |
|---------|------|------|------------|
| `ui/src/plugins/org.openperfetto/tools/execute_sql.ts` | SQL 执行 + ArtifactStore | 185 | 三-A.1.1 |
| `ui/src/plugins/org.openperfetto/tools/invoke_skill.ts` | WebSocket 调用后端 Skill | 251 | 三-A.1.2 |
| `ui/src/plugins/org.openperfetto/tools/tool_registry.ts` | 工具注册、参数验证 | 301 | 三-A.3.1, 四 |
| `ui/src/plugins/org.openperfetto/tools/fetch_artifact.ts` | 缓存结果获取 | 108 | 三-A.1.1, 五 |
| `ui/src/plugins/org.openperfetto/tools/list_skills.ts` | Skill 发现 | 294 | 四 |
| `ui/src/plugins/org.openperfetto/tools/trace_process_flow.ts` | 调用流分析 | 456 | 三-A.3.2 |
| `ui/src/plugins/org.openperfetto/agent/agent_loop.ts` | Agent Loop 状态机 | 1474 | 四, 五 |
| `ui/src/plugins/org.openperfetto/agent/context_manager.ts` | Token 预算管理 | 800 | 四 |
| `server/src/services/skill_processor.ts` | 参数验证、SQL 生成 | 824 | 四, 五, 六 |
| `server/src/services/yaml_parser.ts` | Zod Schema 定义 | 461 | 四 |
| `server/src/services/llm_proxy.ts` | 多 Provider、熔断器 | 972 | 四 |
| `server/src/routes/websocket.ts` | 连接池、消息路由 | 857 | 四, 六 |

#### OpenPerfetto Skills YAML 文件

| 文件路径 | 类型 | 本文引用章节 |
|---------|------|------------|
| `server/skills/library/startup/app_startup_breakdown.yaml` | sql_query | 二, 三-A |
| `server/skills/library/startup/startup_blocking_calls.yaml` | sql_query | 二, 三-A.2 |
| `server/skills/library/anr/detect_anr_window.yaml` | sql_query | 三-A.1.3, 三-A.2 |
| `server/skills/library/anr/anr_root_cause.yaml` | sql_query | 三-A.1.3, 三-A.2 |
| `server/skills/library/cpu/cpu_scheduling_analysis.yaml` | sql_query | 三-A.1.4, 三-A.2 |
| `server/skills/library/memory/memory_trend_analysis.yaml` | sql_query | 三-A.2 |
| `server/skills/library/frame/frame_rendering_analysis.yaml` | sql_query | 三-A.2 |
| `server/skills/library/process/process_overview.yaml` | sql_query | 三-A.2 |
| `server/skills/library/lock/detect_lock_contention.yaml` | sql_query | 三-A.2 |

### 附录 C：术语表

| 术语 | 定义 |
|------|------|
| Agent Loop | 前端 AI 代理的状态机循环，控制 LLM 推理和工具调用的交替执行 |
| ArtifactStore | 前端工具执行结果的存储管理器，支持压缩和缓存 |
| BaseTool | perfetto-mcp 中所有工具的基类，提供统一的连接管理和 JSON 信封格式 |
| ConnectionManager | perfetto-mcp 的持久化连接管理器，维护 TraceProcessor 连接池 |
| Fallback | 降级方案，当主要查询方式不可用时自动切换到备用方案 |
| JSON 信封 | 统一的返回格式 `{tracePath, processName, success, error, result}` |
| MCP | Model Context Protocol，AI 模型与工具交互的标准协议 |
| Skill | OpenPerfetto 后端预定义的分析能力单元，通过 YAML 声明式配置 |
| SkillProcessor | 后端服务中负责 Skill 参数验证和 SQL 模板渲染的处理器 |
| Trace Processor | Perfetto 的 C++ SQL 查询引擎，可编译为 WASM 在浏览器运行 |
| WASM | WebAssembly，使 Trace Processor 在浏览器中运行的技术 |
| 执行闭环 | 从参数验证到结果格式化在一个组件内完成的设计模式 |
| 执行断裂 | SQL 生成和执行分离在不同组件中的反模式 |

---

*文档生成时间：2026年4月*
*基于 perfetto-mcp 和 OpenPerfetto 源码的逐文件深度对比分析*