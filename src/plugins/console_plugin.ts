import { Breadcrumb } from "../core/breadcrumb";
import { ReportDataController } from "../core/report";
import { IPluginParams } from "./common";
import { Global, _global } from "../core/global";
import { EVENT_TYPE, STATUS_CODE } from "../core/constant";
import { getTimestamp } from "../utils";
import { IOptionsParams } from "../core/options";

export class ConsolePlugin {
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  isPoxing = false; // 标志位用于标识是否正在代理中

  constructor(params: IPluginParams) {
    const { global, options, breadcrumb, reportData } = params;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.setup();
  }

  setup() {
    this.replace();
  }
  handleConsole(data: any): void {
    const { breadcrumb } = this;
    this.breadcrumb.push({
      type: EVENT_TYPE.CONSOLE,
      category: breadcrumb.getCategory(EVENT_TYPE.CONSOLE),
      data,
      level: data.level,
      status: STATUS_CODE.OK,
      time: getTimestamp(),
    });
  }
  replace() {
    if (!("console" in _global)) {
      return;
    }
    const self = this;
    const logType = ["log", "debug", "info", "warn", "error", "assert"];

    const consoleProxy = new Proxy(console, {
      get(target, prop: keyof Console, receiver) {
        if (logType.includes(prop) && !self.isPoxing) {
          self.isPoxing = true;
          return function (...args: any) {
            self.handleConsole({ args, level: 1 });
            self.isPoxing = false;
            return (target[prop] as any).apply(target, args);
          };
        } else {
          return target[prop];
        }
      },
    });

    // 应用代理对象到全局的 console 对象上
    _global.console = consoleProxy;
  }
}
