/**
 * Jest 配置文件
 * 
 * 支持 TypeScript + ESM 的测试配置
 */

/** @type {import('jest').Config} */
module.exports = {
  // 使用 ts-jest preset
  preset: 'ts-jest',
  
  // Node.js 测试环境
  testEnvironment: 'node',
  
  // 支持 ESM
  extensionsToTreatAsEsm: ['.ts'],
  
  // 测试文件匹配模式
  testMatch: [
    '<rootDir>/__tests__/**/*.test.ts',
  ],
  
  // 路径映射：将 .js import 映射回 .ts 文件
  // 因为 ESM 的 import 使用 .js 扩展名
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  
  // TypeScript 转换配置
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  
  // 根目录
  rootDir: '.',
  
  // 模块文件扩展名
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  
  // 覆盖率配置
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  
  // 在测试运行前清除 mock
  clearMocks: true,
  
  // 测试超时时间（毫秒）
  testTimeout: 30000,
  
  // 详细输出
  verbose: true,
};
