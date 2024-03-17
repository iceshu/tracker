import { Breadcrumb } from "../core/breadcrumb";
import { Global } from "../core/global";
import { IOptionsParams } from "../core/options";
import { ReportDataController } from "../core/report";

export abstract class ReplacePlugin {
  abstract replace(): void;
  abstract setup(): void;
}
export enum HTTP_TYPE {
  XHR = "xhr",
  FETCH = "fetch",
}

export interface IPluginParams {
  breadcrumb: Breadcrumb;
  options: IOptionsParams;
  global: Global;
  reportData: ReportDataController;
}
