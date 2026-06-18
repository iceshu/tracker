import { IOptionsParams } from "../typings/options";
import { Breadcrumb } from "./breadcrumb";
import { ReportDataController } from "./report";
import { BasePlugin } from "../typings/base";
import { PLUGIN_TYPE } from "./constant";

export const _global = window;

type ErrorCapturePlugin = BasePlugin & {
  handleError?(err: Error): void;
  handleReactError?(
    error: Error,
    errorInfo?: { componentStack?: string; digest?: string }
  ): void;
};

// 设备信息类型定义
export interface DeviceInfo {
  browserVersion?: string;
  browser?: string;
  osVersion?: string;
  os?: string;
  ua: string;
  device: string;
  device_type: string;
}

export class Global {
  static deviceInfo: DeviceInfo;
  static breadcrumb?: Breadcrumb;
  static options?: IOptionsParams;
  static plugins: BasePlugin[];
  static reportData: ReportDataController;

  static errorBoundary(err: Error) {
    const errorPlugin = this.plugins?.find(
      (item) => item.name === PLUGIN_TYPE.ERROR_PLUGIN
    ) as ErrorCapturePlugin | undefined;
    errorPlugin?.handleError?.(err);
  }

  static captureReactError(
    error: Error,
    errorInfo?: { componentStack?: string; digest?: string }
  ) {
    const errorPlugin = this.plugins?.find(
      (item) => item.name === PLUGIN_TYPE.ERROR_PLUGIN
    ) as ErrorCapturePlugin | undefined;
    errorPlugin?.handleReactError?.(error, errorInfo);
  }
}
