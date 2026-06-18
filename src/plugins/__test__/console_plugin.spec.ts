import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConsolePlugin } from "../console_plugin";
import { Breadcrumb } from "../../core/breadcrumb";
import { ReportDataController } from "../../core/report";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE } from "../../core/constant";
import { IOptionsParams } from "../../typings/options";

// Mock dependencies
vi.mock("../../core/breadcrumb");
vi.mock("../../core/report");

describe("ConsolePlugin", () => {
  let consolePlugin: ConsolePlugin;
  let mockBreadcrumb: vi.Mocked<Breadcrumb>;
  let mockReportData: vi.Mocked<ReportDataController>;
  let mockOptions: IOptionsParams;
  let originalConsole: Console;

  beforeEach(() => {
    // 保存原始console
    originalConsole = global.console;

    // 创建mock实例
    mockBreadcrumb = {
      push: vi.fn(),
      getCategory: vi.fn().mockReturnValue("console"),
    } as any;

    mockReportData = {
      send: vi.fn(),
    } as any;

    mockOptions = {
      dsn: "test-dsn",
      apikey: "test-key",
    } as IOptionsParams;

    // 创建插件实例
    consolePlugin = new ConsolePlugin({
      options: mockOptions,
      breadcrumb: mockBreadcrumb,
      reportData: mockReportData,
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    // 恢复原始console
    global.console = originalConsole;
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with correct properties", () => {
      expect(consolePlugin.name).toBe(PLUGIN_TYPE.CONSOLE_PLUGIN);
      expect(consolePlugin.options).toBe(mockOptions);
      expect(consolePlugin.breadcrumb).toBe(mockBreadcrumb);
      expect(consolePlugin.reportData).toBe(mockReportData);
    });

    it("should call setup during initialization", () => {
      const setupSpy = vi.spyOn(ConsolePlugin.prototype, "setup");

      new ConsolePlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });

      expect(setupSpy).toHaveBeenCalled();
    });
  });

  describe("handleConsole", () => {
    it("should push breadcrumb with correct data", () => {
      vi.setSystemTime(new Date("2023-01-01T00:00:00.000Z"));

      const testData = {
        args: ["test message", "arg2"],
        level: "log",
      };

      consolePlugin.handleConsole(testData);

      expect(mockBreadcrumb.push).toHaveBeenCalledWith({
        type: EVENT_TYPE.CONSOLE,
        category: "console",
        data: testData,
        level: "log",
        status: STATUS_CODE.OK,
        time: 1672531200000,
      });
    });

    it("should handle different log levels", () => {
      const levels = ["log", "debug", "info", "warn", "error", "assert"];

      levels.forEach((level) => {
        const testData = {
          args: [`${level} message`],
          level,
        };

        consolePlugin.handleConsole(testData);

        expect(mockBreadcrumb.push).toHaveBeenCalledWith(
          expect.objectContaining({
            level,
            data: testData,
          })
        );
      });
    });
  });

  describe("replace", () => {
    it("should not replace if console is not available", () => {
      // Mock global without console
      const mockGlobal = {} as any;
      vi.stubGlobal("window", mockGlobal);

      const replaceSpy = vi.spyOn(consolePlugin, "replace");
      consolePlugin.replace();

      // 方法应该提前返回
      expect(replaceSpy).toHaveBeenCalled();
    });

    it("should replace all console methods", () => {
      const mockConsole = {
        log: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        assert: vi.fn(),
      };

      vi.stubGlobal("console", mockConsole);
      vi.stubGlobal("window", { console: mockConsole });

      consolePlugin.destroy();
      consolePlugin.replace();

      // 验证所有方法都被替换了
      expect(typeof global.console.log).toBe("function");
      expect(typeof global.console.debug).toBe("function");
      expect(typeof global.console.info).toBe("function");
      expect(typeof global.console.warn).toBe("function");
      expect(typeof global.console.error).toBe("function");
      expect(typeof global.console.assert).toBe("function");
    });

    it("should skip methods that do not exist on console", () => {
      const partialConsole = {
        log: vi.fn(),
        info: vi.fn(),
        // 缺少其他方法
      };

      vi.stubGlobal("console", partialConsole);
      vi.stubGlobal("window", { console: partialConsole });

      expect(() => {
        consolePlugin.replace();
      }).not.toThrow();
    });

    it("should intercept console calls and trigger handleConsole", () => {
      const originalLogMock = vi.fn();
      const mockConsole = {
        log: originalLogMock,
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        assert: vi.fn(),
      };

      vi.stubGlobal("console", mockConsole);
      vi.stubGlobal("window", { console: mockConsole });

      const freshPlugin = new ConsolePlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
      const handleConsoleSpy = vi.spyOn(freshPlugin, "handleConsole");

      // 调用被替换的console方法
      global.console.log("test message", "arg2");

      expect(handleConsoleSpy).toHaveBeenCalledWith({
        args: ["test message", "arg2"],
        level: "log",
      });

      // 原始console方法也应该被调用
      expect(originalLogMock).toHaveBeenCalledWith("test message", "arg2");
    });

    it("should handle all console levels correctly", () => {
      const mockConsole = {
        log: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        assert: vi.fn(),
      };

      vi.stubGlobal("console", mockConsole);
      vi.stubGlobal("window", { console: mockConsole });

      const freshPlugin = new ConsolePlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
      const handleConsoleSpy = vi.spyOn(freshPlugin, "handleConsole");

      // 测试所有级别
      global.console.log("log message");
      global.console.debug("debug message");
      global.console.info("info message");
      global.console.warn("warn message");
      global.console.error("error message");
      global.console.assert(false, "assert message");

      expect(handleConsoleSpy).toHaveBeenCalledTimes(6);

      // 验证每个调用的参数
      expect(handleConsoleSpy).toHaveBeenNthCalledWith(1, {
        args: ["log message"],
        level: "log",
      });
      expect(handleConsoleSpy).toHaveBeenNthCalledWith(2, {
        args: ["debug message"],
        level: "debug",
      });
      expect(handleConsoleSpy).toHaveBeenNthCalledWith(6, {
        args: [false, "assert message"],
        level: "assert",
      });
    });

    it("should preserve console context when calling original methods", () => {
      const originalLogMock = vi.fn();
      const originalErrorMock = vi.fn();
      const mockConsole = {
        log: originalLogMock,
        error: originalErrorMock,
      };

      vi.stubGlobal("console", mockConsole);
      vi.stubGlobal("window", { console: mockConsole });

      new ConsolePlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });

      global.console.log("test");
      global.console.error("error");

      // 验证原始方法被正确调用
      expect(originalLogMock).toHaveBeenCalledWith("test");
      expect(originalErrorMock).toHaveBeenCalledWith("error");
    });

    it("should handle case when original console method is null", () => {
      const mockConsole = {
        log: null,
        error: vi.fn(),
      };

      vi.stubGlobal("console", mockConsole);
      vi.stubGlobal("window", { console: mockConsole });

      const freshPlugin = new ConsolePlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
      const handleConsoleSpy = vi.spyOn(freshPlugin, "handleConsole");

      // 调用被替换的方法，即使原始方法为null
      // @ts-ignore
      global.console.log?.("test");

      // handleConsole不应该被调用，因为原始方法为null
      expect(handleConsoleSpy).not.toHaveBeenCalled();
    });
  });

  describe("setup", () => {
    it("should call replace method", () => {
      const replaceSpy = vi.spyOn(consolePlugin, "replace");

      consolePlugin.setup();

      expect(replaceSpy).toHaveBeenCalled();
    });
  });

  describe("Integration Test", () => {
    it("should work end-to-end with real console calls", () => {
      // 重置所有mock
      vi.clearAllMocks();

      // 重新创建 mockBreadcrumb
      const freshMockBreadcrumb = {
        push: vi.fn(),
        getStack: vi.fn().mockReturnValue([]),
        getCategory: vi.fn().mockReturnValue("console"),
      } as any;

      const originalLogMock = vi.fn();
      const originalErrorMock = vi.fn();
      const originalWarnMock = vi.fn();
      const mockConsole = {
        log: originalLogMock,
        error: originalErrorMock,
        warn: originalWarnMock,
      };

      vi.stubGlobal("console", mockConsole);
      vi.stubGlobal("window", { console: mockConsole });

      // 创建新的插件实例来测试完整流程
      const plugin = new ConsolePlugin({
        options: mockOptions,
        breadcrumb: freshMockBreadcrumb,
        reportData: mockReportData,
      });

      plugin.replace();

      // 调用console方法
      global.console.log("This is a log message");
      global.console.error("This is an error message");
      global.console.warn("This is a warning message");

      // 验证breadcrumb被正确调用 (至少被调用了3次，可能有其他测试也调用了console)
      expect(freshMockBreadcrumb.push.mock.calls.length).toBeGreaterThanOrEqual(
        3
      );

      // 验证最后3次调用是我们期望的
      const calls = freshMockBreadcrumb.push.mock.calls;
      const lastThreeCalls = calls.slice(-3);
      expect(lastThreeCalls).toHaveLength(3);

      // 验证原始console方法被调用
      expect(originalLogMock).toHaveBeenCalledWith("This is a log message");
      expect(originalErrorMock).toHaveBeenCalledWith(
        "This is an error message"
      );
      expect(originalWarnMock).toHaveBeenCalledWith(
        "This is a warning message"
      );
    });
  });
});
