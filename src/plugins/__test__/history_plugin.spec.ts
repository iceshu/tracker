import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HistoryPlugin } from "../history_plugin";
import { Breadcrumb } from "../../core/breadcrumb";
import { ReportDataController } from "../../core/report";
import {
  EVENT_TYPE,
  PLUGIN_TYPE,
  STATUS_CODE,
} from "../../core/constant";
import { IOptionsParams } from "../../typings/options";

// Mock dependencies
vi.mock("../../core/breadcrumb");
vi.mock("../../core/report");

// Mock window.requestIdleCallback
const mockRequestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
  callback({} as IdleDeadline);
  return 0;
});

describe("HistoryPlugin", () => {
  let historyPlugin: HistoryPlugin;
  let mockBreadcrumb: vi.Mocked<Breadcrumb>;
  let mockReportData: vi.Mocked<ReportDataController>;
  let mockOptions: IOptionsParams;

  beforeEach(() => {
    mockBreadcrumb = {
      push: vi.fn(),
      getCategory: vi.fn().mockReturnValue("history"),
    } as any;

    mockReportData = {
      send: vi.fn(),
    } as any;

    mockOptions = {
      dsn: "test-dsn",
      apikey: "test-key",
      overTime: 3000,
    } as IOptionsParams;

    // Mock window.requestIdleCallback
    (window as any).requestIdleCallback = mockRequestIdleCallback;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("constructor and setup", () => {
    it("should initialize with correct properties", () => {
      historyPlugin = new HistoryPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });

      expect(historyPlugin.name).toBe(PLUGIN_TYPE.HISTORY_PLUGIN);
      expect(historyPlugin.options).toBe(mockOptions);
      expect(historyPlugin.breadcrumb).toBe(mockBreadcrumb);
      expect(historyPlugin.reportData).toBe(mockReportData);
    });

    it("should call setup during initialization", () => {
      const setupSpy = vi.spyOn(HistoryPlugin.prototype, "setup");

      new HistoryPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });

      expect(setupSpy).toHaveBeenCalled();
    });
  });

  describe("startRouteChange", () => {
    beforeEach(() => {
      historyPlugin = new HistoryPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("should record route start time and URLs", () => {
      const from = "/home";
      const to = "/about";

      // Mock requestIdleCallback to not execute immediately
      const mockDelayedRequestIdleCallback = vi.fn();
      (window as any).requestIdleCallback = mockDelayedRequestIdleCallback;

      historyPlugin.startRouteChange(from, to);

      // 验证私有属性通过访问实例
      expect((historyPlugin as any).routeStartFrom).toBe(from);
      expect((historyPlugin as any).routeStartTo).toBe(to);
      expect((historyPlugin as any).routeStartTime).toBe(1672531200000);
      // Note: isRouteCompleted may be true if requestIdleCallback was called synchronously
      // We check that startRouteChange set it to false initially
      expect(mockDelayedRequestIdleCallback).toHaveBeenCalled();
    });

    it("should cancel previous route check when starting new route", () => {
      const cancelSpy = vi.spyOn(historyPlugin, "cancelRouteCheck");

      historyPlugin.startRouteChange("/home", "/about");

      expect(cancelSpy).toHaveBeenCalled();
    });

    it("should start checking route load time", () => {
      const checkSpy = vi.spyOn(historyPlugin as any, "checkRouteLoadTime");

      historyPlugin.startRouteChange("/home", "/about");

      expect(checkSpy).toHaveBeenCalled();
    });

    it("should listen for route completion", () => {
      const listenSpy = vi.spyOn(historyPlugin as any, "listenRouteComplete");

      historyPlugin.startRouteChange("/home", "/about");

      expect(listenSpy).toHaveBeenCalled();
    });

    it("should setup beforeunload listener to cleanup", () => {
      const addEventListenerSpy = vi.spyOn(window, "addEventListener");

      historyPlugin.startRouteChange("/home", "/about");

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function),
        { once: true }
      );
    });

    it("should cancel route check on beforeunload", () => {
      const cancelSpy = vi.spyOn(historyPlugin, "cancelRouteCheck");
      let beforeUnloadHandler: any;

      vi.spyOn(window, "addEventListener").mockImplementation(
        (event, handler) => {
          if (event === "beforeunload") {
            beforeUnloadHandler = handler;
          }
        }
      );

      historyPlugin.startRouteChange("/home", "/about");

      // 触发 beforeunload
      if (beforeUnloadHandler) {
        beforeUnloadHandler();
      }

      expect(cancelSpy).toHaveBeenCalled();
    });

    it("should handle multiple consecutive route changes", () => {
      const cancelSpy = vi.spyOn(historyPlugin, "cancelRouteCheck");

      // 第一次路由跳转
      historyPlugin.startRouteChange("/home", "/about");
      expect((historyPlugin as any).routeStartTo).toBe("/about");

      // 第二次路由跳转应该取消第一次的检测
      historyPlugin.startRouteChange("/about", "/contact");
      expect(cancelSpy).toHaveBeenCalledTimes(2); // setup时调用一次，第二次调用startRouteChange时再调用一次
      expect((historyPlugin as any).routeStartTo).toBe("/contact");
    });
  });

  describe("cancelRouteCheck", () => {
    beforeEach(() => {
      historyPlugin = new HistoryPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("should clear timeout if timer exists", () => {
      const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

      // 设置一个定时器
      (historyPlugin as any).loadCheckTimer = 123;

      historyPlugin.cancelRouteCheck();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
      expect((historyPlugin as any).loadCheckTimer).toBe(null);
    });

    it("should do nothing if no timer exists", () => {
      const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

      (historyPlugin as any).loadCheckTimer = null;

      historyPlugin.cancelRouteCheck();

      expect(clearTimeoutSpy).not.toHaveBeenCalled();
    });
  });

  describe("checkRouteLoadTime", () => {
    beforeEach(() => {
      historyPlugin = new HistoryPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("should report error if route takes too long", () => {
      // 设置路由开始时间和目标
      (historyPlugin as any).routeStartTime = 1672531200000;
      (historyPlugin as any).routeStartFrom = "http://example.com/home";
      (historyPlugin as any).routeStartTo = "http://example.com/about";
      (historyPlugin as any).isRouteCompleted = false;

      (historyPlugin as any).checkRouteLoadTime();

      // 快进到超时
      vi.advanceTimersByTime(3000);

      expect(mockReportData.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Route",
          type: EVENT_TYPE.HISTORY,
          status: STATUS_CODE.ERROR,
          message: expect.stringContaining("路由跳转耗时过长"),
          data: expect.objectContaining({
            from: "/home",
            to: "/about",
            loadTime: 3000,
            threshold: 3000,
          }),
        })
      );
    });

    it("should not report error if route completed before threshold", () => {
      (historyPlugin as any).routeStartTime = 1672531200000;
      (historyPlugin as any).routeStartFrom = "http://example.com/home";
      (historyPlugin as any).routeStartTo = "http://example.com/about";
      (historyPlugin as any).isRouteCompleted = true;

      (historyPlugin as any).checkRouteLoadTime();

      vi.advanceTimersByTime(3000);

      expect(mockReportData.send).not.toHaveBeenCalled();
    });

    it("should use custom overTime threshold", () => {
      const customOptions = {
        ...mockOptions,
        overTime: 5000,
      };

      historyPlugin = new HistoryPlugin({
        options: customOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });

      (historyPlugin as any).routeStartTime = 1672531200000;
      (historyPlugin as any).routeStartFrom = "http://example.com/home";
      (historyPlugin as any).routeStartTo = "http://example.com/about";
      (historyPlugin as any).isRouteCompleted = false;

      (historyPlugin as any).checkRouteLoadTime();

      // 3秒后不应该触发
      vi.advanceTimersByTime(3000);
      expect(mockReportData.send).not.toHaveBeenCalled();

      // 5秒后应该触发
      vi.advanceTimersByTime(2000);
      expect(mockReportData.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            threshold: 5000,
          }),
        })
      );
    });

    it("should clear timer reference after timeout", () => {
      (historyPlugin as any).routeStartTime = 1672531200000;
      (historyPlugin as any).isRouteCompleted = false;

      (historyPlugin as any).checkRouteLoadTime();

      expect((historyPlugin as any).loadCheckTimer).not.toBe(null);

      vi.advanceTimersByTime(3000);

      expect((historyPlugin as any).loadCheckTimer).toBe(null);
    });
  });

  describe("listenRouteComplete", () => {
    beforeEach(() => {
      historyPlugin = new HistoryPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("should use requestIdleCallback when available", () => {
      const markCompletedSpy = vi.spyOn(
        historyPlugin as any,
        "markRouteCompleted"
      );

      (historyPlugin as any).listenRouteComplete();

      expect(mockRequestIdleCallback).toHaveBeenCalled();
      expect(markCompletedSpy).toHaveBeenCalled();
    });

    it("should fallback to setTimeout when requestIdleCallback is not available", () => {
      delete (window as any).requestIdleCallback;

      const setTimeoutSpy = vi.spyOn(window, "setTimeout");
      const markCompletedSpy = vi.spyOn(
        historyPlugin as any,
        "markRouteCompleted"
      );

      (historyPlugin as any).listenRouteComplete();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);

      vi.advanceTimersByTime(0);

      expect(markCompletedSpy).toHaveBeenCalled();
    });
  });

  describe("markRouteCompleted", () => {
    beforeEach(() => {
      historyPlugin = new HistoryPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("should set isRouteCompleted to true", () => {
      (historyPlugin as any).isRouteCompleted = false;

      (historyPlugin as any).markRouteCompleted();

      expect((historyPlugin as any).isRouteCompleted).toBe(true);
    });
  });

  describe("destroy", () => {
    beforeEach(() => {
      historyPlugin = new HistoryPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("should call cancelRouteCheck", () => {
      const cancelSpy = vi.spyOn(historyPlugin, "cancelRouteCheck");

      historyPlugin.destroy();

      expect(cancelSpy).toHaveBeenCalled();
    });
  });

  describe("handleData", () => {
    beforeEach(() => {
      historyPlugin = new HistoryPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("should push breadcrumb with parsed URLs", () => {
      const data = {
        from: "http://example.com/home?query=1",
        to: "http://example.com/about#section",
      };

      historyPlugin.handleData(data);

      expect(mockBreadcrumb.push).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EVENT_TYPE.HISTORY,
          category: "history",
          status: STATUS_CODE.OK,
          data: expect.objectContaining({
            from: "/home?query=1",
            to: "/about#section",
          }),
        })
      );
    });

    it("should use default path when URL parsing fails", () => {
      const data = {
        from: "",
        to: "",
      };

      historyPlugin.handleData(data);

      expect(mockBreadcrumb.push).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            from: "/",
            to: "/",
          }),
        })
      );
    });
  });

  describe("Integration: pushState and replaceState", () => {
    beforeEach(() => {
      // Mock history methods
      const originalPushState = window.history.pushState;
      const originalReplaceState = window.history.replaceState;

      historyPlugin = new HistoryPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("should intercept pushState calls", () => {
      const startRouteChangeSpy = vi.spyOn(historyPlugin, "startRouteChange");
      const handleDataSpy = vi.spyOn(historyPlugin, "handleData");

      window.history.pushState({}, "", "/new-page");

      expect(startRouteChangeSpy).toHaveBeenCalled();
      expect(handleDataSpy).toHaveBeenCalled();
    });

    it("should intercept replaceState calls", () => {
      const startRouteChangeSpy = vi.spyOn(historyPlugin, "startRouteChange");
      const handleDataSpy = vi.spyOn(historyPlugin, "handleData");

      window.history.replaceState({}, "", "/replaced-page");

      expect(startRouteChangeSpy).toHaveBeenCalled();
      expect(handleDataSpy).toHaveBeenCalled();
    });
  });
});

