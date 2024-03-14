import { Breadcrumb } from "../core/breadcrumb";
import { EVENT_TYPE, STATUS_CODE } from "../core/constant";
import { Global, global } from "../core/global";
import { ReportDataController } from "../core/report";
import { ErrorTarget, ResourceError, ResourceTarget } from "../core/typing";
import { addEventListenerTo, getTimestamp } from "../utils";
import ErrorStackParser from "error-stack-parser";
import { IPluginParams } from "./common";

export class ErrorPlugin {
  global: Global;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  constructor(params: IPluginParams) {
    const { global, options, breadcrumb, reportData } = params;
    this.global = global;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.listenError();
  }
  listenError(): void {
    addEventListenerTo(
      this.global._global,
      "error",
      (e) => {
        debugger;
        console.log(e);
      },
      true
    );
  }
  handleData(data: any) {}

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
        (this.options.repeatCodeError && !hashMapExist(hash))
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
function hashMapExist(hash: string): boolean {
  const exist = global.errorMap?.has(hash);
  if (!exist) {
    global.errorMap?.set(hash, true);
  }
  return exist;
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
