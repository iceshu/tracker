import { Breadcrumb } from "../core/breadcrumb";
import {
  BREADCRUMB_TYPE,
  EVENT_TYPE,
  PLUGIN_TYPE,
  STATUS_CODE,
  DEFAULTS,
} from "../core/constant";
import { Global, _global } from "../core/global";
import { ReportDataController } from "../core/report";
import { IOptionsParams } from "../typings/options";
import { getTimestamp, htmlElementAsString, throttle } from "../utils";
import { IPluginParams, ReplacePlugin } from "./common";
import { UAParser } from "ua-parser-js";

export class DomPlugin implements ReplacePlugin {
  name = PLUGIN_TYPE.DOM_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  private clickHandler: ((event: MouseEvent) => void) | null = null;

  constructor(params: IPluginParams) {
    const { options, breadcrumb, reportData } = params;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.setup();
  }

  setup() {
    this.initDeviceInfo();
    this.replace();
  }

  initDeviceInfo() {
    const uaResult = new UAParser().getResult();
    const deviceInfo = {
      browserVersion: uaResult.browser.version,
      browser: uaResult.browser.name,
      osVersion: uaResult.os.version,
      os: uaResult.os.name,
      ua: uaResult.ua,
      device: uaResult.device.model ? uaResult.device.model : "Unknown",
      device_type: uaResult.device.type ? uaResult.device.type : "Pc",
    };
    Global.deviceInfo = deviceInfo;
  }

  private handleClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const { wrapElementCallback } = this.options;
    if (!target) return;

    // 获取事件触发路径
    const path = event.composedPath?.() as HTMLElement[];
    if (!path?.length) return;

    // 查找最近的可交互元素
    const interactiveElement = path.find((element) => {
      if (element instanceof HTMLElement) {
        // 检查是否是可交互元素
        return this.isInteractiveElement(element);
      }
      return false;
    });

    const elementToTrack = interactiveElement || target;
    wrapElementCallback?.(elementToTrack);
    if (elementToTrack instanceof HTMLElement) {
      this.recordClick(elementToTrack, event);
    }
  };

  private isInteractiveElement(element: HTMLElement): boolean {
    // 检查元素是否是可交互的
    const interactiveTags = ["a", "button", "input", "select", "textarea"];
    const interactiveRoles = [
      "button",
      "link",
      "menuitem",
      "tab",
      "checkbox",
      "radio",
    ];

    const elementRole = element.getAttribute("role");

    return !!(
      interactiveTags.includes(element.tagName.toLowerCase()) ||
      (elementRole !== null && interactiveRoles.includes(elementRole)) ||
      element.onclick !== null ||
      element.getAttribute("onClick") !== null ||
      element.hasAttribute("data-clickable") ||
      (element.className && /(?:btn|button|clickable)/i.test(element.className))
    );
  }

  private getElementIdentifiers(element: HTMLElement) {
    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id || undefined,
      className: element.className || undefined,
      textContent:
        element.textContent
          ?.trim()
          .slice(0, DEFAULTS.MAX_TEXT_CONTENT_LENGTH) || undefined,
      href: element instanceof HTMLAnchorElement ? element.href : undefined,
      type: element.getAttribute("type") || undefined,
      name: element.getAttribute("name") || undefined,
      value: element instanceof HTMLInputElement ? element.value : undefined,
      dataAttributes: this.getDataAttributes(element),
    };
  }

  private getDataAttributes(element: HTMLElement) {
    const dataAttrs: Record<string, string> = {};
    Array.from(element.attributes).forEach((attr) => {
      if (attr.name.startsWith("data-")) {
        dataAttrs[attr.name] = attr.value;
      }
    });
    return Object.keys(dataAttrs).length > 0 ? dataAttrs : undefined;
  }

  private recordClick(element: HTMLElement, event: MouseEvent) {
    const elementInfo = this.getElementIdentifiers(element);
    const htmlString = htmlElementAsString(element);
    if (!htmlString) {
      return;
    }
    this.breadcrumb.push({
      type: EVENT_TYPE.CLICK,
      category: BREADCRUMB_TYPE.CLICK,
      data: {
        element: htmlString,
        info: elementInfo,
        position: {
          x: event.clientX,
          y: event.clientY,
          pageX: event.pageX,
          pageY: event.pageY,
        },
      },
      time: getTimestamp(),
      status: STATUS_CODE.OK,
    });
  }

  replace(): void {
    if (!("document" in _global)) return;

    this.clickHandler = throttle(
      this.handleClick,
      this.options.throttleDelayTime || DEFAULTS.THROTTLE_DELAY
    );

    // 使用 useCapture 为 true 确保在事件冒泡之前捕获事件，可以捕获所有元素的点击，包括动态添加的元素
    _global.document.addEventListener("click", this.clickHandler, true);
  }

  destroy(): void {
    if ("document" in _global && this.clickHandler) {
      _global.document.removeEventListener("click", this.clickHandler, true);
      this.clickHandler = null;
    }
  }
}
