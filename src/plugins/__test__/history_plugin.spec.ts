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

// 捕获 requestIdleCallback 回调，由测试手动在指定时刻触发（模拟路由真实完成时机）
function deferIdleCallbacks(): Array<IdleRequestCallback> {
  const callbacks: Array<IdleRequestCallback> = [];
  window.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
    callbacks.push(callback);
    return 0;
  });
  return callbacks;
}

function runIdleCallback(callbacks: Array<IdleRequestCallback>, index = 0) {
  callbacks[index]({ didTimeout: false, timeRemaining: () => 50 });
}

// happy-dom 下模拟页面切入后台；用完必须 restoreDocumentVisibility 恢复
function setDocumentHidden() {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
}

function restoreDocumentVisibility() {
  Reflect.deleteProperty(document, "visibilityState");
}

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
    restoreDocumentVisibility();
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

    it("cancels a pending slow-route silently on beforeunload (no report at hard cap or late completion)", () => {
      const idleCallbacks = deferIdleCallbacks();

      historyPlugin.startRouteChange("/home", "/about");
      vi.advanceTimersByTime(3000); // 超阈值，进入 pending

      window.dispatchEvent(new Event("beforeunload"));

      // 页面卸载后不再兜底上报：硬上限时刻与迟到的完成回调都不产生上报
      vi.advanceTimersByTime(40000);
      runIdleCallback(idleCallbacks);

      expect(mockReportData.send).not.toHaveBeenCalled();
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

    it("does not report at threshold; reports real loadTime once when the route completes late", () => {
      const idleCallbacks = deferIdleCallbacks();

      historyPlugin.startRouteChange(
        "http://example.com/home",
        "http://example.com/about"
      );

      // 阈值(3000ms)到点：不再立刻上报（旧语义会在这里报出恒等于阈值的 loadTime）
      vi.advanceTimersByTime(3000);
      expect(mockReportData.send).not.toHaveBeenCalled();

      // 真实完成于 7000ms → 上报真实耗时
      vi.advanceTimersByTime(4000);
      runIdleCallback(idleCallbacks);

      expect(mockReportData.send).toHaveBeenCalledTimes(1);
      expect(mockReportData.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Route",
          type: EVENT_TYPE.HISTORY,
          status: STATUS_CODE.ERROR,
          message: "路由跳转耗时过长: 7000ms，超过阈值 3000ms",
          data: expect.objectContaining({
            from: "/home",
            to: "/about",
            loadTime: 7000,
            threshold: 3000,
            completed: true,
          }),
        })
      );

      // 单次上报：重复完成回调与硬上限时刻都不会触发第二次 send
      runIdleCallback(idleCallbacks);
      vi.advanceTimersByTime(40000);
      expect(mockReportData.send).toHaveBeenCalledTimes(1);
    });

    it("does not report when the route completes before the threshold", () => {
      const idleCallbacks = deferIdleCallbacks();

      historyPlugin.startRouteChange(
        "http://example.com/home",
        "http://example.com/about"
      );

      // 1000ms 即完成 → 阈值定时器与硬上限都不应产生上报
      vi.advanceTimersByTime(1000);
      runIdleCallback(idleCallbacks);
      vi.advanceTimersByTime(40000);

      expect(mockReportData.send).not.toHaveBeenCalled();
    });

    it("uses the custom overTime threshold to decide what counts as slow", () => {
      const idleCallbacks = deferIdleCallbacks();
      historyPlugin = new HistoryPlugin({
        options: { ...mockOptions, overTime: 5000 },
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });

      // 完成于 4000ms：超过 3000 但未超自定义阈值 5000 → 不上报
      historyPlugin.startRouteChange(
        "http://example.com/home",
        "http://example.com/about"
      );
      vi.advanceTimersByTime(4000);
      runIdleCallback(idleCallbacks, 0);
      expect(mockReportData.send).not.toHaveBeenCalled();

      // 第二次导航完成于 8000ms（超过 5000 阈值）→ 上报真实耗时与自定义阈值
      historyPlugin.startRouteChange(
        "http://example.com/about",
        "http://example.com/contact"
      );
      vi.advanceTimersByTime(5000);
      expect(mockReportData.send).not.toHaveBeenCalled(); // 阈值到点依旧不报
      vi.advanceTimersByTime(3000);
      runIdleCallback(idleCallbacks, 1);

      expect(mockReportData.send).toHaveBeenCalledTimes(1);
      expect(mockReportData.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "路由跳转耗时过长: 8000ms，超过阈值 5000ms",
          data: expect.objectContaining({
            from: "/about",
            to: "/contact",
            loadTime: 8000,
            threshold: 5000,
            completed: true,
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

  describe("slow route detection contracts", () => {
    beforeEach(() => {
      historyPlugin = new HistoryPlugin({
        options: mockOptions,
        breadcrumb: mockBreadcrumb,
        reportData: mockReportData,
      });
    });

    it("skips detection entirely for a same-address navigation (path+query+hash equal)", () => {
      deferIdleCallbacks();

      // 绝对/相对形式混用也要识别为同地址（相对地址以 location 为基准解析）
      historyPlugin.startRouteChange("http://example.com/page?a=1", "/page?a=1");

      // 阈值与硬上限全程推进也不产生任何上报
      vi.advanceTimersByTime(40000);
      expect(mockReportData.send).not.toHaveBeenCalled();
    });

    it("keeps an in-flight pending detection alive across a same-address replaceState", () => {
      const idleCallbacks = deferIdleCallbacks();

      historyPlugin.startRouteChange("/home", "/about");
      vi.advanceTimersByTime(4000); // 阈值 3000 已过，pending 中

      // 慢加载途中原地同步 query（同地址）→ 不打断检测，也不触发放弃上报
      historyPlugin.startRouteChange("/about?step=1", "/about?step=1");
      expect(mockReportData.send).not.toHaveBeenCalled();

      // 原导航真实完成于 6000ms → 正常上报真实耗时
      vi.advanceTimersByTime(2000);
      runIdleCallback(idleCallbacks);

      expect(mockReportData.send).toHaveBeenCalledTimes(1);
      expect(mockReportData.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "路由跳转耗时过长: 6000ms，超过阈值 3000ms",
          data: expect.objectContaining({
            from: "/home",
            to: "/about",
            loadTime: 6000,
            completed: true,
          }),
        })
      );
    });

    it("does not start detection when the page is hidden at navigation start", () => {
      deferIdleCallbacks();
      setDocumentHidden();

      historyPlugin.startRouteChange("/home", "/about");
      restoreDocumentVisibility();

      // 若检测被错误启动，30s 硬上限会兜底上报
      vi.advanceTimersByTime(40000);
      expect(mockReportData.send).not.toHaveBeenCalled();
    });

    it("abandons detection when the tab is hidden at the moment the threshold fires", () => {
      deferIdleCallbacks();

      historyPlugin.startRouteChange("/home", "/about");
      vi.advanceTimersByTime(1000);
      setDocumentHidden(); // 不派发事件：只覆盖阈值定时器到点时的检查

      vi.advanceTimersByTime(2000); // 阈值到点，此刻 hidden → 放弃，不进入 pending
      restoreDocumentVisibility();

      vi.advanceTimersByTime(40000); // 硬上限也不应被安排
      expect(mockReportData.send).not.toHaveBeenCalled();
    });

    it("falls back to an incomplete report at the 30s hard cap when the route never finishes", () => {
      const idleCallbacks = deferIdleCallbacks();

      historyPlugin.startRouteChange("/home", "/about");

      vi.advanceTimersByTime(29999);
      expect(mockReportData.send).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1); // 从路由开始算起第 30000ms：硬上限兜底
      expect(mockReportData.send).toHaveBeenCalledTimes(1);
      expect(mockReportData.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Route",
          status: STATUS_CODE.ERROR,
          message: "路由跳转耗时过长: 30000ms，超过阈值 3000ms（未等到渲染完成）",
          data: expect.objectContaining({
            from: "/home",
            to: "/about",
            loadTime: 30000,
            threshold: 3000,
            completed: false,
          }),
        })
      );

      // 兜底后迟到的完成回调不会再补一发
      runIdleCallback(idleCallbacks);
      expect(mockReportData.send).toHaveBeenCalledTimes(1);
    });

    it("reports the abandoned pending route with its real wait time when a new navigation starts", () => {
      const idleCallbacks = deferIdleCallbacks();

      historyPlugin.startRouteChange("/home", "/about");
      vi.advanceTimersByTime(5000); // 阈值 3000 已过，pending 中

      historyPlugin.startRouteChange("/about", "/contact");

      expect(mockReportData.send).toHaveBeenCalledTimes(1);
      expect(mockReportData.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "路由跳转耗时过长: 5000ms，超过阈值 3000ms（未等到渲染完成）",
          data: expect.objectContaining({
            from: "/home",
            to: "/about",
            loadTime: 5000,
            completed: false,
          }),
        })
      );

      // 新导航的检测独立进行：超阈值后完成于 4500ms → 第二次上报 completed:true
      vi.advanceTimersByTime(4500);
      runIdleCallback(idleCallbacks, 1);

      expect(mockReportData.send).toHaveBeenCalledTimes(2);
      expect(mockReportData.send).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            from: "/about",
            to: "/contact",
            loadTime: 4500,
            completed: true,
          }),
        })
      );
    });

    it("reports completed:false and cancels detection when the tab goes hidden while pending", () => {
      const idleCallbacks = deferIdleCallbacks();

      historyPlugin.startRouteChange("/home", "/about");
      vi.advanceTimersByTime(4500); // pending 中，前台已等待 4500ms

      setDocumentHidden();
      document.dispatchEvent(new Event("visibilitychange"));

      expect(mockReportData.send).toHaveBeenCalledTimes(1);
      expect(mockReportData.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "路由跳转耗时过长: 4500ms，超过阈值 3000ms（未等到渲染完成）",
          data: expect.objectContaining({
            loadTime: 4500,
            completed: false,
          }),
        })
      );

      restoreDocumentVisibility();

      // 检测已取消：硬上限与迟到完成回调都不再上报
      vi.advanceTimersByTime(40000);
      runIdleCallback(idleCallbacks);
      expect(mockReportData.send).toHaveBeenCalledTimes(1);
    });

    it("ignores a late completion callback from a previous navigation (generation guard)", () => {
      const idleCallbacks = deferIdleCallbacks();

      historyPlugin.startRouteChange("/home", "/about"); // 导航 A
      vi.advanceTimersByTime(1000);
      historyPlugin.startRouteChange("/about", "/contact"); // 导航 B（A 未超阈值，无放弃上报）

      // A 的迟到完成回调：不能把 B 标记为已完成
      runIdleCallback(idleCallbacks, 0);

      // B 于 6000ms 真实完成（已超阈值）→ 必须正常上报
      vi.advanceTimersByTime(6000);
      runIdleCallback(idleCallbacks, 1);

      expect(mockReportData.send).toHaveBeenCalledTimes(1);
      expect(mockReportData.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            from: "/about",
            to: "/contact",
            loadTime: 6000,
            completed: true,
          }),
        })
      );
    });

    it("markRouteCompleted() without a generation applies to the current navigation", () => {
      deferIdleCallbacks();

      historyPlugin.startRouteChange("/home", "/about");
      vi.advanceTimersByTime(4000); // pending 中

      historyPlugin.markRouteCompleted();

      expect(mockReportData.send).toHaveBeenCalledTimes(1);
      expect(mockReportData.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            loadTime: 4000,
            completed: true,
          }),
        })
      );
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

    it("does not push a breadcrumb for a same-address navigation", () => {
      historyPlugin.handleData({
        from: "http://example.com/page?tab=1",
        to: "http://example.com/page?tab=1",
      });

      expect(mockBreadcrumb.push).not.toHaveBeenCalled();
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

