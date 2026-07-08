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

// 慢路由检测硬上限（毫秒，从路由开始算起）：
// 超过阈值后不立刻上报，而是等待路由真实完成再上报真实耗时；
// 若到硬上限仍未完成（页面持续无空闲 / 用户停留在卡死页面），按未完成兜底上报。
const ROUTE_LOAD_HARD_CAP = 30 * 1000;

export class HistoryPlugin implements ReplacePlugin {
  name = PLUGIN_TYPE.HISTORY_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  private routeStartTime: number = 0; // 路由跳转开始时间
  private routeStartFrom: string = ""; // 跳转来源
  private routeStartTo: string = ""; // 跳转目标
  private loadCheckTimer: number | null = null; // 阈值定时器 ID
  private hardCapTimer: number | null = null; // 硬上限兜底定时器 ID
  private slowRoutePending: boolean = false; // 已超阈值，等待真实完成后上报
  private isRouteCompleted: boolean = false; // 路由是否已完成标记
  // 导航世代号：每次 startRouteChange 递增。
  // 完成回调（requestIdleCallback）与定时器都携带发起时的世代号，
  // 世代不匹配说明属于上一次导航（迟到回调），直接忽略，避免误标记本次导航。
  private navGeneration: number = 0;
  private oldOnpopstate: Window["onpopstate"] = null; // 原始 onpopstate，destroy 时还原
  private originalPushState: History["pushState"] | null = null;
  private originalReplaceState: History["replaceState"] | null = null;
  private removeLifecycleListeners: (() => void) | null = null;
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
    _global.onpopstate = (...args: [PopStateEvent]) => {
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
        oldOnpopstate.apply(_global, args);
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

    // 生命周期监听只注册一次（此前每次导航都挂一个 { once: true } 的 beforeunload，
    // SPA 长会话下监听器会一直累积到页面卸载）：
    // - 卸载：清理定时器
    // - 切后台：定时器与 requestIdleCallback 都会被浏览器节流/冻结，测出的耗时失真，
    //   先把已超阈值的导航按未完成上报（此刻的前台等待时长仍是真实的），再取消检测
    const onUnload = () => {
      this.cancelRouteCheck();
    };
    const onVisibilityChange = () => {
      if (_global.document.visibilityState === "hidden") {
        if (this.slowRoutePending) {
          this.reportSlowRoute(this.navGeneration, false);
        }
        this.cancelRouteCheck();
      }
    };
    addEventListenerTo(_global, "beforeunload", onUnload);
    addEventListenerTo(_global.document, "visibilitychange", onVisibilityChange);
    this.removeLifecycleListeners = () => {
      _global.removeEventListener("beforeunload", onUnload);
      _global.document.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
    };
  }

  // 开始路由跳转，记录时间
  startRouteChange(from: string, to: string) {
    // pushState/replaceState 到完全相同的地址（如慢加载途中原地同步 query 参数、更新 history.state），
    // 不是用户感知的页面跳转：既不开始新检测，也绝不能打断/放弃进行中的检测
    if (toRelativeUrl(from) === toRelativeUrl(to)) {
      return;
    }

    // 上一次导航已超阈值且尚未完成，用户又发起了新跳转 → 按放弃处理，上报真实等待时长
    if (this.slowRoutePending) {
      this.reportSlowRoute(this.navGeneration, false);
    }

    // 使上一次导航的所有 pending 定时器/完成回调失效
    this.navGeneration += 1;
    this.cancelRouteCheck();

    // 后台标签页中定时器与 requestIdleCallback 均被节流/冻结，测出的耗时没有意义
    if (_global.document.visibilityState === "hidden") {
      return;
    }

    this.routeStartTime = getTimestamp();
    this.routeStartFrom = from;
    this.routeStartTo = to;
    this.isRouteCompleted = false;

    // 开始检测页面加载性能
    this.checkRouteLoadTime(this.navGeneration);

    // 监听页面渲染完成
    this.listenRouteComplete(this.navGeneration);
  }

  // 取消进行中的慢路由检测（新导航开始 / 页面隐藏 / 卸载 / 销毁时调用）
  cancelRouteCheck() {
    if (this.loadCheckTimer !== null) {
      clearTimeout(this.loadCheckTimer);
      this.loadCheckTimer = null;
    }
    if (this.hardCapTimer !== null) {
      clearTimeout(this.hardCapTimer);
      this.hardCapTimer = null;
    }
    this.slowRoutePending = false;
  }

  // 阈值定时器：到点仍未完成时不再立刻上报（那样报出的耗时恒等于阈值，无信息量），
  // 而是转入"等待真实完成"状态：完成回调携带真实耗时上报，硬上限兜底
  checkRouteLoadTime(gen: number) {
    const threshold = this.options.overTime || 3000; // 默认3秒阈值

    this.loadCheckTimer = window.setTimeout(() => {
      this.loadCheckTimer = null;
      if (gen !== this.navGeneration || this.isRouteCompleted) {
        return;
      }
      // 到点时已在后台：节流环境下的耗时不可信，放弃本次检测
      if (_global.document.visibilityState === "hidden") {
        return;
      }
      this.slowRoutePending = true;
      const remaining = Math.max(ROUTE_LOAD_HARD_CAP - threshold, 1000);
      this.hardCapTimer = window.setTimeout(() => {
        this.hardCapTimer = null;
        this.reportSlowRoute(gen, false);
      }, remaining);
    }, threshold);
  }

  // 监听路由渲染完成：主线程出现空闲（requestIdleCallback）即视为完成，近似可交互时间
  listenRouteComplete(gen: number) {
    const complete = () => {
      this.markRouteCompleted(gen);
    };
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => {
        complete();
      });
    } else {
      // 降级方案：使用 setTimeout 0
      setTimeout(complete, 0);
    }
  }

  // 标记路由完成；gen 缺省时作用于当前导航
  markRouteCompleted(gen?: number) {
    if (gen !== undefined && gen !== this.navGeneration) {
      return; // 上一次导航的迟到回调，忽略
    }
    this.isRouteCompleted = true;
    if (this.slowRoutePending) {
      this.reportSlowRoute(this.navGeneration, true);
    }
  }

  // 上报慢路由：loadTime 为真实耗时（完成/放弃/硬上限时刻 - 跳转开始时刻）
  private reportSlowRoute(gen: number, completed: boolean) {
    if (!this.slowRoutePending || gen !== this.navGeneration) {
      return;
    }
    this.slowRoutePending = false;
    if (this.hardCapTimer !== null) {
      clearTimeout(this.hardCapTimer);
      this.hardCapTimer = null;
    }

    const threshold = this.options.overTime || 3000;
    const loadTime = getTimestamp() - this.routeStartTime;
    const { relative: parsedFrom } = parseUrlToObj(this.routeStartFrom);
    const { relative: parsedTo } = parseUrlToObj(this.routeStartTo);

    this.reportData.send({
      name: BREADCRUMB_TYPE.ROUTE,
      type: EVENT_TYPE.HISTORY,
      data: {
        from: parsedFrom ? parsedFrom : "/",
        to: parsedTo ? parsedTo : "/",
        loadTime, // 真实跳转耗时（毫秒）
        threshold,
        completed, // false = 未等到渲染完成（用户离开 / 切后台 / 超过硬上限）
      },
      time: getTimestamp(),
      status: STATUS_CODE.ERROR,
      message: completed
        ? `路由跳转耗时过长: ${loadTime}ms，超过阈值 ${threshold}ms`
        : `路由跳转耗时过长: ${loadTime}ms，超过阈值 ${threshold}ms（未等到渲染完成）`,
    });
  }

  // 销毁插件，清理定时器/监听器并还原被改写的 history 方法
  destroy() {
    this.cancelRouteCheck();
    if (this.removeLifecycleListeners) {
      this.removeLifecycleListeners();
      this.removeLifecycleListeners = null;
    }
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
  handleData(data: { from: string; to: string }) {
    const { from, to } = data;
    const { relative: parsedFrom } = parseUrlToObj(from);
    const { relative: parsedTo } = parseUrlToObj(to);
    // 同地址的原地操作（replaceState 同步 query/state）不产生行为轨迹信息，
    // 反而会把有限的面包屑栈冲掉，跳过
    if (parsedFrom && parsedFrom === parsedTo) {
      return;
    }
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

// 将绝对/相对地址统一为 path+query+hash 形式，便于比较是否同地址
// （pushState 的 url 参数可能是相对形式，相对引用需要以当前地址为基准解析）
function toRelativeUrl(url: string): string {
  try {
    const parsed = new URL(url, _global.location.href);
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    const { relative } = parseUrlToObj(url);
    return relative || url;
  }
}
