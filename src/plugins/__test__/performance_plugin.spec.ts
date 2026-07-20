import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Breadcrumb } from "../../core/breadcrumb";
import { ReportDataController } from "../../core/report";
import { IOptionsParams } from "../../typings/options";
import {
  MEMORY_ANOMALY_EVENT_NAME,
  PerformancePlugin,
} from "../performance_plugin";

vi.mock("web-vitals", () => ({
  onCLS: vi.fn(),
  onFCP: vi.fn(),
  onFID: vi.fn(),
  onLCP: vi.fn(),
  onTTFB: vi.fn(),
}));

const MEMORY_REPORT_SESSION_KEY = "tc_tracker_memory_anomaly_reported";

function createPlugin(send: ReturnType<typeof vi.fn>): PerformancePlugin {
  const options: IOptionsParams = {
    dsn: "https://collector.example.com/collect",
    memoryMonitor: {
      enabled: true,
      sampleIntervalMs: 30_000,
      sampleWindowSize: 3,
      minUsedJSHeapSize: 500,
      minGrowthBytes: 100,
      minGrowthRatio: 1.5,
    },
  };
  // The controller is deliberately reduced to the only boundary this plugin uses.
  const reportData = { send } as unknown as ReportDataController;
  return new PerformancePlugin({
    options,
    breadcrumb: new Breadcrumb(),
    reportData,
  });
}

describe("PerformancePlugin extreme memory monitoring", () => {
  let usedJSHeapSize = 100;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    sessionStorage.clear();
    usedJSHeapSize = 100;
    Object.defineProperty(window.performance, "memory", {
      configurable: true,
      get: () => ({
        jsHeapSizeLimit: 2_000,
        totalJSHeapSize: usedJSHeapSize + 50,
        usedJSHeapSize,
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports one sustained extreme increase and suppresses the rest of the tab session", () => {
    const send = vi.fn();
    const plugin = createPlugin(send);

    usedJSHeapSize = 300;
    vi.advanceTimersByTime(30_000);
    usedJSHeapSize = 600;
    vi.advanceTimersByTime(30_000);

    const anomalyCalls = send.mock.calls.filter(
      ([event]) => event.name === MEMORY_ANOMALY_EVENT_NAME
    );
    expect(anomalyCalls).toHaveLength(1);
    expect(anomalyCalls[0][0]).toEqual(
      expect.objectContaining({
        name: MEMORY_ANOMALY_EVENT_NAME,
        data: expect.objectContaining({
          trend: expect.objectContaining({
            growthBytes: 200,
            samples: expect.arrayContaining([
              expect.objectContaining({ usedJSHeapSize: 100 }),
              expect.objectContaining({ usedJSHeapSize: 300 }),
              expect.objectContaining({ usedJSHeapSize: 600 }),
            ]),
          }),
        }),
      })
    );
    expect(sessionStorage.getItem(MEMORY_REPORT_SESSION_KEY)).toBe("1");

    const secondSend = vi.fn();
    const secondPlugin = createPlugin(secondSend);
    usedJSHeapSize = 1_200;
    vi.advanceTimersByTime(5 * 60_000);
    expect(secondSend).not.toHaveBeenCalled();

    plugin.destroy();
    secondPlugin.destroy();
  });

  it("does not report a high transient spike that falls back within the window", () => {
    const send = vi.fn();
    const plugin = createPlugin(send);

    usedJSHeapSize = 700;
    vi.advanceTimersByTime(30_000);
    usedJSHeapSize = 150;
    vi.advanceTimersByTime(30_000);

    expect(
      send.mock.calls.some(
        ([event]) => event.name === MEMORY_ANOMALY_EVENT_NAME
      )
    ).toBe(false);

    plugin.destroy();
  });

  // 采样链一旦断掉是静默的：不会报错、也不会有事件，
  // 外部只会看到「没有内存问题」，因此必须有回归测试盯住
  it("keeps sampling after a single unreadable memory reading", () => {
    const send = vi.fn();
    const plugin = createPlugin(send);

    // 第 2 次采样时读数不可用（usedJSHeapSize 取到 0）
    usedJSHeapSize = 0;
    vi.advanceTimersByTime(30_000);

    // 恢复后制造明确的持续暴涨
    usedJSHeapSize = 300;
    vi.advanceTimersByTime(30_000);
    usedJSHeapSize = 900;
    vi.advanceTimersByTime(30_000);
    usedJSHeapSize = 1_500;
    vi.advanceTimersByTime(30_000);

    expect(
      send.mock.calls.filter(
        ([event]) => event.name === MEMORY_ANOMALY_EVENT_NAME
      )
    ).toHaveLength(1);

    plugin.destroy();
  });

  it("restarts the window after a sampling gap instead of reporting across it", () => {
    const send = vi.fn();
    let hidden = false;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    const plugin = createPlugin(send);

    // 切后台 3 小时，期间不采样；回到前台后仅有两个新采样点
    hidden = true;
    vi.advanceTimersByTime(3 * 60 * 60_000);
    hidden = false;

    usedJSHeapSize = 300;
    vi.advanceTimersByTime(30_000);
    usedJSHeapSize = 900;
    vi.advanceTimersByTime(30_000);

    // 跨 3 小时断层的比较不构成「持续增长」，不得上报
    expect(
      send.mock.calls.some(
        ([event]) => event.name === MEMORY_ANOMALY_EVENT_NAME
      )
    ).toBe(false);

    // 断层之后窗口重新累积，真实的持续增长依然能报出来
    usedJSHeapSize = 1_500;
    vi.advanceTimersByTime(30_000);
    const anomalies = send.mock.calls.filter(
      ([event]) => event.name === MEMORY_ANOMALY_EVENT_NAME
    );
    expect(anomalies).toHaveLength(1);
    // 窗口跨度必须是断层之后的连续观测，而不是那 3 小时
    expect(anomalies[0][0].data.trend.windowDurationMs).toBeLessThanOrEqual(
      60_000
    );

    hidden = false;
    plugin.destroy();
  });
});
