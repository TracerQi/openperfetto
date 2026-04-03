/**
 * Trace Engine Mock
 * 
 * 模拟 Perfetto Trace Engine 的 SQL 查询接口，用于单元测试
 */

/**
 * SQL 查询结果行
 */
export interface QueryResultRow {
  [key: string]: unknown;
}

/**
 * SQL 查询结果
 */
export interface QueryResult {
  columns: string[];
  rows: QueryResultRow[];
  numRows: number;
}

/**
 * 查询匹配规则
 */
export interface QueryMatcher {
  /** 精确匹配 SQL */
  sql?: string;
  /** 正则表达式匹配 SQL */
  pattern?: RegExp;
  /** 包含子字符串匹配 */
  contains?: string;
}

/**
 * Mock 查询配置
 */
export interface MockQueryConfig {
  matcher: QueryMatcher;
  result: QueryResult;
  /** 是否应该抛出错误 */
  shouldError?: boolean;
  /** 错误消息 */
  errorMessage?: string;
  /** 模拟延迟（毫秒） */
  delayMs?: number;
}

/**
 * Mock Trace Engine
 * 
 * 模拟 SQL 查询接口，支持按规则匹配不同的结果
 */
export class MockTraceEngine {
  private queryConfigs: MockQueryConfig[] = [];
  private defaultResult: QueryResult = {
    columns: [],
    rows: [],
    numRows: 0,
  };
  private queryCalls: Array<{ sql: string; timestamp: number }> = [];

  /**
   * 添加查询配置
   */
  addQueryConfig(config: MockQueryConfig): void {
    this.queryConfigs.push(config);
  }

  /**
   * 设置多个查询配置
   */
  setQueryConfigs(configs: MockQueryConfig[]): void {
    this.queryConfigs = configs;
  }

  /**
   * 设置默认结果（当没有匹配的配置时使用）
   */
  setDefaultResult(result: QueryResult): void {
    this.defaultResult = result;
  }

  /**
   * 重置 mock 状态
   */
  reset(): void {
    this.queryConfigs = [];
    this.queryCalls = [];
  }

  /**
   * 获取所有查询调用记录
   */
  getQueryCalls(): Array<{ sql: string; timestamp: number }> {
    return [...this.queryCalls];
  }

  /**
   * 查找匹配的配置
   */
  private findMatchingConfig(sql: string): MockQueryConfig | undefined {
    return this.queryConfigs.find(config => {
      const { matcher } = config;
      
      if (matcher.sql !== undefined) {
        return matcher.sql === sql;
      }
      
      if (matcher.pattern !== undefined) {
        return matcher.pattern.test(sql);
      }
      
      if (matcher.contains !== undefined) {
        return sql.includes(matcher.contains);
      }
      
      return false;
    });
  }

  /**
   * 执行 SQL 查询
   */
  async query(sql: string): Promise<QueryResult> {
    // 记录调用
    this.queryCalls.push({ sql, timestamp: Date.now() });

    // 查找匹配的配置
    const config = this.findMatchingConfig(sql);

    if (!config) {
      return this.defaultResult;
    }

    // 模拟延迟
    if (config.delayMs) {
      await this.sleep(config.delayMs);
    }

    // 模拟错误
    if (config.shouldError) {
      throw new Error(config.errorMessage || 'Mock query error');
    }

    return config.result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 创建 Mock Trace Engine 的工厂函数
 */
export function createMockTraceEngine(
  configs?: MockQueryConfig[]
): MockTraceEngine {
  const engine = new MockTraceEngine();
  
  if (configs) {
    engine.setQueryConfigs(configs);
  }
  
  return engine;
}

/**
 * 结果构建辅助函数
 */
export const QueryResultBuilder = {
  /**
   * 创建空结果
   */
  empty(): QueryResult {
    return {
      columns: [],
      rows: [],
      numRows: 0,
    };
  },

  /**
   * 从数据创建结果
   */
  fromData<T extends Record<string, unknown>>(data: T[]): QueryResult {
    if (data.length === 0) {
      return this.empty();
    }
    
    const columns = Object.keys(data[0]);
    return {
      columns,
      rows: data,
      numRows: data.length,
    };
  },

  /**
   * 创建单行结果
   */
  singleRow(row: QueryResultRow): QueryResult {
    return {
      columns: Object.keys(row),
      rows: [row],
      numRows: 1,
    };
  },

  /**
   * 创建计数结果
   */
  count(value: number): QueryResult {
    return {
      columns: ['count'],
      rows: [{ count: value }],
      numRows: 1,
    };
  },
};

/**
 * 预定义的查询场景
 */
export const MockQueryScenarios = {
  /**
   * 进程列表查询
   */
  processList: (processes: Array<{ pid: number; name: string }>): MockQueryConfig => ({
    matcher: { contains: 'process' },
    result: QueryResultBuilder.fromData(
      processes.map(p => ({ pid: p.pid, name: p.name }))
    ),
  }),

  /**
   * 线程列表查询
   */
  threadList: (threads: Array<{ tid: number; name: string; pid: number }>): MockQueryConfig => ({
    matcher: { contains: 'thread' },
    result: QueryResultBuilder.fromData(
      threads.map(t => ({ tid: t.tid, name: t.name, upid: t.pid }))
    ),
  }),

  /**
   * Slice 查询
   */
  slices: (slices: Array<{ id: number; name: string; dur: number; ts: number }>): MockQueryConfig => ({
    matcher: { contains: 'slice' },
    result: QueryResultBuilder.fromData(slices),
  }),

  /**
   * Counter 查询
   */
  counters: (counters: Array<{ name: string; value: number; ts: number }>): MockQueryConfig => ({
    matcher: { contains: 'counter' },
    result: QueryResultBuilder.fromData(counters),
  }),

  /**
   * 查询错误
   */
  error: (sqlContains: string, errorMessage: string): MockQueryConfig => ({
    matcher: { contains: sqlContains },
    shouldError: true,
    errorMessage,
    result: QueryResultBuilder.empty(),
  }),

  /**
   * 空结果
   */
  emptyResult: (sqlContains: string): MockQueryConfig => ({
    matcher: { contains: sqlContains },
    result: QueryResultBuilder.empty(),
  }),

  /**
   * 延迟查询
   */
  delayed: (sqlContains: string, result: QueryResult, delayMs: number): MockQueryConfig => ({
    matcher: { contains: sqlContains },
    result,
    delayMs,
  }),
};
