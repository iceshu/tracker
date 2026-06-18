import { Breadcrumb } from "../core/breadcrumb";
import { ReportDataController } from "../core/report";
import { IPluginParams, ReplacePlugin } from "./common";
import { _global } from "../core/global";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE } from "../core/constant";
import { getTimestamp, replaceAop } from "../utils";
import { IOptionsParams } from "../typings/options";

const CONSOLE_LEVELS = ["log", "debug", "info", "warn", "error", "assert"];

// Error 的 message/stack 是不可枚举属性，JSON.stringify 会丢成 {}，这里显式提取
function serializeConsoleArg(arg: any): any {
  if (arg instanceof Error) {
    return { name: arg.name, message: arg.message, stack: arg.stack };
  }
  return arg;
}

export class ConsolePlugin implements ReplacePlugin {
  name = PLUGIN_TYPE.CONSOLE_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  // 防止 SDK 内部 console 调用被再次捕获而形成反馈环
  private isHandling = false;
  private originals = new Map<string, (...args: any[]) => any>();
  private isSetup = false;

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

    // 如果是 console.error，自动上报数据
    if (data.level === "error") {
      this.reportData.send(data);
    }
  }
  replace() {
    if (this.isSetup) return;
    if (!("console" in _global)) {
      return;
    }
    this.isSetup = true;
    CONSOLE_LEVELS.forEach((level: string): void => {
      if (!(level in _global.console)) return;
      this.originals.set(level, (_global.console as any)[level]);
      replaceAop(
        _global.console,
        level,
        (original: (...args: any[]) => any): Function => {
          return (...args: any[]): void => {
            if (!original) return;
            original.apply(_global.console, args);
            if (this.isHandling) return;
            this.isHandling = true;
            try {
              this.handleConsole({ args: args.map(serializeConsoleArg), level });
            } finally {
              this.isHandling = false;
            }
          };
        }
      );
    });
  }

  // 还原被改写的 console 方法
  destroy(): void {
    if (!("console" in _global)) {
      return;
    }
    this.originals.forEach((fn, level) => {
      (_global.console as any)[level] = fn;
    });
    this.originals.clear();
    this.isSetup = false;
  }
}
