/**
 * 测试基础设施 Smoke Test
 * 
 * 验证 Jest + TypeScript + ESM 配置是否正确工作
 */

describe('Test Infrastructure', () => {
  it('should run tests successfully', () => {
    expect(1 + 1).toBe(2);
  });

  it('should support async/await', async () => {
    const result = await Promise.resolve('hello');
    expect(result).toBe('hello');
  });

  it('should support TypeScript types', () => {
    interface TestType {
      name: string;
      value: number;
    }
    
    const obj: TestType = { name: 'test', value: 42 };
    expect(obj.name).toBe('test');
    expect(obj.value).toBe(42);
  });

  it('should support async generators', async () => {
    async function* asyncGenerator(): AsyncGenerator<number> {
      yield 1;
      yield 2;
      yield 3;
    }
    
    const results: number[] = [];
    for await (const value of asyncGenerator()) {
      results.push(value);
    }
    
    expect(results).toEqual([1, 2, 3]);
  });
});
