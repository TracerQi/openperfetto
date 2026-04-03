// Copyright (C) 2026 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * ArtifactStore 单元测试
 *
 * 测试制品存储的存取、LRU 淘汰、数据压缩和摘要生成功能
 */

import {ArtifactStore} from '../../agent/artifact_store.js';
import type {ArtifactData, ArtifactType} from '../../types/artifact';

// ArtifactType: 'table' | 'scalar' | 'chart' | 'trace_flow'

describe('ArtifactStore', () => {
  let store: ArtifactStore;

  beforeEach(() => {
    store = new ArtifactStore();
  });

  describe('基本存取操作', () => {
    it('应能存储新 artifact', () => {
      const data: ArtifactData = {
        columns: [{name: 'id', type: 'integer'}, {name: 'name', type: 'string'}],
        rows: [[1, 'test'], [2, 'example']],
        totalRowCount: 2,
      };

      const artifact = store.store('table', data, 'execute_sql', 'SELECT * FROM slice');

      expect(artifact).toBeDefined();
      expect(artifact.id).toMatch(/^art_\d+$/);
      expect(artifact.type).toBe('table');
      expect(artifact.sourceTool).toBe('execute_sql');
      expect(artifact.sourceQuery).toBe('SELECT * FROM slice');
      expect(artifact.fullData).toBe(data);
    });

    it('应能获取已存储的 artifact', () => {
      const data: ArtifactData = {
        columns: [{name: 'cnt', type: 'integer'}],
        rows: [[42]],
        totalRowCount: 1,
      };

      const stored = store.store('table', data, 'execute_sql');
      const retrieved = store.get(stored.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(stored.id);
      expect(retrieved?.fullData).toEqual(data);
    });

    it('获取不存在的 artifact 应返回 undefined', () => {
      const result = store.get('non_existent_id');
      expect(result).toBeUndefined();
    });

    it('应能获取所有 artifacts', () => {
      const data1: ArtifactData = {
        columns: [{name: 'a', type: 'integer'}],
        rows: [[1]],
        totalRowCount: 1,
      };
      const data2: ArtifactData = {
        columns: [{name: 'b', type: 'string'}],
        rows: [['x']],
        totalRowCount: 1,
      };

      store.store('table', data1, 'tool1');
      store.store('table', data2, 'tool2');

      const all = store.getAll();
      expect(all.length).toBe(2);
    });
  });

  describe('size 和 clear 操作', () => {
    it('size 应返回正确的数量', () => {
      expect(store.size()).toBe(0);

      store.store('table', createSimpleData(1), 'tool');
      expect(store.size()).toBe(1);

      store.store('table', createSimpleData(2), 'tool');
      expect(store.size()).toBe(2);
    });

    it('clear 应清空存储', () => {
      store.store('table', createSimpleData(1), 'tool');
      store.store('table', createSimpleData(2), 'tool');
      expect(store.size()).toBe(2);

      store.clear();
      expect(store.size()).toBe(0);
      expect(store.getAll()).toEqual([]);
    });
  });

  describe('LRU 淘汰策略 (MAX_ARTIFACTS = 100)', () => {
    it('存储超过 100 个时应淘汰最早的', () => {
      // 存储 100 个
      for (let i = 0; i < 100; i++) {
        store.store('table', createSimpleData(i), `tool_${i}`);
      }
      expect(store.size()).toBe(100);

      // 记录第一个 artifact 的 ID
      const allBefore = store.getAll();
      const firstId = allBefore[0].id;

      // 存储第 101 个
      store.store('table', createSimpleData(100), 'tool_100');

      // 大小仍为 100
      expect(store.size()).toBe(100);

      // 第一个应该被淘汰
      expect(store.get(firstId)).toBeUndefined();
    });

    it('新存储的 artifact 应保留', () => {
      // 存储 100 个
      for (let i = 0; i < 100; i++) {
        store.store('table', createSimpleData(i), `tool_${i}`);
      }

      // 存储新的
      const newArtifact = store.store('table', createSimpleData(100), 'tool_new');

      // 新的应该存在
      expect(store.get(newArtifact.id)).toBeDefined();
    });

    it('连续存储 101 个后应有正确数量', () => {
      for (let i = 0; i < 101; i++) {
        store.store('table', createSimpleData(i), `tool_${i}`);
      }
      expect(store.size()).toBe(100);
    });
  });

  describe('数据压缩和摘要生成', () => {
    it('摘要应包含行数', () => {
      const data: ArtifactData = {
        columns: [{name: 'id', type: 'integer'}],
        rows: [[1], [2], [3], [4], [5]],
        totalRowCount: 5,
      };

      const artifact = store.store('table', data, 'tool');

      expect(artifact.summary.rowCount).toBe(5);
    });

    it('应生成数值列统计', () => {
      const data: ArtifactData = {
        columns: [{name: 'duration', type: 'integer'}],
        rows: [[10], [20], [30], [40], [50]],
        totalRowCount: 5,
      };

      const artifact = store.store('table', data, 'tool');

      expect(artifact.summary.numericStats).toBeDefined();
      expect(artifact.summary.numericStats?.duration).toBeDefined();
      expect(artifact.summary.numericStats?.duration.min).toBe(10);
      expect(artifact.summary.numericStats?.duration.max).toBe(50);
      expect(artifact.summary.numericStats?.duration.avg).toBe(30);
    });

    it('应生成完整分位数统计', () => {
      const data: ArtifactData = {
        columns: [{name: 'value', type: 'float'}],
        rows: Array.from({length: 100}, (_, i) => [i + 1]),
        totalRowCount: 100,
      };

      const artifact = store.store('table', data, 'tool');
      const stats = artifact.summary.numericStats?.value;

      expect(stats).toBeDefined();
      expect(stats?.p0).toBeDefined();
      expect(stats?.p25).toBeDefined();
      expect(stats?.p50).toBeDefined();
      expect(stats?.p75).toBeDefined();
      expect(stats?.p90).toBeDefined();
      expect(stats?.p95).toBeDefined();
      expect(stats?.p99).toBeDefined();
      expect(stats?.p999).toBeDefined();
    });

    it('应生成字符串列统计', () => {
      const data: ArtifactData = {
        columns: [{name: 'name', type: 'string'}],
        rows: [
          ['apple'], ['banana'], ['apple'], ['cherry'],
          ['apple'], ['banana'], ['date'],
        ],
        totalRowCount: 7,
      };

      const artifact = store.store('table', data, 'tool');

      expect(artifact.summary.stringStats).toBeDefined();
      expect(artifact.summary.stringStats?.name).toBeDefined();
      expect(artifact.summary.stringStats?.name.uniqueCount).toBe(4);
      expect(artifact.summary.stringStats?.name.topValues[0].value).toBe('apple');
      expect(artifact.summary.stringStats?.name.topValues[0].count).toBe(3);
    });

    it('大数据集应采样返回', () => {
      const data: ArtifactData = {
        columns: [{name: 'value', type: 'integer'}],
        rows: Array.from({length: 1000}, (_, i) => [i]),
        totalRowCount: 1000,
      };

      const artifact = store.store('table', data, 'tool');

      // 采样应返回约 15-20 行
      expect(artifact.summary.sampleRows).toBeDefined();
      expect(artifact.summary.sampleRows!.length).toBeLessThanOrEqual(20);
      expect(artifact.summary.sampleRows!.length).toBeGreaterThan(0);
    });

    it('小数据集应全部返回', () => {
      const data: ArtifactData = {
        columns: [{name: 'value', type: 'integer'}],
        rows: [[1], [2], [3], [4], [5]],
        totalRowCount: 5,
      };

      const artifact = store.store('table', data, 'tool');

      expect(artifact.summary.sampleRows?.length).toBe(5);
    });
  });

  describe('自动生成洞察', () => {
    it('应检测高方差数据', () => {
      const data: ArtifactData = {
        columns: [{name: 'latency', type: 'integer'}],
        rows: [
          ...Array.from({length: 90}, () => [10]), // 90个低值
          ...Array.from({length: 10}, () => [1000]), // 10个高值
        ],
        totalRowCount: 100,
      };

      const artifact = store.store('table', data, 'tool');

      expect(artifact.summary.insights).toBeDefined();
      expect(artifact.summary.insights!.some((i) => i.includes('方差'))).toBe(true);
    });

    it('应检测异常值', () => {
      const data: ArtifactData = {
        columns: [{name: 'duration', type: 'integer'}],
        rows: [
          ...Array.from({length: 99}, () => [10]),
          [10000], // 一个异常高值
        ],
        totalRowCount: 100,
      };

      const artifact = store.store('table', data, 'tool');

      expect(artifact.summary.insights!.some((i) => i.includes('异常值'))).toBe(true);
    });

    it('应检测主要字符串值', () => {
      const data: ArtifactData = {
        columns: [{name: 'status', type: 'string'}],
        rows: [
          ...Array.from({length: 80}, () => ['running']),
          ...Array.from({length: 20}, () => ['stopped']),
        ],
        totalRowCount: 100,
      };

      const artifact = store.store('table', data, 'tool');

      expect(artifact.summary.insights!.some((i) => i.includes('主要值'))).toBe(true);
    });

    it('洞察数量不应超过 5 条', () => {
      const data: ArtifactData = {
        columns: [
          {name: 'col1', type: 'integer'},
          {name: 'col2', type: 'integer'},
          {name: 'col3', type: 'integer'},
          {name: 'col4', type: 'string'},
          {name: 'col5', type: 'string'},
        ],
        rows: Array.from({length: 100}, (_, i) => [
          i < 90 ? 1 : 1000,
          i < 90 ? 1 : 2000,
          i < 90 ? 1 : 3000,
          i < 80 ? 'a' : 'b',
          i < 70 ? 'x' : 'y',
        ]),
        totalRowCount: 100,
      };

      const artifact = store.store('table', data, 'tool');

      expect(artifact.summary.insights!.length).toBeLessThanOrEqual(5);
    });
  });

  describe('分页获取数据', () => {
    it('fetchPage 应返回指定范围的行', () => {
      const data: ArtifactData = {
        columns: [{name: 'id', type: 'integer'}],
        rows: [[1], [2], [3], [4], [5], [6], [7], [8], [9], [10]],
        totalRowCount: 10,
      };

      const artifact = store.store('table', data, 'tool');
      const page = store.fetchPage(artifact.id, 2, 3);

      expect(page).toEqual([[3], [4], [5]]);
    });

    it('fetchPage 对不存在的 artifact 应返回 null', () => {
      const result = store.fetchPage('non_existent', 0, 10);
      expect(result).toBeNull();
    });

    it('fetchPage 应处理超出范围的请求', () => {
      const data: ArtifactData = {
        columns: [{name: 'id', type: 'integer'}],
        rows: [[1], [2], [3]],
        totalRowCount: 3,
      };

      const artifact = store.store('table', data, 'tool');
      const page = store.fetchPage(artifact.id, 10, 5);

      expect(page).toEqual([]);
    });
  });

  describe('formatForLLM', () => {
    it('应格式化 artifact 为可读文本', () => {
      const data: ArtifactData = {
        columns: [
          {name: 'duration_ms', type: 'float'},
          {name: 'name', type: 'string'},
        ],
        rows: [
          [100.5, 'task1'],
          [200.3, 'task2'],
        ],
        totalRowCount: 2,
      };

      const artifact = store.store('table', data, 'execute_sql', 'SELECT * FROM slice');
      const formatted = store.formatForLLM(artifact.id);

      expect(formatted).toContain('Artifact');
      expect(formatted).toContain(artifact.id);
      expect(formatted).toContain('table');
      expect(formatted).toContain('execute_sql');
      expect(formatted).toContain('2'); // 行数
    });

    it('不存在的 artifact 应返回错误信息', () => {
      const formatted = store.formatForLLM('non_existent_id');
      expect(formatted).toContain('not found');
    });
  });

  describe('边界条件', () => {
    it('空数据应正常处理', () => {
      const data: ArtifactData = {
        columns: [{name: 'id', type: 'integer'}],
        rows: [],
        totalRowCount: 0,
      };

      const artifact = store.store('table', data, 'tool');

      expect(artifact.summary.rowCount).toBe(0);
      expect(artifact.summary.sampleRows).toEqual([]);
    });

    it('单行数据应正常处理', () => {
      const data: ArtifactData = {
        columns: [{name: 'value', type: 'integer'}],
        rows: [[42]],
        totalRowCount: 1,
      };

      const artifact = store.store('table', data, 'tool');

      expect(artifact.summary.numericStats?.value.min).toBe(42);
      expect(artifact.summary.numericStats?.value.max).toBe(42);
      expect(artifact.summary.numericStats?.value.avg).toBe(42);
    });

    it('包含 null 值应正常处理', () => {
      const data: ArtifactData = {
        columns: [{name: 'value', type: 'integer'}],
        rows: [[10], [null], [20], [null], [30]],
        totalRowCount: 5,
      };

      const artifact = store.store('table', data, 'tool');

      // null 值应被过滤，只统计有效值
      expect(artifact.summary.numericStats?.value.min).toBe(10);
      expect(artifact.summary.numericStats?.value.max).toBe(30);
    });

    it('不同 artifact 类型应正常存储', () => {
      const types: ArtifactType[] = ['table', 'scalar', 'chart', 'trace_flow'];

      for (const type of types) {
        const artifact = store.store(type, createSimpleData(1), 'tool');
        expect(artifact.type).toBe(type);
      }
    });

    it('Token 估算应返回合理值', () => {
      const data: ArtifactData = {
        columns: [{name: 'data', type: 'string'}],
        rows: [['some data']],
        totalRowCount: 1,
      };

      const artifact = store.store('table', data, 'tool');

      expect(artifact.summary.estimatedTokens).toBeGreaterThan(0);
      expect(artifact.summary.estimatedTokens).toBeLessThan(10000);
    });
  });
});

// 辅助函数
function createSimpleData(value: number): ArtifactData {
  return {
    columns: [{name: 'value', type: 'integer'}],
    rows: [[value]],
    totalRowCount: 1,
  };
}
