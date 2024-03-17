import { Breadcrumb } from "./core/breadcrumb";
import { global } from "./core/global";
import {
  DomPlugin,
  ConsolePlugin,
  HistoryPlugin,
  ErrorPlugin,
  PerformancePlugin,
  VuePlugin,
  RequestPlugin,
} from "./plugins";
import { ReportDataController } from "./core/report";
import { readonly } from "./utils";
import { IOptionsParams } from "./core/options";
const defaultPlugins: any = [
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
  const { maxBreadcrumbs = 20, beforePushBreadcrumb } = options;
  const breadcrumb = new Breadcrumb(maxBreadcrumbs, beforePushBreadcrumb);
  const reportDataController = new ReportDataController({
    breadcrumb,
    options,
    global,
  });
  global.options = options;
  global.breadcrumb = breadcrumb;
  global.reportData = reportDataController;
  if (options.vue) {
    defaultPlugins.push(VuePlugin);
  }
  const PluginPrams = {
    breadcrumb,
    options,
    global,
    reportData: reportDataController,
  };
  defaultPlugins.forEach((Plugin: any) => {
    new Plugin(PluginPrams);
  });
  GLOBAL.__TRACK__ = PluginPrams;
  return global;
};
