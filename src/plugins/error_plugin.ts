import { Breadcrumb } from "../core/breadcrumb";
import {
  BREADCRUMB_TYPE,
  EVENT_TYPE,
  PLUGIN_TYPE,
  STATUS_CODE,
  DEFAULTS,
} from "../core/constant";
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
import { IOptionsParams } from "../typings/options";

export class ErrorPlugin implements ReplacePlugin {
  name = PLUGIN_TYPE.ERROR_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  errorMap: Map<string, boolean> = new Map();
  private errorHandler = (e: any) => this.handleError(e);
  private rejectionHandler = (e: any) => this.handleUnhandledRejection(e);
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
    this.isSetup = true;
    this.listenError();
    this.listenUnHandledRejection();
  }

  /**
   * 解析错误堆栈信息
   * @param error 错误对象
   * @returns 包含文件名、行号、列号的对象
   */
  private parseStackTrace(error: Error): {
    fileName: string;
    columnNumber: number;
    lineNumber: number;
  } {
    const defaults = { fileName: "unknown", columnNumber: 0, lineNumber: 0 };

    try {
      const stackFrame = ErrorStackParser.parse(error)[0];
      if (stackFrame) {
        return {
          fileName: stackFrame.fileName || defaults.fileName,
          columnNumber: stackFrame.columnNumber || defaults.columnNumber,
          lineNumber: stackFrame.lineNumber || defaults.lineNumber,
        };
      }
    } catch (parseError) {
      console.warn("ErrorStackParser failed to parse stack:", parseError);
    }

    return defaults;
  }
  listenError(): void {
    addEventListenerTo(_global, EVENT_TYPE.ERROR, this.errorHandler, true);
  }
  listenUnHandledRejection() {
    addEventListenerTo(
      _global,
      EVENT_TYPE.UNHANDLEDREJECTION,
      this.rejectionHandler,
      true
    );
  }

  handleError(ev: ErrorTarget): any {
    const target = ev.target;
    if (!target || (ev.target && !ev.target.localName)) {
      // 过滤跨域脚本错误（Script error.），这类错误无堆栈信息，上报无意义
      if (ev.message === "Script error.") {
        return;
      }
      // vue和react捕获的报错使用ev解析，异步错误使用ev.error解析
      const { fileName, columnNumber, lineNumber } = this.parseStackTrace(
        !target ? (ev as any) : ev.error
      );

      const errorData = {
        type: EVENT_TYPE.ERROR,
        status: STATUS_CODE.ERROR,
        name: "error",
        time: getTimestamp(),
        data: {
          message: ev.message,
          fileName,
          line: lineNumber,
          column: columnNumber,
        },
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
      const { skipLocalName } = this.options;
      // 提取资源加载的信息
      if (skipLocalName?.(target)) {
        return;
      }
      const data = resourceTransform(target);
      this.breadcrumb.push({
        type: EVENT_TYPE.RESOURCE,
        category: this.breadcrumb.getCategory(EVENT_TYPE.RESOURCE),
        status: STATUS_CODE.ERROR,
        time: getTimestamp(),
        data,
      });
      return this.reportData.send({
        data,
        name: BREADCRUMB_TYPE.RESOURCE,
        type: EVENT_TYPE.RESOURCE,
        status: STATUS_CODE.ERROR,
        time: getTimestamp(),
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
    const reason = ev.reason;
    const { fileName, columnNumber, lineNumber } = this.parseStackTrace(reason);

    const message = unknownToString(reason?.message || reason?.stack || reason);

    // 过滤跨域脚本错误（Script error.）
    if (message === "Script error.") {
      return;
    }
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
    if (
      !this.options.repeatCodeError ||
      (this.options.repeatCodeError && !this.hashMapExist(hash))
    ) {
      this.reportData.send(data as any);
    }

    // 开启repeatCodeError第一次报错才上报
  }

  /**
   * React/Next 错误边界专用上报：携带组件栈与 digest，
   * 供 error.tsx / global-error.tsx 手动调用（这类渲染错误不会冒泡到 window error）
   */
  handleReactError(
    error: Error,
    errorInfo?: { componentStack?: string; digest?: string }
  ): void {
    if (!error) return;
    const { fileName, columnNumber, lineNumber } = this.parseStackTrace(error);
    const errorData = {
      type: EVENT_TYPE.ERROR,
      status: STATUS_CODE.ERROR,
      name: "react",
      time: getTimestamp(),
      data: {
        message: error.message,
        fileName,
        line: lineNumber,
        column: columnNumber,
        stack: error.stack,
        componentStack: errorInfo?.componentStack,
        digest: errorInfo?.digest,
      },
    };
    this.breadcrumb.push({
      type: EVENT_TYPE.ERROR,
      category: this.breadcrumb.getCategory(EVENT_TYPE.ERROR),
      data: errorData,
      time: getTimestamp(),
      status: STATUS_CODE.ERROR,
    });
    const hash: string = getErrorUid(
      `${EVENT_TYPE.ERROR}-react-${error.message}-${fileName}-${columnNumber}`
    );
    if (
      !this.options.repeatCodeError ||
      (this.options.repeatCodeError && !this.hashMapExist(hash))
    ) {
      this.reportData.send(errorData as any);
    }
  }

  destroy(): void {
    _global.removeEventListener(EVENT_TYPE.ERROR, this.errorHandler, true);
    _global.removeEventListener(
      EVENT_TYPE.UNHANDLEDREJECTION,
      this.rejectionHandler,
      true
    );
    this.errorMap.clear();
    this.isSetup = false;
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
      (interceptStr(target.src as string, DEFAULTS.MAX_STRING_LENGTH) ||
        interceptStr(target.href as string, DEFAULTS.MAX_STRING_LENGTH)) +
      "; 资源加载失败",
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
