import { Breadcrumb } from "../core/breadcrumb";
import { ReportDataController } from "../core/report";
import { IPluginParams, ReplacePlugin } from "./common";
import { _global } from "../core/global";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE } from "../core/constant";
import { getTimestamp, replaceAop } from "../utils";
import { IOptionsParams } from "../core/options";

export class ConsolePlugin implements ReplacePlugin {
  name = PLUGIN_TYPE.CONSOLE_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  isPoxing = false; // 标志位用于标识是否正在代理中

  constructor(params: IPluginParams) {
    const { options, breadcrumb, reportData } = params;
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
    const _this = this;
    if (!("console" in _global)) {
      return;
    }
    const logType = ["log", "debug", "info", "warn", "error", "assert"];
    logType.forEach(function (level: string): void {
      if (!(level in _global.console)) return;
      replaceAop(
        _global.console,
        level,
        function (originalConsole: () => any): Function {
          return function (...args: any): void {
            if (originalConsole) {
              _this.handleConsole({ args, level });
              originalConsole.apply(_global.console, args);
            }
          };
        }
      );
    });
  }
}
