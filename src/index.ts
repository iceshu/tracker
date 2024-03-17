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
const defaultPlugins = [
  RequestPlugin,
  DomPlugin,
  HistoryPlugin,
  ErrorPlugin,
  ConsolePlugin,
  PerformancePlugin,
];
const GLOBAL: any = window;
export const TrackInit = (options: IOptionsParams) => {
  global.version = options?.version;
  const { maxBreadcrumbs = 20, beforePushBreadcrumb } = options;
  const breadcrumb = new Breadcrumb(maxBreadcrumbs, beforePushBreadcrumb);
  const reportDataController = new ReportDataController({
    breadcrumb,
    options,
    global,
  });
  const PluginPrams = {
    breadcrumb,
    options,
    global,
    reportData: reportDataController,
  };
  defaultPlugins.forEach((Plugin) => {
    new Plugin(PluginPrams);
  });
  GLOBAL.__TRACK__ = {
    breadcrumb,
    options,
    global,
    reportData: reportDataController,
  };
  return {
    reportData: reportDataController,
    breadcrumb,
  };
};
