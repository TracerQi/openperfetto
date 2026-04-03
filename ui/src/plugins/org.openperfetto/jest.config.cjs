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
 * Jest Configuration for OpenPerfetto Plugin
 *
 * 独立的测试配置，支持 TypeScript 和 jsdom 环境
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],

  // 将 .js import 映射回 .ts（因为源码使用 .js 扩展名导入）
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // 覆盖 tsconfig 配置以适配测试环境
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowJs: true,
          strict: true,
          noUnusedLocals: false,
          noUnusedParameters: false,
          target: 'es2021',
          lib: ['es2021', 'dom'],
          // 不要求 .js 扩展名
          paths: {},
        },
      },
    ],
  },

  // 忽略 node_modules 但允许处理某些特定包
  transformIgnorePatterns: [
    'node_modules/(?!(@anthropic-ai|openai)/)',
  ],

  // 模块目录
  moduleDirectories: ['node_modules', '<rootDir>'],

  // 测试设置文件
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],

  // 覆盖率配置（可选）
  collectCoverageFrom: [
    'agent/**/*.ts',
    'services/**/*.ts',
    'tools/**/*.ts',
    '!**/*.d.ts',
    '!**/index.ts',
  ],

  // 测试超时
  testTimeout: 10000,

  // 清除 mock
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
