import { IOptionsParams } from "../typings/options";
import { Breadcrumb } from "./breadcrumb";
import { ReportDataController } from "./report";
import { BasePlugin } from "../typings/base";

export const _global = window;

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
      (item: { name: string }) => item.name === "ERROR_PLUGIN"
    );
    errorPlugin?.handleError(err);
  }
}
