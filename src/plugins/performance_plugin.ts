import { onLCP, onFID, onCLS, onFCP, onTTFB } from "web-vitals";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE } from "../core/constant";
import { Breadcrumb } from "../core/breadcrumb";
import { ReportDataController } from "../core/report";
import { IPluginParams } from "./common";
import { _global } from "../core/global";
import { Callback } from "../core/typing";
import { addEventListenerTo, getLocationHref, getTimestamp } from "../utils";
import { IOptionsParams } from "../core/options";

export class PerformancePlugin implements IPluginParams {
  name = PLUGIN_TYPE.PERFORMANCE_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
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
    addEventListenerTo(_global, "load", () => {
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
