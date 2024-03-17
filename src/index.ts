import { Breadcrumb } from "./core/breadcrumb";
import RequestPlugin from "./plugins/request_plugin";
import { global } from "./core/global";
import {
  DomPlugin,
  ConsolePlugin,
  HistoryPlugin,
  ErrorPlugin,
} from "./plugins";
import { ReportDataController } from "./core/report";
const defaultPlugins = [
  RequestPlugin,
  DomPlugin,
  HistoryPlugin,
  ErrorPlugin,
  ConsolePlugin,
];
export const TrackInit = (options: IOptionsParams) => {
  const { maxBreadcrumbs = 20, beforePushBreadcrumb, dns } = options;
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
  return {};
};
