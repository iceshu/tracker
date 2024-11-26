import { Breadcrumb } from "../core/breadcrumb";
import { ReportDataController } from "../core/report";
import { IOptionsParams } from "../typings/options";

export abstract class ReplacePlugin {
  abstract name: string;
}


export enum HTTP_TYPE {
  XHR = "xhr",
  FETCH = "fetch",
}

export interface IPluginParams {
  breadcrumb: Breadcrumb;
  options: IOptionsParams;
  reportData: ReportDataController;
  baseDeviceInfo?: any;
  setBaseDeviceInfo?: any;
}
