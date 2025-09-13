import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Queue } from "../queue";

// Mock global objects
const mockGlobal = {
  requestIdleCallback: vi.fn(),
  Promise: Promise,
};

describe("Queue", () => {
  let queue: Queue;

  beforeEach(() => {
    // 重置单例实例
    // @ts-ignore - 访问私有静态属性进行测试
    Queue.instance = undefined;
    queue = new Queue();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Singleton Pattern", () => {
    it("should return same instance for getInstance", () => {
      const instance1 = Queue.getInstance();
      const instance2 = Queue.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("should create new instance if none exists", () => {
      const instance = Queue.getInstance();
      expect(instance).toBeInstanceOf(Queue);
    });
  });

  describe("addFn", () => {
    it("should not add non-function values", () => {
      // @ts-ignore - 测试类型错误情况
      queue.addFn("not a function");
      // @ts-ignore - 测试类型错误情况
      queue.addFn(123);
      // @ts-ignore - 测试类型错误情况
      queue.addFn(null);

      expect(queue.allStack).toHaveLength(0);
    });

    it("should execute function immediately if no requestIdleCallback or Promise", () => {
      const mockFn = vi.fn();

      // Mock global without requestIdleCallback and Promise
      const originalGlobal = global;
      // @ts-ignore
      global.requestIdleCallback = undefined;
      // @ts-ignore
      global.Promise = undefined;

      queue.addFn(mockFn);

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(queue.allStack).toHaveLength(0);

      // Restore
      Object.assign(global, originalGlobal);
    });

    it("should add function to stack when requestIdleCallback is available", () => {
      const mockFn = vi.fn();

      // Mock requestIdleCallback
      global.requestIdleCallback = vi.fn((callback) => {
        // 立即执行回调以便测试
        setTimeout(callback, 0);
        return 1;
      });

      queue.addFn(mockFn);

      expect(queue.allStack).toHaveLength(1);
      expect(global.requestIdleCallback).toHaveBeenCalled();
    });

    it("should use Promise when requestIdleCallback is not available", () => {
      const mockFn = vi.fn();

      // Mock global with Promise but no requestIdleCallback
      // @ts-ignore
      global.requestIdleCallback = undefined;
      const promiseResolveSpy = vi.spyOn(Promise, "resolve");

      queue.addFn(mockFn);

      expect(queue.allStack).toHaveLength(1);
      expect(promiseResolveSpy).toHaveBeenCalled();
    });

    it("should set isFlushing flag when adding first function", () => {
      const mockFn = vi.fn();

      global.requestIdleCallback = vi.fn();

      expect(queue["isFlushing"]).toBe(false);
      queue.addFn(mockFn);
      expect(queue["isFlushing"]).toBe(true);
    });

    it("should not trigger flush multiple times when adding multiple functions", () => {
      const mockFn1 = vi.fn();
      const mockFn2 = vi.fn();

      global.requestIdleCallback = vi.fn();

      queue.addFn(mockFn1);
      queue.addFn(mockFn2);

      // requestIdleCallback 应该只被调用一次
      expect(global.requestIdleCallback).toHaveBeenCalledTimes(1);
      expect(queue.allStack).toHaveLength(2);
    });
  });

  describe("flushStack", () => {
    it("should return early if stack is empty", () => {
      const consoleSpy = vi.spyOn(console, "error");

      queue.flushStack();

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("should execute all functions in stack", () => {
      const mockFn1 = vi.fn();
      const mockFn2 = vi.fn();
      const mockFn3 = vi.fn();

      // 直接添加到stack而不触发flush
      queue["stack"] = [mockFn1, mockFn2, mockFn3];

      queue.flushStack();

      expect(mockFn1).toHaveBeenCalledTimes(1);
      expect(mockFn2).toHaveBeenCalledTimes(1);
      expect(mockFn3).toHaveBeenCalledTimes(1);
    });

    it("should clear stack after execution", () => {
      const mockFn = vi.fn();
      queue["stack"] = [mockFn];

      expect(queue.allStack).toHaveLength(1);
      queue.flushStack();
      expect(queue.allStack).toHaveLength(0);
    });

    it("should reset isFlushing flag", () => {
      const mockFn = vi.fn();
      queue["stack"] = [mockFn];
      queue["isFlushing"] = true;

      queue.flushStack();

      expect(queue["isFlushing"]).toBe(false);
    });

    it("should handle function execution errors gracefully", () => {
      const errorFn = vi.fn(() => {
        throw new Error("Test error");
      });
      const normalFn = vi.fn();
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      queue["stack"] = [errorFn, normalFn];

      queue.flushStack();

      // 错误函数应该被调用
      expect(errorFn).toHaveBeenCalledTimes(1);
      // 正常函数也应该被调用（不受错误影响）
      expect(normalFn).toHaveBeenCalledTimes(1);
      // 应该记录错误
      expect(consoleSpy).toHaveBeenCalledWith(
        "Queue execution error:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should continue execution even if one function throws", () => {
      const errorFn1 = vi.fn(() => {
        throw new Error("Error 1");
      });
      const errorFn2 = vi.fn(() => {
        throw new Error("Error 2");
      });
      const normalFn = vi.fn();
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      queue["stack"] = [errorFn1, normalFn, errorFn2];

      queue.flushStack();

      expect(errorFn1).toHaveBeenCalledTimes(1);
      expect(normalFn).toHaveBeenCalledTimes(1);
      expect(errorFn2).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });
  });

  describe("clear", () => {
    it("should clear all functions from stack", () => {
      const mockFn1 = vi.fn();
      const mockFn2 = vi.fn();

      queue["stack"] = [mockFn1, mockFn2];
      expect(queue.allStack).toHaveLength(2);

      queue.clear();
      expect(queue.allStack).toHaveLength(0);
    });
  });

  describe("allStack getter", () => {
    it("should return current stack", () => {
      const mockFn1 = vi.fn();
      const mockFn2 = vi.fn();

      queue["stack"] = [mockFn1, mockFn2];

      const stack = queue.allStack;
      expect(stack).toHaveLength(2);
      expect(stack[0]).toBe(mockFn1);
      expect(stack[1]).toBe(mockFn2);
    });

    it("should return empty array for empty stack", () => {
      expect(queue.allStack).toEqual([]);
    });
  });

  describe("Integration Test", () => {
    it("should handle complete workflow with requestIdleCallback", async () => {
      const mockFn1 = vi.fn();
      const mockFn2 = vi.fn();

      // Mock requestIdleCallback to execute callback asynchronously
      global.requestIdleCallback = vi.fn((callback) => {
        setTimeout(callback, 10);
        return 1;
      });

      queue.addFn(mockFn1);
      queue.addFn(mockFn2);

      expect(queue.allStack).toHaveLength(2);
      expect(mockFn1).not.toHaveBeenCalled();
      expect(mockFn2).not.toHaveBeenCalled();

      // 等待异步执行
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockFn1).toHaveBeenCalledTimes(1);
      expect(mockFn2).toHaveBeenCalledTimes(1);
      expect(queue.allStack).toHaveLength(0);
    });

    it("should handle complete workflow with Promise", async () => {
      const mockFn1 = vi.fn();
      const mockFn2 = vi.fn();

      // Remove requestIdleCallback, use Promise
      // @ts-ignore
      global.requestIdleCallback = undefined;

      queue.addFn(mockFn1);
      queue.addFn(mockFn2);

      expect(queue.allStack).toHaveLength(2);

      // 等待Promise.resolve().then()执行
      await Promise.resolve();

      expect(mockFn1).toHaveBeenCalledTimes(1);
      expect(mockFn2).toHaveBeenCalledTimes(1);
      expect(queue.allStack).toHaveLength(0);
    });
  });
});
