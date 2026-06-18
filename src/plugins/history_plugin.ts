import { Breadcrumb } from "../core/breadcrumb";
import {
  BREADCRUMB_TYPE,
  EVENT_TYPE,
  PLUGIN_TYPE,
  STATUS_CODE,
} from "../core/constant";
import { _global } from "../core/global";
import { ReportDataController } from "../core/report";
import { voidFun } from "../core/typing";
import { IOptionsParams } from "../typings/options";
import {
  getLocationHref,
  getTimestamp,
  parseUrlToObj,
  addEventListenerTo,
} from "../utils";
import { IPluginParams, ReplacePlugin } from "./common";

export class HistoryPlugin implements ReplacePlugin {
  name = PLUGIN_TYPE.HISTORY_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  private routeStartTime: number = 0; // 路由跳转开始时间
  private routeStartFrom: string = ""; // 跳转来源
  private routeStartTo: string = ""; // 跳转目标
  private loadCheckTimer: number | null = null; // 定时器ID，用于取消
  private isRouteCompleted: boolean = false; // 路由是否已完成标记
  private oldOnpopstate: any = null; // 原始 onpopstate，destroy 时还原
  private originalPushState: History["pushState"] | null = null;
  private originalReplaceState: History["replaceState"] | null = null;
  private isSetup = false;

  constructor(params: IPluginParams) {
    const { options, breadcrumb, reportData } = params;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.setup();
  }
  setup() {
    if (this.isSetup) return;
    if (!supportsHistory()) {
      return;
    }
    this.isSetup = true;
    const history = _global.history;
    const oldOnpopstate = _global.onpopstate;
    this.oldOnpopstate = oldOnpopstate;
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
      if (oldOnpopstate) {
        oldOnpopstate.apply(_global, args as any);
      }
    };
    // 保存原始的 pushState 和 replaceState 方法
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    this.originalPushState = originalPushState;
    this.originalReplaceState = originalReplaceState;

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
    // 取消之前的检测（如果存在）
    this.cancelRouteCheck();

    this.routeStartTime = getTimestamp();
    this.routeStartFrom = from;
    this.routeStartTo = to;
    this.isRouteCompleted = false;

    // 开始检测页面加载性能
    this.checkRouteLoadTime();

    // 监听页面渲染完成
    this.listenRouteComplete();

    // 页面卸载时清理定时器，防止内存泄漏
    addEventListenerTo(
      _global,
      "beforeunload",
      () => {
        this.cancelRouteCheck();
      },
      { once: true } as AddEventListenerOptions
    );
  }

  // 取消之前的路由检测
  cancelRouteCheck() {
    if (this.loadCheckTimer !== null) {
      clearTimeout(this.loadCheckTimer);
      this.loadCheckTimer = null;
    }
  }

  // 检测路由加载耗时
  checkRouteLoadTime() {
    const threshold = this.options.overTime || 3000; // 默认3秒阈值

    // 设置定时器，在阈值时间后检查是否完成
    this.loadCheckTimer = window.setTimeout(() => {
      // 如果在阈值时间后还未完成，则上报
      if (!this.isRouteCompleted) {
        const loadTime = getTimestamp() - this.routeStartTime;
        const { relative: parsedFrom } = parseUrlToObj(this.routeStartFrom);
        const { relative: parsedTo } = parseUrlToObj(this.routeStartTo);

        this.reportData.send({
          name: BREADCRUMB_TYPE.ROUTE,
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
      this.loadCheckTimer = null;
    }, threshold);
  }

  // 监听路由渲染完成
  listenRouteComplete() {
    // 使用 requestIdleCallback 检测页面空闲（表示渲染基本完成）
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => {
        this.markRouteCompleted();
      });
    } else {
      // 降级方案：使用 setTimeout 0
      setTimeout(() => {
        this.markRouteCompleted();
      }, 0);
    }
  }

  // 标记路由完成
  markRouteCompleted() {
    this.isRouteCompleted = true;
  }

  // 销毁插件，清理定时器并还原被改写的 history 方法
  destroy() {
    this.cancelRouteCheck();
    if (this.originalPushState) {
      _global.history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    if (this.originalReplaceState) {
      _global.history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }
    _global.onpopstate = this.oldOnpopstate;
    this.oldOnpopstate = null;
    this.isSetup = false;
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
