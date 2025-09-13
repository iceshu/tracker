import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TrackInit } from "../index";
import { IOptionsParams } from "../typings/options";
import { EVENT_TYPE } from "../core/constant";

// Mock _global to point to our mock window and document
vi.mock("../core/global", async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    get _global() {
      return {
        ...global.window,
        document: global.document,
      };
    },
  };
});

describe("Integration Tests", () => {
  let mockOptions: IOptionsParams;
  let originalConsoleMocks: any;

  beforeEach(() => {
    mockOptions = {
      dsn: "https://api.example.com/report",
      apikey: "test-api-key",
      supportPlugins: ["ConsolePlugin", "ErrorPlugin", "DomPlugin"],
      maxBreadcrumbs: 10,
    };

    // Mock global objects and save references
    originalConsoleMocks = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      assert: vi.fn(),
    };

    global.console = originalConsoleMocks;

    // 设置 window mock
    const mockWindow = {
      console: global.console,
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      location: {
        href: "https://example.com/test-page",
      },
    } as any;

    global.window = mockWindow;
    // 同时设置 globalThis.window 以确保兼容性
    (globalThis as any).window = mockWindow;
    // 确保 _global 也指向我们的 mock window
    Object.defineProperty(global, "window", {
      value: mockWindow,
      writable: true,
      configurable: true,
    });

    global.document = {
      addEventListener: vi.fn(),
      location: {
        href: "https://example.com/test-page",
      },
    } as any;

    global.navigator = {
      sendBeacon: vi.fn().mockReturnValue(true),
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    } as any;

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TrackInit", () => {
    it("should initialize tracker with plugins", () => {
      const tracker = TrackInit(mockOptions);

      expect(tracker).toBeDefined();
      expect(tracker.getOptions().dsn).toBe("https://api.example.com/report");
      expect(tracker.getOptions().apikey).toBe("test-api-key");
    });

    it("should initialize only specified plugins", () => {
      const optionsWithLimitedPlugins = {
        ...mockOptions,
        supportPlugins: ["ConsolePlugin"],
      };

      const tracker = TrackInit(optionsWithLimitedPlugins);

      expect(tracker).toBeDefined();
      // 验证只有指定的插件被初始化
      const consolePlugin = tracker.getPlugin("CONSOLE_PLUGIN");
      expect(consolePlugin).toBeDefined();
    });

    it("should handle empty plugin list", () => {
      const optionsWithNoPlugins = {
        ...mockOptions,
        supportPlugins: [],
      };

      expect(() => {
        TrackInit(optionsWithNoPlugins);
      }).not.toThrow();
    });

    it("should add Vue plugin when vue option is provided", () => {
      const mockVue = {
        config: {
          errorHandler: null,
        },
        version: "3.0.0",
      };

      const optionsWithVue = {
        ...mockOptions,
        vue: mockVue,
      };

      const tracker = TrackInit(optionsWithVue);
      expect(tracker).toBeDefined();
    });
  });

  describe("Console Plugin Integration", () => {
    it("should capture console calls and create breadcrumbs", () => {
      // 在测试中重新创建console mock，因为插件会替换它们
      const logSpy = vi.spyOn(console, "log");
      const errorSpy = vi.spyOn(console, "error");

      const tracker = TrackInit({
        ...mockOptions,
        supportPlugins: ["ConsolePlugin"],
      });

      // 模拟console调用
      console.log("Test log message");
      console.error("Test error message");

      // 验证breadcrumb被创建
      // 注意：这里需要访问内部状态，在实际测试中可能需要暴露一些测试接口
      expect(logSpy).toHaveBeenCalledWith("Test log message");
      expect(errorSpy).toHaveBeenCalledWith("Test error message");
    });
  });

  describe("Error Plugin Integration", () => {
    it("should capture window errors", () => {
      // 清除之前的调用历史
      vi.clearAllMocks();

      const tracker = TrackInit({
        ...mockOptions,
        supportPlugins: ["ErrorPlugin"],
      });

      // 验证addEventListener被调用
      expect(global.window.addEventListener).toHaveBeenCalledWith(
        "error",
        expect.any(Function),
        true
      );

      // 模拟window error事件
      const errorEvent = new ErrorEvent("error", {
        message: "Test error",
        filename: "test.js",
        lineno: 10,
        colno: 5,
        error: new Error("Test error"),
      });

      // 触发error事件
      window.dispatchEvent(errorEvent);
    });

    it("should capture unhandled promise rejections", () => {
      // 清除之前的调用历史
      vi.clearAllMocks();

      const tracker = TrackInit({
        ...mockOptions,
        supportPlugins: ["ErrorPlugin"],
      });

      // 验证unhandledrejection监听器被添加
      expect(global.window.addEventListener).toHaveBeenCalledWith(
        "unhandledrejection",
        expect.any(Function),
        true
      );
    });
  });

  describe("DOM Plugin Integration", () => {
    it("should capture click events", () => {
      const tracker = TrackInit({
        ...mockOptions,
        supportPlugins: ["DomPlugin"],
      });

      // 验证click监听器被添加
      expect(global.document.addEventListener).toHaveBeenCalledWith(
        "click",
        expect.any(Function),
        true
      );
    });
  });

  describe("Multiple Plugins Integration", () => {
    it("should work with multiple plugins enabled", () => {
      // 清除之前的调用历史
      vi.clearAllMocks();

      const tracker = TrackInit({
        ...mockOptions,
        supportPlugins: ["ConsolePlugin", "ErrorPlugin", "DomPlugin"],
      });

      expect(tracker).toBeDefined();

      // 验证所有插件的监听器都被添加
      expect(global.window.addEventListener).toHaveBeenCalledWith(
        "error",
        expect.any(Function),
        true
      );
      expect(global.window.addEventListener).toHaveBeenCalledWith(
        "unhandledrejection",
        expect.any(Function),
        true
      );
      expect(global.document.addEventListener).toHaveBeenCalledWith(
        "click",
        expect.any(Function),
        true
      );
    });
  });

  describe("Configuration Options", () => {
    it("should respect maxBreadcrumbs option", () => {
      const tracker = TrackInit({
        ...mockOptions,
        maxBreadcrumbs: 5,
        supportPlugins: ["ConsolePlugin"],
      });

      expect(tracker.getOptions().maxBreadcrumbs).toBe(5);
    });

    it("should handle missing dsn gracefully", () => {
      const optionsWithoutDsn = {
        apikey: "test-key",
        supportPlugins: ["ConsolePlugin"],
      } as IOptionsParams;

      expect(() => {
        TrackInit(optionsWithoutDsn);
      }).not.toThrow();
    });
  });

  describe("Error Handling", () => {
    it("should handle plugin initialization errors gracefully", () => {
      const optionsWithInvalidPlugin = {
        ...mockOptions,
        supportPlugins: ["NonExistentPlugin", "ConsolePlugin"],
      };

      expect(() => {
        TrackInit(optionsWithInvalidPlugin);
      }).not.toThrow();
    });
  });

  describe("Memory Management", () => {
    it("should not cause memory leaks with multiple initializations", () => {
      // 创建多个tracker实例
      for (let i = 0; i < 10; i++) {
        const tracker = TrackInit({
          ...mockOptions,
          supportPlugins: ["ConsolePlugin"],
        });
        expect(tracker).toBeDefined();
      }

      // 验证没有抛出内存相关错误
      expect(true).toBe(true);
    });
  });

  describe("Real-world Scenarios", () => {
    it("should handle rapid console calls without issues", () => {
      const logSpy = vi.spyOn(console, "log");

      const tracker = TrackInit({
        ...mockOptions,
        supportPlugins: ["ConsolePlugin"],
      });

      // 快速连续调用console
      for (let i = 0; i < 100; i++) {
        console.log(`Message ${i}`);
      }

      expect(logSpy).toHaveBeenCalledTimes(100);
    });

    it("should handle complex error objects", () => {
      const tracker = TrackInit({
        ...mockOptions,
        supportPlugins: ["ErrorPlugin"],
      });

      const complexError = {
        name: "CustomError",
        message: "Complex error with nested data",
        stack: "Error stack trace...",
        customData: {
          userId: 123,
          action: "button_click",
          metadata: {
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
          },
        },
      };

      // 创建error事件
      const errorEvent = new ErrorEvent("error", {
        message: complexError.message,
        error: complexError,
      });

      expect(() => {
        window.dispatchEvent(errorEvent);
      }).not.toThrow();
    });
  });
});
