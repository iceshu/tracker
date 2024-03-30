import { Breadcrumb } from "../core/breadcrumb";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE } from "../core/constant";
import { _global } from "../core/global";
import { ReportDataController } from "../core/report";
import { ErrorTarget, ResourceError, ResourceTarget } from "../core/typing";
import {
  addEventListenerTo,
  getTimestamp,
  isString,
  isUndefined,
} from "../utils";
import ErrorStackParser from "error-stack-parser";
import { IPluginParams, ReplacePlugin } from "./common";
import { IOptionsParams } from "../core/options";

export class ErrorPlugin implements ReplacePlugin {
  name = PLUGIN_TYPE.ERROR_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  errorMap: WeakMap<any, any> = new WeakMap();
  constructor(params: IPluginParams) {
    const { options, breadcrumb, reportData } = params;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.listenError();
    this.setup();
  }
  setup() {
    this.listenError();
    this.listenUnHandledRejection();
  }
  listenError(): void {
    addEventListenerTo(
      _global,
      EVENT_TYPE.ERROR,
      (e: any) => {
        this.handleError(e);
      },
      true
    );
  }
  listenUnHandledRejection() {
    addEventListenerTo(
      _global,
      EVENT_TYPE.UNHANDLEDREJECTION,
      (e: any) => {
        this.handleUnhandledRejection(e);
      },
      true
    );
  }

  handleError(ev: ErrorTarget): any {
    const target = ev.target;
    if (!target || (ev.target && !ev.target.localName)) {
      // vue和react捕获的报错使用ev解析，异步错误使用ev.error解析
      const stackFrame = ErrorStackParser.parse(!target ? ev : ev.error)[0];
      const { fileName, columnNumber, lineNumber } = stackFrame;
      const errorData = {
        type: EVENT_TYPE.ERROR,
        status: STATUS_CODE.ERROR,
        time: getTimestamp(),
        message: ev.message,
        fileName,
        line: lineNumber,
        column: columnNumber,
      };
      this.breadcrumb.push({
        type: EVENT_TYPE.ERROR,
        category: this.breadcrumb.getCategory(EVENT_TYPE.ERROR),
        data: errorData,
        time: getTimestamp(),
        status: STATUS_CODE.ERROR,
      });
      const hash: string = getErrorUid(
        `${EVENT_TYPE.ERROR}-${ev.message}-${fileName}-${columnNumber}`
      );
      // 开启repeatCodeError第一次报错才上报
      if (
        !this.options.repeatCodeError ||
        (this.options.repeatCodeError && !this.hashMapExist(hash))
      ) {
        return this.reportData.send(errorData as any);
      }
    }

    // 资源加载报错
    if (target?.localName) {
      // 提取资源加载的信息
      const data = resourceTransform(target);
      this.breadcrumb.push({
        type: EVENT_TYPE.RESOURCE,
        category: this.breadcrumb.getCategory(EVENT_TYPE.RESOURCE),
        status: STATUS_CODE.ERROR,
        time: getTimestamp(),
        data,
      });
      return this.reportData.send({
        ...data,
        type: EVENT_TYPE.RESOURCE,
        status: STATUS_CODE.ERROR,
      });
    }
  }
  hashMapExist(hash: string): boolean {
    const exist = this.errorMap?.has(hash);
    if (!exist) {
      this.errorMap?.set(hash, true);
    }
    return exist;
  }
  handleUnhandledRejection(ev: PromiseRejectionEvent): void {
    const stackFrame = ErrorStackParser.parse(ev.reason)[0];
    const { fileName, columnNumber, lineNumber } = stackFrame;
    const message = unknownToString(ev.reason.message || ev.reason.stack);
    const data = {
      type: EVENT_TYPE.UNHANDLEDREJECTION,
      status: STATUS_CODE.ERROR,
      time: getTimestamp(),
      message,
      fileName,
      line: lineNumber,
      column: columnNumber,
    };

    this.breadcrumb.push({
      type: EVENT_TYPE.UNHANDLEDREJECTION,
      category: this.breadcrumb.getCategory(EVENT_TYPE.UNHANDLEDREJECTION),
      time: getTimestamp(),
      status: STATUS_CODE.ERROR,
      data,
    });
    const hash: string = getErrorUid(
      `${EVENT_TYPE.UNHANDLEDREJECTION}-${message}-${fileName}-${columnNumber}`
    );
    // 开启repeatCodeError第一次报错才上报
  }
}

function getErrorUid(str: string): string {
  let hash = 0;
  let i: number, chr: number, len: number;
  if (str.length === 0) return hash.toString();
  for (i = 0, len = str.length; i < len; i++) {
    chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return `${hash}`;
}

export function resourceTransform(target: ResourceTarget): ResourceError {
  return {
    time: getTimestamp(),
    message:
      (interceptStr(target.src as string, 120) ||
        interceptStr(target.href as string, 120)) + "; 资源加载失败",
    name: target.localName as string,
  };
}
export function interceptStr(str: string, interceptLength: number): string {
  if (typeof str === "string") {
    return (
      str.slice(0, interceptLength) +
      (str.length > interceptLength ? `:截取前${interceptLength}个字符` : "")
    );
  }
  return "";
}
export function unknownToString(target: unknown): string {
  if (isString(target)) {
    return target as string;
  }
  if (isUndefined(target)) {
    return "undefined";
  }
  return JSON.stringify(target);
}
