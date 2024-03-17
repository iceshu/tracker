import { Breadcrumb } from "./core/breadcrumb";
import RequestPlugin from "./plugins/request_plugin";
import { global } from "./core/global";
import {
  DomPlugin,
  ConsolePlugin,
  HistoryPlugin,
  ErrorPlugin,
  PerformancePlugin,
} from "./plugins";
import { ReportDataController } from "./core/report";
import { readonly } from "./utils";
const defaultPlugins = [
  RequestPlugin,
  DomPlugin,
  HistoryPlugin,
  ErrorPlugin,
  ConsolePlugin,
  PerformancePlugin,
];
const GLOBAL: any = window;
export const TrackInit = (rawOptions: IOptionsParams) => {
  const options = readonly(rawOptions);
  global.options = options;
  const { maxBreadcrumbs = 20, beforePushBreadcrumb } = options;
  const breadcrumb = new Breadcrumb(maxBreadcrumbs, beforePushBreadcrumb);
  const reportDataController = new ReportDataController({
    breadcrumb,
    options,
    global,
  });
  global.breadcrumb = breadcrumb;
  global.reportData = reportDataController;
  const PluginPrams = {
    breadcrumb,
    options,
    global,
    reportData: reportDataController,
  };
  defaultPlugins.forEach((Plugin) => {
    new Plugin(PluginPrams);
  });
  GLOBAL.__TRACK__ = PluginPrams;
  return global;
};
