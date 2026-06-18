import { onCLS, onFCP, onFID, onLCP, onTTFB } from "web-vitals";
import { Breadcrumb } from "../core/breadcrumb";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE } from "../core/constant";
import { _global } from "../core/global";
import { ReportDataController } from "../core/report";
import { Callback } from "../core/typing";
import { IOptionsParams } from "../typings/options";
import { addEventListenerTo, getTimestamp } from "../utils";
import { IPluginParams } from "./common";

export class PerformancePlugin implements IPluginParams {
  name = PLUGIN_TYPE.PERFORMANCE_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  private loadHandler: (() => void) | null = null;
  constructor(params: IPluginParams) {
    const { options, breadcrumb, reportData } = params;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.setup();
  }
  setup() {
    this.getSourceData();
    this.getPerformanceData();
  }

  getPerformanceData() {
    getWebVitals((res: any) => {
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
      const memory = (performance as any)["memory"];
      // 上报内存情况, safari、firefox不支持该属性
      if (memory) {
        this.reportData.send({
          type: EVENT_TYPE.PERFORMANCE,
          name: "memory",
          time: getTimestamp(),
          data: {
            memory: {
              jsHeapSizeLimit: memory?.jsHeapSizeLimit,
              totalJSHeapSize: memory?.totalJSHeapSize,
              usedJSHeapSize: memory?.usedJSHeapSize,
            },
          },
          status: STATUS_CODE.OK,
        });
      }
    };
    addEventListenerTo(_global, "load", this.loadHandler);
  }

  destroy() {
    if (this.loadHandler) {
      _global.removeEventListener("load", this.loadHandler);
      this.loadHandler = null;
    }
  }
}

export function getResource(): any[] {
  const entries = performance.getEntriesByType(
    "resource"
  ) as PerformanceResourceTiming[];
  // 过滤掉非静态资源的 fetch、xmlhttprequest、beacon，并标记是否命中缓存
  return entries
    .filter(
      (entry) =>
        ["fetch", "xmlhttprequest", "beacon"].indexOf(entry.initiatorType) ===
        -1
    )
    .map((entry) => ({
      ...(typeof entry.toJSON === "function" ? entry.toJSON() : entry),
      isCache: isCache(entry),
    }));
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
