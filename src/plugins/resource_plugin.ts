import { Breadcrumb } from "../core/breadcrumb";
import {
  BREADCRUMB_TYPE,
  EVENT_TYPE,
  PLUGIN_TYPE,
  STATUS_CODE,
} from "../core/constant";
import { _global } from "../core/global";
import { ReportDataController } from "../core/report";
import { IOptionsParams } from "../typings/options";
import { getTimestamp } from "../utils";
import { IPluginParams, ReplacePlugin } from "./common";

// 资源类型映射
const RESOURCE_TYPE_MAP: Record<string, string> = {
  script: "JavaScript",
  link: "CSS",
  img: "Image",
  fetch: "Fetch",
  xmlhttprequest: "XHR",
  other: "Other",
};

export class ResourcePlugin implements ReplacePlugin {
  name = PLUGIN_TYPE.RESOURCE_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  private observer: PerformanceObserver | null = null;

  constructor(params: IPluginParams) {
    const { options, breadcrumb, reportData } = params;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.setup();
  }

  setup() {
    if (!this.isSupportPerformanceObserver()) {
      return;
    }
    this.observeResourceTiming();
  }

  isSupportPerformanceObserver(): boolean {
    return "PerformanceObserver" in _global && "performance" in _global;
  }

  observeResourceTiming() {
    try {
      // 使用 PerformanceObserver 监听资源加载
      this.observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.entryType === "resource") {
            this.handleResourceTiming(entry as PerformanceResourceTiming);
          }
        });
      });

      // 监听 resource 类型的性能条目
      this.observer.observe({ entryTypes: ["resource"] });
    } catch (error) {
      console.error("ResourcePlugin: Failed to observe resource timing", error);
    }
  }

  handleResourceTiming(entry: PerformanceResourceTiming) {
    const {
      name: url,
      initiatorType,
      duration,
      transferSize,
      decodedBodySize,
    } = entry;

    // 过滤掉接口请求，只监控静态资源
    if (["fetch", "xmlhttprequest", "beacon"].includes(initiatorType)) {
      return;
    }

    // 检查是否需要过滤该资源
    if (this.shouldSkipResource(url)) {
      return;
    }

    const resourceType = RESOURCE_TYPE_MAP[initiatorType] || "Other";
    const threshold = this.options.resourceLoadTime || 10000; // 默认10秒

    // 资源加载时长超过阈值，上报
    if (duration > threshold) {
      const data = {
        url,
        type: resourceType,
        initiatorType,
        duration: Math.round(duration),
        threshold,
        transferSize,
        decodedBodySize,
        isCache: this.isCache(entry),
      };

      // 添加到用户行为栈
      this.breadcrumb.push({
        type: EVENT_TYPE.RESOURCE,
        category: BREADCRUMB_TYPE.RESOURCE,
        data,
        time: getTimestamp(),
        status: STATUS_CODE.ERROR,
      });

      // 上报资源加载超时
      this.reportData.send({
        name: BREADCRUMB_TYPE.RESOURCE,
        type: EVENT_TYPE.RESOURCE,
        status: STATUS_CODE.ERROR,
        time: getTimestamp(),
        message: `资源加载超时: ${url}`,
        data,
      });
    }
  }

  // 判断资源是否来自缓存
  isCache(entry: PerformanceResourceTiming): boolean {
    // transferSize 为 0 表示从缓存加载（如 memory cache 或 disk cache）
    // transferSize < encodedBodySize 也可能是部分缓存
    return entry.transferSize === 0 || entry.transferSize < entry.encodedBodySize;
  }

  // 判断是否需要跳过该资源
  shouldSkipResource(url: string): boolean {
    // 跳过 SDK 自己的上报接口
    if (this.reportData.isSdkTransportUrl(url)) {
      return true;
    }

    // 如果配置了过滤规则
    if (this.options.filterResourceUrlRegExp) {
      return this.options.filterResourceUrlRegExp.test(url);
    }

    return false;
  }

  // 销毁监听器
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}
