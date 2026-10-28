import { onCLS, onFCP, onFID, onLCP, onTTFB } from "web-vitals";
import { Breadcrumb } from "../core/breadcrumb";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE } from "../core/constant";
import { _global } from "../core/global";
import { ReportDataController } from "../core/report";
import { SessionManager } from "../core/session-manager";
import { Callback } from "../core/typing";
import { IOptionsParams } from "../typings/options";
import { addEventListenerTo, getTimestamp } from "../utils";
import { IPluginParams } from "./common";

const MEBIBYTE = 1024 * 1024;
const DEFAULT_MEMORY_SAMPLE_INTERVAL_MS = 60_000;
const MIN_MEMORY_SAMPLE_INTERVAL_MS = 30_000;
const DEFAULT_MEMORY_SAMPLE_WINDOW_SIZE = 6;
const MIN_MEMORY_SAMPLE_WINDOW_SIZE = 3;
const MAX_MEMORY_SAMPLE_WINDOW_SIZE = 12;
const DEFAULT_MIN_USED_JS_HEAP_SIZE = 512 * MEBIBYTE;
const DEFAULT_MIN_GROWTH_BYTES = 256 * MEBIBYTE;
const DEFAULT_MIN_GROWTH_RATIO = 1.5;
const MAX_RECENT_LONG_TASKS = 5;
const MAX_RECENT_ACTIVITY = 20;
// 相邻采样点允许的最大间隔倍率。超过即视为采样断层（标签页切后台/被冻结、
// 定时器节流、设备休眠），此时窗口不再是一段连续观测：跨断层比较会把
// 「几小时前的那个点」当成基线，把一次跨时段的对比误判成「持续增长」
const MEMORY_SAMPLE_GAP_TOLERANCE = 2;
const MEMORY_REPORT_SESSION_KEY = "tc_tracker_memory_anomaly_reported";

export const MEMORY_ANOMALY_EVENT_NAME = "memoryAnomaly";
export const MEMORY_DIAGNOSTIC_SNAPSHOT_EVENT_NAME = "memoryDiagnosticSnapshot";

interface BrowserMemory {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

interface MemorySample extends BrowserMemory {
  time: number;
}

interface MemoryMonitorConfig {
  sampleIntervalMs: number;
  sampleWindowSize: number;
  minUsedJSHeapSize: number;
  minGrowthBytes: number;
  minGrowthRatio: number;
  collectContext?: () => Record<string, unknown> | null;
}

interface MemoryTrend {
  baselineUsedJSHeapSize: number;
  currentUsedJSHeapSize: number;
  recentFloorUsedJSHeapSize: number;
  growthBytes: number;
  growthRatio: number;
  growthPerMinute: number;
  windowDurationMs: number;
}

interface DomDiagnostics {
  nodeCount: number;
  imageCount: number;
  videoCount: number;
  canvasCount: number;
  iframeCount: number;
}

interface LongTaskSample {
  startTime: number;
  duration: number;
  name: string;
}

interface RecentActivity {
  type: EVENT_TYPE;
  status: STATUS_CODE;
  time: number;
  route?: {
    from?: unknown;
    to?: unknown;
  };
  request?: {
    url?: string;
    elapsedTime?: unknown;
  };
  target?: {
    tagName?: unknown;
    id?: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class PerformancePlugin implements IPluginParams {
  name = PLUGIN_TYPE.PERFORMANCE_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  private loadHandler: (() => void) | null = null;
  private unsubscribeRecoveredReports: (() => void) | null = null;
  private memoryConfig: MemoryMonitorConfig | null = null;
  private memoryTimer: number | null = null;
  private memorySamples: Array<MemorySample> = [];
  // One attempt per instance; only an acknowledged send persists the session marker.
  private memoryReported = false;
  private sessionStartedAt = getTimestamp();
  private initialDomDiagnostics: DomDiagnostics | null = null;
  private longTaskObserver: PerformanceObserver | null = null;
  private longTaskCount = 0;
  private longTaskTotalDuration = 0;
  private longTaskMaxDuration = 0;
  private recentLongTasks: Array<LongTaskSample> = [];
  private isSetup = false;

  constructor(params: IPluginParams) {
    const { options, breadcrumb, reportData } = params;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.setup();
  }

  setup() {
    // 与 History/Request 插件一致：重复 setup 不得叠加监听器与采样定时器链
    if (this.isSetup) return;
    this.isSetup = true;
    this.unsubscribeRecoveredReports = this.reportData.onRecoveredReport((data) => {
      if (!this.isSetup || data.name !== MEMORY_ANOMALY_EVENT_NAME) return;
      try {
        if (data.sessionID !== SessionManager.getSessionId()) return;
        this.memoryReported = true;
        this.persistMemoryReportMarker();
      } catch {
        // Unavailable session storage must not interrupt recovery or sampling.
      }
    });
    this.getSourceData();
    this.getPerformanceData();
    this.startMemoryMonitoring();
  }

  getPerformanceData() {
    getWebVitals((res: unknown) => {
      if (!isRecord(res) || typeof res.name !== "string") {
        return;
      }
      this.reportData.send({
        type: EVENT_TYPE.PERFORMANCE,
        status: STATUS_CODE.OK,
        time: getTimestamp(),
        data: res,
        name: res.name,
      });
    });
  }

  getSourceData() {
    const performance = _global.performance;
    this.loadHandler = () => {
      // 上报资源列表
      this.reportData.send({
        type: EVENT_TYPE.PERFORMANCE,
        name: "resourceList",
        status: STATUS_CODE.OK,
        data: {
          resourceList: getResource(),
        },
        time: getTimestamp(),
      });
      const memory = (performance as Performance & { memory?: BrowserMemory })
        .memory;
      // 无条件上报 load 时的内存基线，与 memoryMonitor 是否启用无关：
      // 每次页面加载仅一条、体积极小，不构成上报压力；而开关的语义是
      // 「增加异常检测」而非「移除基线指标」—— 关掉它会让接入方开启监控后
      // 看板曲线无声中断，且异常事件里的数字也失去了可对照的基线
      if (memory) {
        this.reportData.send({
          type: EVENT_TYPE.PERFORMANCE,
          name: "memory",
          time: getTimestamp(),
          data: {
            memory: {
              jsHeapSizeLimit: memory.jsHeapSizeLimit,
              totalJSHeapSize: memory.totalJSHeapSize,
              usedJSHeapSize: memory.usedJSHeapSize,
            },
          },
          status: STATUS_CODE.OK,
        });
      }
    };
    addEventListenerTo(_global, "load", this.loadHandler);
  }

  private startMemoryMonitoring(): void {
    this.memoryConfig = this.createMemoryConfig();
    if (!this.memoryConfig) {
      return;
    }
    this.memoryReported =
      this.memoryReported || this.wasMemoryAnomalyReportedInSession();

    const memory = this.readBrowserMemory();
    if (!memory) {
      return;
    }

    this.initialDomDiagnostics = this.collectDomDiagnostics();
    this.observeLongTasks();
    this.addMemorySample(memory);
  }

  private createMemoryConfig(): MemoryMonitorConfig | null {
    const options = this.options.memoryMonitor;
    if (!options?.enabled) {
      return null;
    }

    return {
      sampleIntervalMs: Math.max(
        options.sampleIntervalMs ?? DEFAULT_MEMORY_SAMPLE_INTERVAL_MS,
        MIN_MEMORY_SAMPLE_INTERVAL_MS
      ),
      sampleWindowSize: Math.min(
        Math.max(
          Math.floor(
            options.sampleWindowSize ?? DEFAULT_MEMORY_SAMPLE_WINDOW_SIZE
          ),
          MIN_MEMORY_SAMPLE_WINDOW_SIZE
        ),
        MAX_MEMORY_SAMPLE_WINDOW_SIZE
      ),
      minUsedJSHeapSize: Math.max(
        options.minUsedJSHeapSize ?? DEFAULT_MIN_USED_JS_HEAP_SIZE,
        0
      ),
      minGrowthBytes: Math.max(
        options.minGrowthBytes ?? DEFAULT_MIN_GROWTH_BYTES,
        0
      ),
      minGrowthRatio: Math.max(
        options.minGrowthRatio ?? DEFAULT_MIN_GROWTH_RATIO,
        1
      ),
      collectContext: options.collectContext,
    };
  }

  private readBrowserMemory(): BrowserMemory | null {
    const memory = (
      _global.performance as Performance & { memory?: BrowserMemory }
    ).memory;
    if (
      !memory ||
      !Number.isFinite(memory.jsHeapSizeLimit) ||
      !Number.isFinite(memory.totalJSHeapSize) ||
      !Number.isFinite(memory.usedJSHeapSize) ||
      memory.usedJSHeapSize <= 0
    ) {
      return null;
    }

    return {
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
      totalJSHeapSize: memory.totalJSHeapSize,
      usedJSHeapSize: memory.usedJSHeapSize,
    };
  }

  private addMemorySample(memory: BrowserMemory): void {
    if (!this.isSetup || !this.memoryConfig) {
      return;
    }

    const time = getTimestamp();
    // 采样出现断层就重新开窗：「持续增长」只有在一段连续观测上才成立，
    // 否则一个跨了几小时的窗口会以每分钟几字节的真实增速报出「极端增长」，
    // 而且会用掉本会话唯一的一次上报名额，把之后真正的泄漏顶掉
    if (this.hasSamplingGap(time)) {
      this.memorySamples = [];
    }

    this.memorySamples.push({
      ...memory,
      time,
    });
    if (this.memorySamples.length > this.memoryConfig.sampleWindowSize) {
      this.memorySamples.shift();
    }

    try {
      const trend =
        !this.memoryReported && !this.wasMemoryAnomalyReportedInSession()
          ? this.getExtremeMemoryTrend()
          : null;
      const shouldSaveSnapshot = this.options.recovery?.enabled !== false;
      if (shouldSaveSnapshot || trend) {
        // DOM/context collection runs at most once per existing sampling tick.
        const diagnostics = this.collectMemoryDiagnostics();
        if (!this.isSetup) return;
        if (shouldSaveSnapshot) {
          void this.saveMemoryDiagnosticSnapshot(diagnostics);
        }
        if (trend) {
          this.reportMemoryAnomaly(trend, diagnostics);
        }
      }
    } catch {
      // Optional diagnostics must not interrupt the sampling chain or the app.
    } finally {
      this.scheduleNextMemorySample();
    }
  }

  /**
   * 距上一个采样点是否已超出容忍间隔。
   * 以实际间隔判断而非只监听 visibilitychange，可同时覆盖标签页冻结、
   * 定时器节流与设备休眠 —— 这些都会在窗口里留下同样的时间断层。
   */
  private hasSamplingGap(time: number): boolean {
    const config = this.memoryConfig;
    const lastSample = this.memorySamples[this.memorySamples.length - 1];
    if (!config || !lastSample) {
      return false;
    }
    return (
      time - lastSample.time >
      config.sampleIntervalMs * MEMORY_SAMPLE_GAP_TOLERANCE
    );
  }

  private scheduleNextMemorySample(): void {
    if (!this.isSetup || !this.memoryConfig) {
      return;
    }

    this.memoryTimer = _global.setTimeout(() => {
      this.memoryTimer = null;
      if (!this.isSetup) return;
      if (_global.document.visibilityState === "hidden") {
        this.scheduleNextMemorySample();
        return;
      }

      const memory = this.readBrowserMemory();
      if (!memory) {
        // 单次读数不可用（performance.memory 暂时取不到值）不能让采样链断掉，
        // 否则整个标签页会话就此静默失效 —— 对一个专抓 OOM 的功能是最坏的失败模式
        this.scheduleNextMemorySample();
        return;
      }
      this.addMemorySample(memory);
    }, this.memoryConfig.sampleIntervalMs);
  }

  private getExtremeMemoryTrend(): MemoryTrend | null {
    const config = this.memoryConfig;
    if (!config || this.memorySamples.length < config.sampleWindowSize) {
      return null;
    }

    const midpoint = Math.floor(this.memorySamples.length / 2);
    let baselineUsedJSHeapSize = Number.POSITIVE_INFINITY;
    let recentFloorUsedJSHeapSize = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.memorySamples.length; index += 1) {
      const usedJSHeapSize = this.memorySamples[index].usedJSHeapSize;
      if (index < midpoint) {
        baselineUsedJSHeapSize = Math.min(
          baselineUsedJSHeapSize,
          usedJSHeapSize
        );
      } else {
        recentFloorUsedJSHeapSize = Math.min(
          recentFloorUsedJSHeapSize,
          usedJSHeapSize
        );
      }
    }

    const firstSample = this.memorySamples[0];
    const currentSample = this.memorySamples[this.memorySamples.length - 1];
    const growthBytes =
      recentFloorUsedJSHeapSize - baselineUsedJSHeapSize;
    const growthRatio =
      recentFloorUsedJSHeapSize / baselineUsedJSHeapSize;
    const windowDurationMs = currentSample.time - firstSample.time;

    if (
      currentSample.usedJSHeapSize < config.minUsedJSHeapSize ||
      growthBytes < config.minGrowthBytes ||
      growthRatio < config.minGrowthRatio
    ) {
      return null;
    }

    return {
      baselineUsedJSHeapSize,
      currentUsedJSHeapSize: currentSample.usedJSHeapSize,
      recentFloorUsedJSHeapSize,
      growthBytes,
      growthRatio,
      growthPerMinute:
        windowDurationMs > 0
          ? growthBytes / (windowDurationMs / 60_000)
          : 0,
      windowDurationMs,
    };
  }

  private reportMemoryAnomaly(
    trend: MemoryTrend,
    diagnostics: Record<string, unknown>
  ): void {
    if (this.memoryReported) {
      return;
    }
    this.memoryReported = true;

    const currentMemory = this.memorySamples[this.memorySamples.length - 1];
    void this.reportData.send({
      type: EVENT_TYPE.PERFORMANCE,
      name: MEMORY_ANOMALY_EVENT_NAME,
      status: STATUS_CODE.ERROR,
      time: getTimestamp(),
      message: "检测到持续且极端的 JS 堆内存增长",
      data: {
        memory: {
          jsHeapSizeLimit: currentMemory.jsHeapSizeLimit,
          totalJSHeapSize: currentMemory.totalJSHeapSize,
          usedJSHeapSize: currentMemory.usedJSHeapSize,
        },
        trend: {
          ...trend,
          samples: this.memorySamples.map((sample) => ({ ...sample })),
        },
        diagnostics,
      },
    }).then((acknowledged) => {
      if (acknowledged === true) {
        this.persistMemoryReportMarker();
      }
    }).catch(() => {
      // Keep the snapshot and allow a new instance to detect an unconfirmed event.
    });
  }

  private async saveMemoryDiagnosticSnapshot(
    diagnostics: Record<string, unknown>
  ): Promise<void> {
    if (!this.isSetup) return;
    try {
      await this.reportData.saveDiagnosticSnapshot({
        type: EVENT_TYPE.PERFORMANCE,
        name: MEMORY_DIAGNOSTIC_SNAPSHOT_EVENT_NAME,
        status: STATUS_CODE.OK,
        time: getTimestamp(),
        message: "上次运行的内存诊断快照，不证明发生 crash、OOM 或异常退出",
        data: {
          samples: this.memorySamples.map((sample) => ({ ...sample })),
          diagnostics,
        },
      });
    } catch {
      // Persistence is best effort and must never stop future samples.
    }
  }

  private collectMemoryDiagnostics(): Record<string, unknown> {
    return {
      sessionDurationMs: getTimestamp() - this.sessionStartedAt,
      document: {
        initial: this.initialDomDiagnostics,
        current: this.collectDomDiagnostics(),
      },
      device: {
        deviceMemory: (
          _global.navigator as Navigator & { deviceMemory?: number }
        ).deviceMemory,
        hardwareConcurrency: _global.navigator.hardwareConcurrency,
      },
      longTasks: {
        count: this.longTaskCount,
        totalDuration: this.longTaskTotalDuration,
        maxDuration: this.longTaskMaxDuration,
        recent: this.recentLongTasks.map((task) => ({ ...task })),
      },
      recentActivity: this.collectRecentActivity(),
      application: this.collectApplicationContext(),
    };
  }

  private collectDomDiagnostics(): DomDiagnostics {
    const document = _global.document;
    return {
      nodeCount: document.getElementsByTagName("*").length,
      imageCount: document.getElementsByTagName("img").length,
      videoCount: document.getElementsByTagName("video").length,
      canvasCount: document.getElementsByTagName("canvas").length,
      iframeCount: document.getElementsByTagName("iframe").length,
    };
  }

  private collectRecentActivity(): Array<RecentActivity> {
    return this.breadcrumb.getStack().slice(-MAX_RECENT_ACTIVITY).map((item) => {
      const activity: RecentActivity = {
        type: item.type,
        status: item.status,
        time: item.time,
      };
      const data = isRecord(item.data) ? item.data : undefined;
      if (item.type === EVENT_TYPE.HISTORY) {
        activity.route = {
          from: data?.from,
          to: data?.to,
        };
      } else if (
        item.type === EVENT_TYPE.FETCH ||
        item.type === EVENT_TYPE.XHR
      ) {
        activity.request = {
          url:
            typeof data?.url === "string"
              ? data.url.split(/[?#]/, 1)[0]
              : undefined,
          elapsedTime: data?.elapsedTime,
        };
      } else if (item.type === EVENT_TYPE.CLICK) {
        const info = isRecord(data?.info) ? data.info : undefined;
        activity.target = {
          tagName: info?.tagName,
          id: info?.id,
        };
      }
      return activity;
    });
  }

  private collectApplicationContext(): Record<string, unknown> | null {
    if (!this.memoryConfig?.collectContext) {
      return null;
    }
    try {
      return this.memoryConfig.collectContext();
    } catch {
      return null;
    }
  }

  private observeLongTasks(): void {
    const Observer = _global.PerformanceObserver;
    if (
      !Observer ||
      !Observer.supportedEntryTypes?.includes("longtask")
    ) {
      return;
    }

    try {
      this.longTaskObserver = new Observer((list) => {
        list.getEntries().forEach((entry) => {
          this.longTaskCount += 1;
          this.longTaskTotalDuration += entry.duration;
          this.longTaskMaxDuration = Math.max(
            this.longTaskMaxDuration,
            entry.duration
          );
          this.recentLongTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
          });
          if (this.recentLongTasks.length > MAX_RECENT_LONG_TASKS) {
            this.recentLongTasks.shift();
          }
        });
      });
      this.longTaskObserver.observe({ type: "longtask", buffered: true });
    } catch {
      this.longTaskObserver = null;
    }
  }

  private wasMemoryAnomalyReportedInSession(): boolean {
    try {
      return (
        _global.sessionStorage.getItem(MEMORY_REPORT_SESSION_KEY) === "1"
      );
    } catch {
      return false;
    }
  }

  private persistMemoryReportMarker(): void {
    try {
      _global.sessionStorage.setItem(MEMORY_REPORT_SESSION_KEY, "1");
    } catch {
      // 存储不可用时仍由当前插件实例的 memoryReported 保证只上报一次。
    }
  }

  destroy() {
    this.isSetup = false;
    this.unsubscribeRecoveredReports?.();
    this.unsubscribeRecoveredReports = null;
    if (this.loadHandler) {
      _global.removeEventListener("load", this.loadHandler);
      this.loadHandler = null;
    }
    if (this.memoryTimer !== null) {
      _global.clearTimeout(this.memoryTimer);
      this.memoryTimer = null;
    }
    if (this.longTaskObserver) {
      this.longTaskObserver.disconnect();
      this.longTaskObserver = null;
    }
    this.memorySamples = [];
    this.recentLongTasks = [];
  }
}

export function getResource(): Array<Record<string, unknown>> {
  const entries = performance.getEntriesByType(
    "resource"
  ) as Array<PerformanceResourceTiming>;
  // 过滤掉非静态资源的 fetch、xmlhttprequest、beacon，并标记是否命中缓存
  return entries
    .filter(
      (entry) =>
        ["fetch", "xmlhttprequest", "beacon"].indexOf(entry.initiatorType) ===
        -1
    )
    .map((entry) => {
      const serialized =
        typeof entry.toJSON === "function" ? entry.toJSON() : entry;
      return {
        ...(isRecord(serialized) ? serialized : {}),
        isCache: isCache(entry),
      };
    });
}

// 判断资料是否来自缓存
export function isCache(entry: PerformanceResourceTiming): boolean {
  return (
    entry.transferSize === 0 ||
    (entry.transferSize !== 0 && entry.encodedBodySize === 0)
  );
}

export function getWebVitals(callback: Callback): void {
  onLCP((res) => {
    callback(res);
  });
  onFID((res) => {
    callback(res);
  });
  onCLS((res) => {
    callback(res);
  });
  onFCP((res) => {
    callback(res);
  });
  onTTFB((res) => {
    callback(res);
  });
}
