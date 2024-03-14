import { Breadcrumb } from "./core/breadcrumb";
import XhrPlugin from "./plugins/xhr_plugin";
import { global } from "./core/global";
import { DomPlugin } from "./plugins";
import { HistoryPlugin } from "./plugins/history_plugin";
import { ErrorPlugin } from "./plugins/error_plugin";
import { ReportDataController } from "./core/report";
const defaultPlugins = [XhrPlugin, DomPlugin, HistoryPlugin, ErrorPlugin];
export const TrackInit = (options: IOptionsParams) => {
  const { maxBreadcrumbs = 20, beforePushBreadcrumb } = options;
  const breadcrumb = new Breadcrumb(maxBreadcrumbs, beforePushBreadcrumb);
  const reportDataController = new ReportDataController(
    maxBreadcrumbs,
    beforePushBreadcrumb
  );
  defaultPlugins.forEach((Plugin) => {
    new Plugin({
      breadcrumb,
      options,
      global,
      reportData: reportDataController,
    });
  });
};
