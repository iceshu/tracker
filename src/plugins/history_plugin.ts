import { Breadcrumb } from "../core/breadcrumb";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE } from "../core/constant";
import { _global } from "../core/global";
import { IOptionsParams } from "../core/options";
import { ReportDataController } from "../core/report";
import { voidFun } from "../core/typing";
import { getLocationHref, getTimestamp, parseUrlToObj } from "../utils";
import { IPluginParams, ReplacePlugin } from "./common";

export class HistoryPlugin implements ReplacePlugin {
  name = PLUGIN_TYPE.HISTORY_PLUGIN;
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
    if (!supportsHistory()) {
      return;
    }
    const history = _global.history;
    const oldOnpopstate = _global.onpopstate;
    _global.onpopstate = (...args: any[]) => {
      const to = getLocationHref();
      const from = lastHref;
      lastHref = to;
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
          // 添加自定义逻辑
          const url = argumentsList.length > 2 ? argumentsList[2] : undefined;
          if (url) {
            const from = lastHref;
            const to = String(url);
            lastHref = to;
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
