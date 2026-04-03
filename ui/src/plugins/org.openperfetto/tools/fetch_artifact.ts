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
 * FetchArtifact Tool - 获取 Artifact 详细数据
 *
 * 功能：
 * - 从 ArtifactStore 获取已缓存的分析结果
 * - 支持分页获取数据
 * - 用于查看比摘要更详细的数据
 */

import {ITool, ToolDefinition, ToolExecutionResult} from './tool_registry';
import {ArtifactStore} from '../agent/artifact_store';

export class FetchArtifactTool implements ITool {
  readonly definition: ToolDefinition = {
    name: 'fetch_artifact',
    description: `Fetch detailed data from an Artifact in the store.

Use this when you need more data than the summary provides.
Data is paginated for efficiency.`,
    inputSchema: {
      type: 'object',
      properties: {
        artifactId: {
          type: 'string',
          description: 'The artifact ID (e.g., "art_1")',
        },
        startRow: {
          type: 'number',
          description: 'Starting row index (0-based)',
          default: 0,
        },
        count: {
          type: 'number',
          description: 'Number of rows to fetch (max: 50)',
          default: 20,
        },
      },
      required: ['artifactId'],
    },
    category: 'query',
    concurrency: 'parallel',
  };

  private artifactStore: ArtifactStore;

  constructor(artifactStore: ArtifactStore) {
    this.artifactStore = artifactStore;
  }

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const artifactId = args.artifactId as string;
    const startRow = (args.startRow as number) || 0;
    const count = Math.min((args.count as number) || 20, 50);

    const startTime = performance.now();

    const artifact = this.artifactStore.get(artifactId);
    if (!artifact) {
      return {
        success: false,
        error: `Artifact not found: ${artifactId}`,
        executionTimeMs: performance.now() - startTime,
      };
    }

    const rows = this.artifactStore.fetchPage(artifactId, startRow, count);
    if (!rows) {
      return {
        success: false,
        error: 'Failed to fetch artifact data',
        executionTimeMs: performance.now() - startTime,
      };
    }

    return {
      success: true,
      data: {
        artifactId,
        type: artifact.type,
        sourceTool: artifact.sourceTool,
        columns: artifact.fullData.columns.map((c) => c.name),
        rows,
        pagination: {
          startRow,
          count: rows.length,
          totalRows: artifact.fullData.totalRowCount,
          hasMore: startRow + rows.length < artifact.fullData.totalRowCount,
        },
      },
      executionTimeMs: performance.now() - startTime,
    };
  }
}
