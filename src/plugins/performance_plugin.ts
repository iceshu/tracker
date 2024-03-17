import { onLCP, onFID, onCLS, onFCP, onTTFB } from "web-vitals";
import { EVENT_TYPE, STATUS_CODE } from "../core/constant";
import { Breadcrumb } from "../core/breadcrumb";
import { ReportDataController } from "../core/report";
import { IPluginParams } from "./common";
import { Global } from "../core/global";
import { Callback } from "../core/typing";
import { addEventListenerTo, getTimestamp } from "../utils";

export class PerformancePlugin {
  name = EVENT_TYPE.PERFORMANCE;
  global: Global;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  constructor(params: IPluginParams) {
    const { global, options, breadcrumb, reportData } = params;
    this.global = global;
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
      const { name, rating, value } = res;
      this.reportData.send({
        type: EVENT_TYPE.PERFORMANCE,
        status: STATUS_CODE.OK,
        time: getTimestamp(),
        name,
        rating,
        value,
      });
    });
  }

  getSourceData() {
    const { _global } = this.global;
    const performance = _global.performance;
    addEventListenerTo(_global, "load", () => {
      // 上报资源列表
      this.reportData.send({
        type: EVENT_TYPE.PERFORMANCE,
        name: "resourceList",
        status: STATUS_CODE.OK,
        resourceList: getResource(),
      });

      // 上报内存情况, safari、firefox不支持该属性
      if (_global.performance?.memory) {
        this.reportData.send({
          type: EVENT_TYPE.PERFORMANCE,
          name: "memory",
          time: getTimestamp(),
          status: STATUS_CODE.OK,
          memory: {
            jsHeapSizeLimit: performance?.memory?.jsHeapSizeLimit,
            totalJSHeapSize: performance?.memory?.totalJSHeapSize,
            usedJSHeapSize: performance?.memory?.usedJSHeapSize,
          },
        });
      }
    });
  }
}

export function getResource(): PerformanceResourceTiming[] {
  const entries = performance.getEntriesByType("resource");
  // 过滤掉非静态资源的 fetch、 xmlhttprequest、beacon
  let list = entries.filter((entry) => {
    return (
      ["fetch", "xmlhttprequest", "beacon"].indexOf(entry.initiatorType) === -1
    );
  });

  if (list.length) {
    list = JSON.parse(JSON.stringify(list));
    list.forEach((entry: any) => {
      entry.isCache = isCache(entry);
    });
  }
  return list;
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
