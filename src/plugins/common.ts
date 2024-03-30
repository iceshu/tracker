import { Breadcrumb } from "../core/breadcrumb";
import { IOptionsParams } from "../core/options";
import { ReportDataController } from "../core/report";

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
}
