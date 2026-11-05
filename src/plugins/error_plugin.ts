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
import { ErrorTarget, ISendData, ResourceError, ResourceTarget } from "../core/typing";
import {
  addEventListenerTo,
  getTimestamp,
  isChunkUrl,
  isString,
  isUndefined,
} from "../utils";
import ErrorStackParser from "error-stack-parser";
import { IPluginParams, ReplacePlugin } from "./common";
import { IOptionsParams } from "../typings/options";

// 浏览器对跨域脚本的运行时错误只给出 "Script error."，没有堆栈也没有文件名。
// 这类错误定位不到具体代码，但它是「旧资源 / 脚本没加载到」最直接的现场信号，
// 丢弃它等于让这类崩溃在监控里完全不可见。
const CROSS_ORIGIN_SCRIPT_ERROR = "Script error.";

// window.onerror 的 event、Error 实例、unhandledrejection 的 reason 不是同一个
// 类型，但都可能带 stack。统一按「可能没有 stack」处理，避免依赖类型断言。
export interface ErrorLike {
  stack?: string;
  message?: string;
}

/**
 * 判断资源失败是否属于代码分块（脚本/样式）加载失败
 */
export function isCodeChunkTarget(target: ResourceTarget): boolean {
  if (target.localName !== "script" && target.localName !== "link") return false;
  const url = target.src || target.href || "";
  return isChunkUrl(url);
}

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

  /**
   * 判断这条错误是否需要上报。
   *
   * 去重默认开启（repeatCodeError 未显式配置时按 true 处理）：崩溃统计里
   * 同一个错误反复触发会淹没看板，而且事件会堆积在本地待发队列里被反复补发。
   * 用错误类型 + message + 位置做指纹，同一位置同一消息只报一次。
   */
  private shouldReport(hash: string): boolean {
    const repeat = this.options.repeatCodeError !== false;
    if (!repeat) return true;
    return !this.hashMapExist(hash);
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
  private parseStackTrace(error: ErrorLike): {
    fileName: string;
    columnNumber: number;
    lineNumber: number;
  } {
    const defaults = { fileName: "unknown", columnNumber: 0, lineNumber: 0 };

    if (!error) return defaults;


    try {
      // error-stack-parser 运行时只读取 .stack / .stacktrace，但类型签名要求
      // 完整的 Error。此处按库边界做一次断言，非 Error 对象由上面的 catch 兜底。
      const stackFrame = ErrorStackParser.parse(error as Error)[0];
      if (stackFrame) {
        return {
          fileName: stackFrame.fileName || defaults.fileName,
          columnNumber: stackFrame.columnNumber || defaults.columnNumber,
          lineNumber: stackFrame.lineNumber || defaults.lineNumber,
        };
      }
    } catch {
      // reason 非标准 Error / 无可解析堆栈时(unhandledrejection 常见)静默降级为默认位置，避免污染控制台
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

  handleError(ev: ErrorTarget): Promise<boolean> | undefined {
    const target = ev.target;
    if (!target || (ev.target && !ev.target.localName)) {
      // 跨域脚本的运行时错误（"Script error."）没有堆栈，但它是「旧资源 /
      // 脚本没加载到」最直接的现场信号，不能丢：这里照常上报并标记
      // crossOrigin，让消费端能把「定位不到代码的崩溃」单独归类。
      const isCrossOrigin = ev.message === CROSS_ORIGIN_SCRIPT_ERROR;
      // vue和react捕获的报错使用ev解析，异步错误使用ev.error解析
      const errorObj: ErrorLike = !target ? ev : ev.error;
      const { fileName, columnNumber, lineNumber } =
        this.parseStackTrace(errorObj);

      const errorData: ISendData = {
        type: EVENT_TYPE.ERROR,
        status: STATUS_CODE.ERROR,
        name: "error",
        time: getTimestamp(),
        data: {
          message: ev.message,
          fileName,
          line: lineNumber,
          column: columnNumber,
          // 完整堆栈字符串（含整条调用链与函数名），仅 frame0 不足以定位问题
          stack: errorObj?.stack,
          // 跨域脚本没有堆栈与文件名，据此可判断这条错误无法定位到具体代码
          crossOrigin: isCrossOrigin,
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
      // 去重默认开启，同一位置同一消息只报一次
      if (this.shouldReport(hash)) {
        return this.reportData.send(errorData);
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
      // 代码分块（chunk）加载失败会让页面直接渲染中断，和图片/字体失败不是
      // 一个量级：这类失败按 ERROR 类型上报，单独归到「页面崩溃」口径下，
      // 否则会被当成普通资源噪声淹没。图片等资源仍按 RESOURCE 上报。
      const isChunk = isCodeChunkTarget(target);
      const eventType = isChunk ? EVENT_TYPE.ERROR : EVENT_TYPE.RESOURCE;
      const eventName = isChunk ? "chunkError" : BREADCRUMB_TYPE.RESOURCE;
      this.breadcrumb.push({
        type: eventType,
        category: this.breadcrumb.getCategory(eventType),
        status: STATUS_CODE.ERROR,
        time: getTimestamp(),
        data,
      });
      return this.reportData.send({
        data,
        name: eventName,
        type: eventType,
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
    const reason: ErrorLike = ev.reason;
    const { fileName, columnNumber, lineNumber } = this.parseStackTrace(reason);

    const message = unknownToString(reason?.message || reason?.stack || reason);

    // 与 handleError 对齐：跨域脚本的 rejection 同样只给出 "Script error."。
    // 它定位不到代码，但代表一次确实发生过的崩溃，必须上报并标记 crossOrigin。
    const isCrossOrigin = message === CROSS_ORIGIN_SCRIPT_ERROR;
    const data = {
      type: EVENT_TYPE.UNHANDLEDREJECTION,
      status: STATUS_CODE.ERROR,
      time: getTimestamp(),
      message,
      fileName,
      line: lineNumber,
      column: columnNumber,
      // 与 handleError 对齐：frame0 的 fileName/line/column 只指向 Promise 的
      // 最终拒绝点，定位不到链路上真正抛出的业务代码，缺了堆栈的 rejection
      // 基本无法排查（reason 为非 Error 时本就没有堆栈，保持 undefined）
      stack: reason?.stack,
      // 跨域脚本没有堆栈与文件名，据此可判断这条错误无法定位到具体代码
      crossOrigin: isCrossOrigin,
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
    if (this.shouldReport(hash)) {
      // rejection 事件历史上一直是扁平结构（字段直接挂在顶层，没有 name/data
      // 外壳），消费端已按这个格式解析；这里保持不变，只做一次类型断言。
      this.reportData.send(data as unknown as ISendData);
    }
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
    if (this.shouldReport(hash)) {
      this.reportData.send(errorData);
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
  const url = target.src || target.href || "";
  return {
    time: getTimestamp(),
    message:
      (interceptStr(target.src as string, DEFAULTS.MAX_STRING_LENGTH) ||
        interceptStr(target.href as string, DEFAULTS.MAX_STRING_LENGTH)) +
      "; 资源加载失败",
    name: target.localName as string,
    // 完整地址保留原始值（不截断）：消费端要用它比对构建版本，
    // 截断后的 URL 无法定位是哪个产物失效
    url,
    // 标记代码分块失败：这类失败等于页面渲染中断，是崩溃统计的核心口径
    isChunk: isCodeChunkTarget(target),
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
