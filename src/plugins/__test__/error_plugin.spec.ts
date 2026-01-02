import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ErrorPlugin,
  resourceTransform,
  interceptStr,
  unknownToString,
} from "../error_plugin";
import { Breadcrumb } from "../../core/breadcrumb";
import { ReportDataController } from "../../core/report";
import {
  EVENT_TYPE,
  PLUGIN_TYPE,
  STATUS_CODE,
  DEFAULTS,
} from "../../core/constant";
import { IOptionsParams } from "../../typings/options";
import { ErrorTarget, ResourceTarget } from "../../core/typing";

// Mock dependencies
vi.mock("../../core/breadcrumb");
vi.mock("../../core/report");
vi.mock("error-stack-parser", () => ({
  default: {
    parse: vi.fn(),
  },
}));

describe("ErrorPlugin", () => {
  let errorPlugin: ErrorPlugin;
  let mockBreadcrumb: vi.Mocked<Breadcrumb>;
  let mockReportData: vi.Mocked<ReportDataController>;
  let mockOptions: IOptionsParams;

  beforeEach(() => {
    mockBreadcrumb = {
      push: vi.fn(),
      getCategory: vi.fn().mockReturnValue("error"),
    } as any;

    mockReportData = {
      send: vi.fn(),
    } as any;

    mockOptions = {
      dsn: "test-dsn",
      apikey: "test-key",
      repeatCodeError: false,
    } as IOptionsParams;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with correct properties", () => {
      errorPlugin = new ErrorPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });

      expect(errorPlugin.name).toBe(PLUGIN_TYPE.ERROR_PLUGIN);
      expect(errorPlugin.options).toBe(mockOptions);
      expect(errorPlugin.breadcrumb).toBe(mockBreadcrumb);
      expect(errorPlugin.reportData).toBe(mockReportData);
      expect(errorPlugin.errorMap).toBeInstanceOf(Map);
    });

    it("should call setup during initialization", () => {
      const setupSpy = vi.spyOn(ErrorPlugin.prototype, "setup");

      new ErrorPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });

      expect(setupSpy).toHaveBeenCalled();
    });
  });

  describe("setup", () => {
    beforeEach(() => {
      errorPlugin = new ErrorPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("should call listenError and listenUnHandledRejection", () => {
      const listenErrorSpy = vi.spyOn(errorPlugin, "listenError");
      const listenUnHandledRejectionSpy = vi.spyOn(
        errorPlugin,
        "listenUnHandledRejection"
      );

      errorPlugin.setup();

      expect(listenErrorSpy).toHaveBeenCalled();
      expect(listenUnHandledRejectionSpy).toHaveBeenCalled();
    });
  });

  describe("handleError", () => {
    beforeEach(() => {
      errorPlugin = new ErrorPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("should handle JavaScript errors", async () => {
      const mockError: ErrorTarget = {
        message: "Test error message",
        filename: "test.js",
        lineno: 10,
        colno: 5,
        error: new Error("Test error"),
        target: null,
      } as any;

      // Mock ErrorStackParser
      const ErrorStackParser = await import("error-stack-parser");
      vi.mocked(ErrorStackParser.default.parse).mockReturnValue([
        {
          fileName: "test.js",
          lineNumber: 10,
          columnNumber: 5,
        },
      ]);

      errorPlugin.handleError(mockError);

      expect(mockBreadcrumb.push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPE.ERROR,
          category: "error",
          status: STATUS_CODE.ERROR,
          data: expect.objectContaining({
            data: expect.objectContaining({
              message: "Test error message",
              fileName: "test.js",
              line: 10,
              column: 5,
            }),
          }),
        })
      );

      expect(mockReportData.send).toHaveBeenCalled();
    });

    it("should handle errors with missing stack info gracefully", async () => {
      const mockError: ErrorTarget = {
        message: "Test error message",
        target: null,
      } as any;

      // Mock ErrorStackParser to throw
      const ErrorStackParser = await import("error-stack-parser");
      vi.mocked(ErrorStackParser.default.parse).mockImplementation(() => {
        throw new Error("Parse failed");
      });

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      errorPlugin.handleError(mockError);

      expect(consoleSpy).toHaveBeenCalledWith(
        "ErrorStackParser failed to parse stack:",
        expect.any(Error)
      );

      expect(mockBreadcrumb.push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPE.ERROR,
          category: "error",
          status: STATUS_CODE.ERROR,
          data: expect.objectContaining({
            data: expect.objectContaining({
              message: "Test error message",
              fileName: "unknown",
              line: 0,
              column: 0,
            }),
          }),
        })
      );

      consoleSpy.mockRestore();
    });

    it("should handle resource loading errors", () => {
      const mockResourceError: ErrorTarget = {
        target: {
          localName: "img",
          src: "https://example.com/image.jpg",
        },
      } as any;

      errorPlugin.handleError(mockResourceError);

      expect(mockBreadcrumb.push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPE.RESOURCE,
          status: STATUS_CODE.ERROR,
        })
      );

      expect(mockReportData.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPE.RESOURCE,
          status: STATUS_CODE.ERROR,
        })
      );
    });

    it("should skip resource errors when skipLocalName returns true", () => {
      const mockResourceError: ErrorTarget = {
        target: {
          localName: "img",
          src: "https://example.com/image.jpg",
        },
      } as any;

      const optionsWithSkip = {
        ...mockOptions,
        skipLocalName: vi.fn().mockReturnValue(true),
      };

      const pluginWithSkip = new ErrorPlugin({
        options: optionsWithSkip,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });

      pluginWithSkip.handleError(mockResourceError);

      expect(mockBreadcrumb.push).not.toHaveBeenCalled();
      expect(mockReportData.send).not.toHaveBeenCalled();
    });

    it("should respect repeatCodeError option", async () => {
      const mockError: ErrorTarget = {
        message: "Repeated error",
        filename: "test.js",
        lineno: 10,
        colno: 5,
        target: null,
      } as any;

      const ErrorStackParser = await import("error-stack-parser");
      vi.mocked(ErrorStackParser.default.parse).mockReturnValue([
        {
          fileName: "test.js",
          lineNumber: 10,
          columnNumber: 5,
        },
      ]);

      const optionsWithRepeat = {
        ...mockOptions,
        repeatCodeError: true,
      };

      const pluginWithRepeat = new ErrorPlugin({
        options: optionsWithRepeat,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });

      // 第一次调用应该发送
      pluginWithRepeat.handleError(mockError);
      expect(mockReportData.send).toHaveBeenCalledTimes(1);

      // 第二次调用相同错误不应该发送
      pluginWithRepeat.handleError(mockError);
      expect(mockReportData.send).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleUnhandledRejection", () => {
    beforeEach(() => {
      errorPlugin = new ErrorPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("should handle unhandled promise rejections", async () => {
      const mockRejectionEvent = {
        reason: {
          message: "Promise rejection",
          stack: "Error stack trace",
        },
      } as PromiseRejectionEvent;

      const ErrorStackParser = await import("error-stack-parser");
      vi.mocked(ErrorStackParser.default.parse).mockReturnValue([
        {
          fileName: "promise.js",
          lineNumber: 15,
          columnNumber: 8,
        },
      ]);

      errorPlugin.handleUnhandledRejection(mockRejectionEvent);

      expect(mockBreadcrumb.push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPE.UNHANDLEDREJECTION,
          status: STATUS_CODE.ERROR,
          data: expect.objectContaining({
            message: "Promise rejection",
            fileName: "promise.js",
            line: 15,
            column: 8,
          }),
        })
      );

      expect(mockReportData.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPE.UNHANDLEDREJECTION,
          message: "Promise rejection",
        })
      );
    });

    it("should handle parse errors gracefully", async () => {
      const mockRejectionEvent = {
        reason: {
          message: "Promise rejection",
        },
      } as PromiseRejectionEvent;

      const ErrorStackParser = await import("error-stack-parser");
      vi.mocked(ErrorStackParser.default.parse).mockImplementation(() => {
        throw new Error("Parse failed");
      });

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      errorPlugin.handleUnhandledRejection(mockRejectionEvent);

      expect(consoleSpy).toHaveBeenCalledWith(
        "ErrorStackParser failed to parse stack:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe("hashMapExist", () => {
    beforeEach(() => {
      errorPlugin = new ErrorPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("should return false for new hash and add it to map", () => {
      const hash = "test-hash";

      const result = errorPlugin.hashMapExist(hash);

      expect(result).toBe(false);
      // 验证hash被添加到map中
      expect(errorPlugin.errorMap.has(hash)).toBe(true);
    });

    it("should return true for existing hash", () => {
      const hash = "existing-hash";

      // 先添加hash
      errorPlugin.errorMap.set(hash, true);

      const result = errorPlugin.hashMapExist(hash);

      expect(result).toBe(true);
    });
  });
});

describe("Utility Functions", () => {
  describe("resourceTransform", () => {
    it("should transform resource target with src", () => {
      vi.setSystemTime(new Date("2023-01-01T00:00:00.000Z"));

      const target: ResourceTarget = {
        localName: "img",
        src: "https://example.com/image.jpg",
      } as any;

      const result = resourceTransform(target);

      expect(result).toEqual({
        time: 1672531200000,
        message: "https://example.com/image.jpg; 资源加载失败",
        name: "img",
      });
    });

    it("should transform resource target with href", () => {
      vi.setSystemTime(new Date("2023-01-01T00:00:00.000Z"));

      const target: ResourceTarget = {
        localName: "link",
        href: "https://example.com/style.css",
      } as any;

      const result = resourceTransform(target);

      expect(result).toEqual({
        time: 1672531200000,
        message: "https://example.com/style.css; 资源加载失败",
        name: "link",
      });
    });

    it("should handle long URLs with truncation", () => {
      const longUrl = "https://example.com/" + "a".repeat(2000);
      const target: ResourceTarget = {
        localName: "script",
        src: longUrl,
      } as any;

      const result = resourceTransform(target);

      expect(result.message).toContain("截取前1000个字符");
      expect(result.message.length).toBeLessThan(longUrl.length + 100);
    });
  });

  describe("interceptStr", () => {
    it("should return original string if shorter than limit", () => {
      const str = "short string";
      const result = interceptStr(str, 100);
      expect(result).toBe("short string");
    });

    it("should truncate string if longer than limit", () => {
      const str = "a".repeat(1500);
      const result = interceptStr(str, 1000);

      expect(result).toContain("截取前1000个字符");
      expect(result.length).toBe(1000 + "：截取前1000个字符".length);
    });

    it("should handle non-string input", () => {
      // @ts-ignore - 测试类型错误情况
      expect(interceptStr(null, 100)).toBe("");
      // @ts-ignore - 测试类型错误情况
      expect(interceptStr(undefined, 100)).toBe("");
      // @ts-ignore - 测试类型错误情况
      expect(interceptStr(123, 100)).toBe("");
    });
  });

  describe("unknownToString", () => {
    it("should return string as is", () => {
      expect(unknownToString("test string")).toBe("test string");
    });

    it('should return "undefined" for undefined', () => {
      expect(unknownToString(undefined)).toBe("undefined");
    });

    it("should stringify other values", () => {
      expect(unknownToString({ key: "value" })).toBe('{"key":"value"}');
      expect(unknownToString([1, 2, 3])).toBe("[1,2,3]");
      expect(unknownToString(123)).toBe("123");
      expect(unknownToString(null)).toBe("null");
    });
  });
});
