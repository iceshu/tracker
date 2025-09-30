import { Breadcrumb } from "../core/breadcrumb";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE } from "../core/constant";
import { _global } from "../core/global";
import { ReportDataController } from "../core/report";
import { voidFun } from "../core/typing";
import { IOptionsParams } from "../typings/options";
import { getLocationHref, getTimestamp, parseUrlToObj } from "../utils";
import { IPluginParams, ReplacePlugin } from "./common";

export class HistoryPlugin implements ReplacePlugin {
  name = PLUGIN_TYPE.HISTORY_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  private routeStartTime: number = 0; // 路由跳转开始时间
  private routeStartFrom: string = ""; // 跳转来源
  private routeStartTo: string = ""; // 跳转目标

  constructor(params: IPluginParams) {
    const { options, breadcrumb, reportData } = params;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.setup();
  }
  setup() {
    if (!supportsHistory()) {
      return;
    }
    const history = _global.history;
    const oldOnpopstate = _global.onpopstate;
    _global.onpopstate = (...args: any[]) => {
      const to = getLocationHref();
      const from = lastHref;
      lastHref = to;
      // 记录跳转开始时间
      this.startRouteChange(from, to);
      this.handleData({
        from,
        to,
      });
      oldOnpopstate && oldOnpopstate.apply(_global, args as any);
    };
    // 保存原始的 pushState 和 replaceState 方法
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    const createProxy = (originalMethod: voidFun) => {
      return new Proxy(originalMethod, {
        apply: (target, thisArg, argumentsList) => {
          // 在路由改变前记录开始时间
          const url = argumentsList.length > 2 ? argumentsList[2] : undefined;
          if (url) {
            const from = lastHref;
            const to = String(url);
            lastHref = to;

            // 记录跳转开始时间
            this.startRouteChange(from, to);

            this.handleData({
              from,
              to,
            });
          }
          // 调用原生方法
          return Reflect.apply(target, thisArg, argumentsList);
        },
      });
    };
    history.pushState = createProxy(originalPushState);
    history.replaceState = createProxy(originalReplaceState);
  }

  // 开始路由跳转，记录时间
  startRouteChange(from: string, to: string) {
    this.routeStartTime = getTimestamp();
    this.routeStartFrom = from;
    this.routeStartTo = to;

    // 检测页面渲染完成
    this.checkRouteComplete();
  }

  // 检测路由跳转是否完成
  checkRouteComplete() {
    const threshold = this.options.overTime || 3000; // 默认3秒阈值

    // 使用 requestIdleCallback 检测页面空闲（渲染完成）
    const checkComplete = () => {
      const loadTime = getTimestamp() - this.routeStartTime;

      // 如果超过阈值，上报性能问题
      if (loadTime > threshold) {
        const { relative: parsedFrom } = parseUrlToObj(this.routeStartFrom);
        const { relative: parsedTo } = parseUrlToObj(this.routeStartTo);

        this.reportData.send({
          name: this.name,
          type: EVENT_TYPE.HISTORY,
          data: {
            from: parsedFrom ? parsedFrom : "/",
            to: parsedTo ? parsedTo : "/",
            loadTime, // 跳转耗时（毫秒）
            threshold,
          },
          time: getTimestamp(),
          status: STATUS_CODE.ERROR,
          message: `路由跳转耗时过长: ${loadTime}ms，超过阈值 ${threshold}ms`,
        });
      }
    };

    // 优先使用 requestIdleCallback，否则使用 setTimeout
    if ("requestIdleCallback" in window) {
      requestIdleCallback(
        () => {
          checkComplete();
        },
        { timeout: threshold }
      );
    } else {
      setTimeout(() => {
        checkComplete();
      }, threshold);
    }
  }

  supportHistory() {
    return !!(_global.history && _global.history.pushState);
  }
  handleData(data: any) {
    const { from, to } = data;
    const { relative: parsedFrom } = parseUrlToObj(from);
    const { relative: parsedTo } = parseUrlToObj(to);
    this.breadcrumb.push({
      type: EVENT_TYPE.HISTORY,
      category: this.breadcrumb.getCategory(EVENT_TYPE.HISTORY),
      data: {
        from: parsedFrom ? parsedFrom : "/",
        to: parsedTo ? parsedTo : "/",
      },
      time: getTimestamp(),
      status: STATUS_CODE.OK,
    });
  }
}

let lastHref: string = getLocationHref();

function supportsHistory() {
  return !!(window.history && history.pushState);
}
