/**
 * CircuitBreaker 测试
 * 测试熔断器状态转换和故障处理
 */

import { CircuitBreaker, CircuitState } from '../../src/services/llm_proxy.js';

describe('CircuitBreaker', () => {
  // ============= 初始状态测试 =============
  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      const breaker = new CircuitBreaker('test');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should allow execution in CLOSED state', () => {
      const breaker = new CircuitBreaker('test');
      expect(breaker.canExecute()).toBe(true);
    });

    it('should report initial stats correctly', () => {
      const breaker = new CircuitBreaker('test');
      const stats = breaker.getStats();
      expect(stats.state).toBe(CircuitState.CLOSED);
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
    });
  });

  // ============= 故障计数和熔断测试 =============
  describe('Failure Counting and Circuit Opening', () => {
    it('should increment failure count on recordFailure', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 5 });
      
      breaker.recordFailure();
      expect(breaker.getStats().failureCount).toBe(1);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should open circuit after reaching failure threshold', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 3 });
      
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      
      breaker.recordFailure(); // 第三次失败，达到阈值
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should use default failure threshold of 5', () => {
      const breaker = new CircuitBreaker('test');
      
      for (let i = 0; i < 4; i++) {
        breaker.recordFailure();
      }
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      
      breaker.recordFailure(); // 第5次
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  // ============= OPEN 状态测试 =============
  describe('OPEN State Behavior', () => {
    it('should reject execution in OPEN state', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 1 });
      
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(breaker.canExecute()).toBe(false);
    });

    it('should remain OPEN until reset timeout', () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        resetTimeout: 1000,
      });
      
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
      
      // 立即检查，应该仍然是 OPEN
      expect(breaker.canExecute()).toBe(false);
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        resetTimeout: 50, // 50ms 超时
      });
      
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
      
      // 等待超时
      await new Promise(resolve => setTimeout(resolve, 60));
      
      // canExecute 会检查并转换状态
      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });
  });

  // ============= HALF_OPEN 状态测试 =============
  describe('HALF_OPEN State Behavior', () => {
    let breaker: CircuitBreaker;

    beforeEach(async () => {
      breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        resetTimeout: 10,
        halfOpenSuccessThreshold: 2,
      });
      
      // 进入 OPEN 状态
      breaker.recordFailure();
      
      // 等待进入 HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 20));
      breaker.canExecute(); // 触发状态转换
    });

    it('should allow execution in HALF_OPEN state', () => {
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
      expect(breaker.canExecute()).toBe(true);
    });

    it('should transition to CLOSED after reaching success threshold', () => {
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
      
      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
      
      breaker.recordSuccess(); // 第二次成功，达到阈值
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should transition back to OPEN on failure in HALF_OPEN', () => {
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
      
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should reset success count when entering HALF_OPEN', async () => {
      // 记录一次成功
      breaker.recordSuccess();
      expect(breaker.getStats().successCount).toBe(1);
      
      // 失败回到 OPEN
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
      
      // 等待再次进入 HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 20));
      breaker.canExecute();
      
      // 成功计数应该重置
      expect(breaker.getStats().successCount).toBe(0);
    });
  });

  // ============= 成功记录测试 =============
  describe('Success Recording', () => {
    it('should reset failure count on success in CLOSED state', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 5 });
      
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getStats().failureCount).toBe(2);
      
      breaker.recordSuccess();
      expect(breaker.getStats().failureCount).toBe(0);
    });

    it('should not change state on success in CLOSED state', () => {
      const breaker = new CircuitBreaker('test');
      
      breaker.recordSuccess();
      breaker.recordSuccess();
      
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  // ============= 完整状态循环测试 =============
  describe('Full State Cycle', () => {
    it('should complete full cycle: CLOSED -> OPEN -> HALF_OPEN -> CLOSED', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 2,
        resetTimeout: 20,
        halfOpenSuccessThreshold: 1,
      });
      
      // 初始状态
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      
      // 连续失败进入 OPEN
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(breaker.canExecute()).toBe(false);
      
      // 等待进入 HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
      
      // 成功后回到 CLOSED
      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.canExecute()).toBe(true);
    });

    it('should handle cycle: CLOSED -> OPEN -> HALF_OPEN -> OPEN (on failure)', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        resetTimeout: 10,
        halfOpenSuccessThreshold: 2,
      });
      
      // 进入 OPEN
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
      
      // 等待进入 HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 20));
      breaker.canExecute();
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
      
      // 失败回到 OPEN
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(breaker.canExecute()).toBe(false);
    });
  });

  // ============= 自定义配置测试 =============
  describe('Custom Configuration', () => {
    it('should respect custom failure threshold', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 10 });
      
      for (let i = 0; i < 9; i++) {
        breaker.recordFailure();
      }
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should respect custom half-open success threshold', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        resetTimeout: 10,
        halfOpenSuccessThreshold: 5,
      });
      
      breaker.recordFailure();
      await new Promise(resolve => setTimeout(resolve, 20));
      breaker.canExecute();
      
      // 需要5次成功才能关闭
      for (let i = 0; i < 4; i++) {
        breaker.recordSuccess();
        expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
      }
      
      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  // ============= 边界条件测试 =============
  describe('Edge Cases', () => {
    it('should handle rapid state transitions', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        resetTimeout: 5,
        halfOpenSuccessThreshold: 1,
      });
      
      // 快速循环多次
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure();
        expect(breaker.getState()).toBe(CircuitState.OPEN);
        
        await new Promise(resolve => setTimeout(resolve, 10));
        breaker.canExecute();
        
        breaker.recordSuccess();
        expect(breaker.getState()).toBe(CircuitState.CLOSED);
      }
    });

    it('should maintain correct state with interleaved operations', () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 3 });
      
      breaker.recordFailure();
      breaker.recordSuccess(); // 重置
      breaker.recordFailure();
      breaker.recordFailure();
      
      // 只有2次连续失败，不应该打开
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should use breaker name for identification', () => {
      const breaker1 = new CircuitBreaker('service-a');
      const breaker2 = new CircuitBreaker('service-b');
      
      // 两个熔断器独立工作
      breaker1.recordFailure();
      
      expect(breaker1.getStats().failureCount).toBe(1);
      expect(breaker2.getStats().failureCount).toBe(0);
    });
  });
});
