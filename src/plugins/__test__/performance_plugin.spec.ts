import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { Breadcrumb } from "../../core/breadcrumb";
import { EVENT_TYPE, STATUS_CODE } from "../../core/constant";
import { ReportDataController } from "../../core/report";
import { SessionManager } from "../../core/session-manager";
import type { ReportData } from "../../core/typing";
import { IOptionsParams } from "../../typings/options";
import {
  MEMORY_ANOMALY_EVENT_NAME,
  MEMORY_DIAGNOSTIC_SNAPSHOT_EVENT_NAME,
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
const recoveredReportListeners = new Set<(data: ReportData) => void>();

function emitRecoveredReport(
  name = MEMORY_ANOMALY_EVENT_NAME,
  sessionID = SessionManager.getSessionId()
): void {
  const data = { name, sessionID } as ReportData;
  recoveredReportListeners.forEach((listener) => listener(data));
}

function createPlugin(
  send: Mock,
  saveDiagnosticSnapshot = vi.fn().mockResolvedValue(undefined),
  overrides: Partial<IOptionsParams> = {},
  breadcrumb = new Breadcrumb()
): PerformancePlugin {
  const options: IOptionsParams = {
    dsn: "https://collector.example.com/collect",
    ...overrides,
    memoryMonitor: {
      enabled: true,
      sampleIntervalMs: 30_000,
      sampleWindowSize: 3,
      minUsedJSHeapSize: 500,
      minGrowthBytes: 100,
      minGrowthRatio: 1.5,
      ...overrides.memoryMonitor,
    },
  };
  const reportData = {
    send,
    saveDiagnosticSnapshot,
    clearDiagnosticSnapshot: vi.fn().mockResolvedValue(undefined),
    onRecoveredReport: vi.fn((listener: (data: ReportData) => void) => {
      recoveredReportListeners.add(listener);
      return () => { recoveredReportListeners.delete(listener); };
    }),
  } as unknown as ReportDataController;
  return new PerformancePlugin({
    options,
    breadcrumb,
    reportData,
  });
}

describe("PerformancePlugin extreme memory monitoring", () => {
  let usedJSHeapSize = 100;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    sessionStorage.clear();
    recoveredReportListeners.clear();
    usedJSHeapSize = 100;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
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

  it("deduplicates only after acknowledgement while continuing snapshots", async () => {
    let acknowledge!: (success: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      acknowledge = resolve;
    });
    const send = vi.fn().mockReturnValue(promise);
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const plugin = createPlugin(send, saveSnapshot);

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
    expect(sessionStorage.getItem(MEMORY_REPORT_SESSION_KEY)).toBeNull();
    usedJSHeapSize = 900;
    vi.advanceTimersByTime(30_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(saveSnapshot).toHaveBeenCalledTimes(4);
    expect(plugin.reportData.clearDiagnosticSnapshot).not.toHaveBeenCalled();

    acknowledge(true);
    await vi.waitFor(() => {
      expect(sessionStorage.getItem(MEMORY_REPORT_SESSION_KEY)).toBe("1");
    });

    const secondSend = vi.fn().mockResolvedValue(true);
    const secondSnapshot = vi.fn().mockResolvedValue(undefined);
    const secondPlugin = createPlugin(secondSend, secondSnapshot);
    usedJSHeapSize = 1_200;
    vi.advanceTimersByTime(5 * 60_000);
    expect(secondSend).not.toHaveBeenCalled();
    expect(secondSnapshot).toHaveBeenCalledTimes(11);
    expect(saveSnapshot).toHaveBeenCalledTimes(14);

    plugin.destroy();
    secondPlugin.destroy();
  });

  it("does not report a high transient spike that falls back within the window", () => {
    const send = vi.fn().mockResolvedValue(true);
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
    const send = vi.fn().mockResolvedValue(true);
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
    const send = vi.fn().mockResolvedValue(true);
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

  it.each(["unconfirmed", "rejected"])(
    "keeps %s anomalies unmarked without retrying every sample, and permits a new instance",
    async (outcome) => {
      const send = outcome === "rejected"
        ? vi.fn().mockRejectedValue(new Error("offline"))
        : vi.fn().mockResolvedValue(false);
      const saveSnapshot = vi.fn().mockResolvedValue(undefined);
      const plugin = createPlugin(send, saveSnapshot);
      usedJSHeapSize = 300;
      await vi.advanceTimersByTimeAsync(30_000);
      usedJSHeapSize = 600;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(sessionStorage.getItem(MEMORY_REPORT_SESSION_KEY)).toBeNull();

      usedJSHeapSize = 1_200;
      await vi.advanceTimersByTimeAsync(90_000);
      expect(send).toHaveBeenCalledTimes(1);
      expect(saveSnapshot).toHaveBeenCalledTimes(6);
      plugin.destroy();
      expect(plugin.reportData.clearDiagnosticSnapshot).not.toHaveBeenCalled();

      usedJSHeapSize = 100;
      const secondSend = vi.fn().mockResolvedValue(true);
      const secondPlugin = createPlugin(secondSend);
      usedJSHeapSize = 300;
      await vi.advanceTimersByTimeAsync(30_000);
      usedJSHeapSize = 600;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(secondSend).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(MEMORY_REPORT_SESSION_KEY)).toBe("1");
      secondPlugin.destroy();
    }
  );

  it("retains the latest bounded low-memory window without calling it a crash", () => {
    const send = vi.fn().mockResolvedValue(true);
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const collectContext = vi.fn(() => ({ activeEditors: 2 }));
    const plugin = createPlugin(send, saveSnapshot, {
      memoryMonitor: { collectContext },
    });
    const startedAt = Date.now();
    expect(saveSnapshot).toHaveBeenCalledTimes(1);
    const firstSnapshot = saveSnapshot.mock.calls[0][0];
    expect(firstSnapshot.data.samples).toEqual([
      expect.objectContaining({ usedJSHeapSize: 100, time: startedAt }),
    ]);
    for (const value of [110, 120, 130, 140]) {
      usedJSHeapSize = value;
      vi.advanceTimersByTime(30_000);
    }
    expect(send).not.toHaveBeenCalled();
    expect(saveSnapshot).toHaveBeenCalledTimes(5);
    expect(collectContext).toHaveBeenCalledTimes(5);
    const lastSnapshot = saveSnapshot.mock.calls[4][0];
    expect(lastSnapshot).toEqual(expect.objectContaining({
      name: MEMORY_DIAGNOSTIC_SNAPSHOT_EVENT_NAME,
      type: EVENT_TYPE.PERFORMANCE,
      status: STATUS_CODE.OK,
      time: startedAt + 120_000,
      message: expect.stringContaining("不证明"),
    }));
    expect(lastSnapshot.data.samples.map(
      (sample: { usedJSHeapSize: number }) => sample.usedJSHeapSize
    )).toEqual([120, 130, 140]);
    expect(firstSnapshot.data.samples).toHaveLength(1);
    expect(lastSnapshot.data.diagnostics.application).toEqual({ activeEditors: 2 });
    plugin.destroy();
  });

  it("bounds recent activity and reuses context collection on an anomaly tick", () => {
    const breadcrumb = new Breadcrumb(100);
    for (let index = 0; index < 40; index += 1) {
      breadcrumb.push({
        type: EVENT_TYPE.FETCH,
        category: breadcrumb.getCategory(EVENT_TYPE.FETCH),
        status: STATUS_CODE.OK,
        time: index,
        data: {
          url: `https://example.com/items/${index}?token=secret#private`,
          elapsedTime: index,
          response: "not included in diagnostics",
        },
      });
    }
    const collectContext = vi.fn(() => ({ pendingJobs: 1 }));
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(true);
    const plugin = createPlugin(send, saveSnapshot, {
      memoryMonitor: { collectContext },
    }, breadcrumb);
    usedJSHeapSize = 300;
    vi.advanceTimersByTime(30_000);
    usedJSHeapSize = 600;
    vi.advanceTimersByTime(30_000);
    expect(collectContext).toHaveBeenCalledTimes(3);
    const activity = saveSnapshot.mock.calls[2][0].data.diagnostics.recentActivity;
    expect(activity).toHaveLength(20);
    expect(activity[0].request).toEqual({
      url: "https://example.com/items/20",
      elapsedTime: 20,
    });
    expect(activity[19].request.url).toBe("https://example.com/items/39");
    expect(send).toHaveBeenCalledTimes(1);
    plugin.destroy();
  });

  it("continues sampling after snapshot persistence and application context failures", async () => {
    const send = vi.fn().mockResolvedValue(false);
    const saveSnapshot = vi.fn()
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValue(undefined);
    const collectContext = vi.fn(() => {
      throw new Error("application context unavailable");
    });
    const plugin = createPlugin(send, saveSnapshot, {
      memoryMonitor: { collectContext },
    });
    usedJSHeapSize = 300;
    await vi.advanceTimersByTimeAsync(30_000);
    usedJSHeapSize = 600;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(saveSnapshot).toHaveBeenCalledTimes(3);
    expect(saveSnapshot.mock.calls[2][0].data.diagnostics.application).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    plugin.destroy();
  });

  it("does not restart sampling or clear evidence when pending promises settle after destroy", async () => {
    let acknowledge!: (success: boolean) => void;
    let finishSnapshot!: () => void;
    const promise = new Promise<boolean>((resolve) => {
      acknowledge = resolve;
    });
    const pendingSnapshot = new Promise<void>((resolve) => {
      finishSnapshot = resolve;
    });
    const send = vi.fn().mockReturnValue(promise);
    const saveSnapshot = vi.fn().mockReturnValue(pendingSnapshot);
    const plugin = createPlugin(send, saveSnapshot);
    usedJSHeapSize = 300;
    vi.advanceTimersByTime(30_000);
    usedJSHeapSize = 600;
    vi.advanceTimersByTime(30_000);
    plugin.destroy();
    expect(sessionStorage.getItem(MEMORY_REPORT_SESSION_KEY)).toBeNull();
    expect(plugin.reportData.clearDiagnosticSnapshot).not.toHaveBeenCalled();
    acknowledge(true);
    finishSnapshot();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(sessionStorage.getItem(MEMORY_REPORT_SESSION_KEY)).toBe("1");
    expect(saveSnapshot).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("enforces the minimum snapshot interval and maximum sample window", () => {
    const send = vi.fn().mockResolvedValue(true);
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const plugin = createPlugin(send, saveSnapshot, {
      memoryMonitor: { sampleIntervalMs: 1, sampleWindowSize: 100 },
    });
    vi.advanceTimersByTime(29_999);
    expect(saveSnapshot).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1 + 12 * 30_000);
    expect(saveSnapshot).toHaveBeenCalledTimes(14);
    expect(saveSnapshot.mock.calls[13][0].data.samples).toHaveLength(12);
    plugin.destroy();
  });

  it("does not collect periodic diagnostics when recovery is disabled", () => {
    const send = vi.fn().mockResolvedValue(true);
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const collectContext = vi.fn(() => ({}));
    const plugin = createPlugin(send, saveSnapshot, {
      recovery: { enabled: false },
      memoryMonitor: { collectContext },
    });
    vi.advanceTimersByTime(30_000);
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(collectContext).not.toHaveBeenCalled();
    usedJSHeapSize = 300;
    vi.advanceTimersByTime(30_000);
    usedJSHeapSize = 600;
    vi.advanceTimersByTime(30_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(collectContext).toHaveBeenCalledTimes(1);
    plugin.destroy();
  });

  it("suppresses a growing window after same-session recovery confirmation but keeps snapshots", () => {
    const send = vi.fn().mockResolvedValue(false);
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const plugin = createPlugin(send, saveSnapshot);
    usedJSHeapSize = 300;
    vi.advanceTimersByTime(30_000);
    expect(sessionStorage.getItem(MEMORY_REPORT_SESSION_KEY)).toBeNull();

    emitRecoveredReport();
    expect(sessionStorage.getItem(MEMORY_REPORT_SESSION_KEY)).toBe("1");
    usedJSHeapSize = 600;
    vi.advanceTimersByTime(30_000);
    usedJSHeapSize = 1_200;
    vi.advanceTimersByTime(30_000);
    expect(send).not.toHaveBeenCalled();
    expect(saveSnapshot).toHaveBeenCalledTimes(4);
    expect(saveSnapshot.mock.calls[3][0].data.samples.map(
      (sample: { usedJSHeapSize: number }) => sample.usedJSHeapSize
    )).toEqual([300, 600, 1_200]);
    plugin.destroy();

    usedJSHeapSize = 100;
    const nextSend = vi.fn().mockResolvedValue(false);
    const nextPlugin = createPlugin(nextSend);
    usedJSHeapSize = 300;
    vi.advanceTimersByTime(30_000);
    usedJSHeapSize = 600;
    vi.advanceTimersByTime(30_000);
    expect(nextSend).not.toHaveBeenCalled();
    nextPlugin.destroy();
  });

  it.each(["another-session", "another-event"])(
    "does not suppress a growing window for recovery from %s",
    (source) => {
      const send = vi.fn().mockResolvedValue(false);
      const plugin = createPlugin(send);
      usedJSHeapSize = 300;
      vi.advanceTimersByTime(30_000);
      emitRecoveredReport(
        source === "another-event"
          ? MEMORY_DIAGNOSTIC_SNAPSHOT_EVENT_NAME
          : MEMORY_ANOMALY_EVENT_NAME,
        source === "another-session"
          ? `${SessionManager.getSessionId()}-other`
          : SessionManager.getSessionId()
      );
      expect(sessionStorage.getItem(MEMORY_REPORT_SESSION_KEY)).toBeNull();
      usedJSHeapSize = 600;
      vi.advanceTimersByTime(30_000);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0].data.trend.windowDurationMs).toBe(60_000);
      plugin.destroy();
    }
  );

  it("unsubscribes destroyed instances from recovery confirmations", () => {
    const plugin = createPlugin(vi.fn().mockResolvedValue(false));
    plugin.destroy();
    emitRecoveredReport();
    expect(sessionStorage.getItem(MEMORY_REPORT_SESSION_KEY)).toBeNull();

    const send = vi.fn().mockResolvedValue(false);
    const nextPlugin = createPlugin(send);
    usedJSHeapSize = 300;
    vi.advanceTimersByTime(30_000);
    usedJSHeapSize = 600;
    vi.advanceTimersByTime(30_000);
    expect(send).toHaveBeenCalledTimes(1);
    nextPlugin.destroy();
  });
});
