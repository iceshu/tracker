import { Breadcrumb } from "../core/breadcrumb";
import { EVENT_TYPE, STATUS_CODE } from "../core/constant";
import { Global } from "../core/global";
import { ReportDataController } from "../core/report";
import { getLocationHref, getTimestamp, parseUrlToObj } from "../utils";
import { IPluginParams, ReplacePlugin } from "./common";

export class HistoryPlugin extends ReplacePlugin {
  global: Global;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  constructor(params: IPluginParams) {
    super();
    const { global, options, breadcrumb, reportData } = params;
    this.global = global;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.replace();
  }
  replace() {
    if (!supportsHistory()) {
      return;
    }
    const history = this.global._global.history;
    const oldOnpopstate = this.global._global.onpopstate;
    this.global._global.onpopstate = (...args: any[]) => {
      const to = getLocationHref();
      const from = lastHref;
      lastHref = to;
      this.handleData({
        from,
        to,
      });
      oldOnpopstate && oldOnpopstate.apply(this.global._global, args);
    };
    const historyProxy = new Proxy(history, {
      get: (target, prop, receiver) => {
        if (prop === "pushState" || prop === "replaceState") {
          return (args: string | readonly any[]) => {
            // 在调用原始方法之前执行自定义代码
            const url = args.length > 2 ? args[2] : undefined;
            if (url) {
              const from = lastHref;
              const to = String(url);
              lastHref = to;
              this.handleData({
                from,
                to,
              });
            }
            // 调用原始方法
            return Reflect.apply(target[prop], this, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    Object.defineProperty(this.global._global, "history", {
      value: historyProxy,
    });
  }
  supportHistory() {
    return !!(
      this.global._global.history && this.global._global.history.pushState
    );
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
