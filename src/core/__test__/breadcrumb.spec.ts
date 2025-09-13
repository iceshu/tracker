import { describe, it, expect, beforeEach, vi } from "vitest";
import { Breadcrumb } from "../breadcrumb";
import {
  EVENT_TYPE,
  BREADCRUMB_TYPE,
  STATUS_CODE,
  DEFAULTS,
} from "../constant";
import { BreadcrumbData } from "../typing";

describe("Breadcrumb", () => {
  let breadcrumb: Breadcrumb;

  beforeEach(() => {
    vi.useFakeTimers();
    breadcrumb = new Breadcrumb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(breadcrumb.maxBreadcrumbs).toBe(DEFAULTS.MAX_BREADCRUMBS);
      expect(breadcrumb.getStack()).toEqual([]);
    });

    it("should accept custom max breadcrumbs", () => {
      const customBreadcrumb = new Breadcrumb(10);
      expect(customBreadcrumb.maxBreadcrumbs).toBe(10);
    });

    it("should accept beforePushCallback", () => {
      const callback = vi.fn((data: BreadcrumbData) => data);
      const customBreadcrumb = new Breadcrumb(20, callback);

      const testData: BreadcrumbData = {
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { test: "data" },
        time: 1000,
        status: STATUS_CODE.OK,
      };

      customBreadcrumb.push(testData);
      expect(callback).toHaveBeenCalledWith(testData);
    });
  });

  describe("push", () => {
    it("should add breadcrumb to stack", () => {
      const data: BreadcrumbData = {
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button" },
        time: 1000,
        status: STATUS_CODE.OK,
      };

      breadcrumb.push(data);
      expect(breadcrumb.getStack()).toHaveLength(1);
      expect(breadcrumb.getStack()[0]).toEqual(data);
    });

    it("should auto-generate timestamp if not provided", () => {
      vi.setSystemTime(new Date("2023-01-01T00:00:00.000Z"));

      const data: BreadcrumbData = {
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button" },
        status: STATUS_CODE.OK,
      };

      breadcrumb.push(data);
      const stack = breadcrumb.getStack();
      expect(stack[0].time).toBe(1672531200000);
    });

    it("should maintain chronological order", () => {
      const data1: BreadcrumbData = {
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button1" },
        time: 3000,
        status: STATUS_CODE.OK,
      };

      const data2: BreadcrumbData = {
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button2" },
        time: 1000,
        status: STATUS_CODE.OK,
      };

      const data3: BreadcrumbData = {
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button3" },
        time: 2000,
        status: STATUS_CODE.OK,
      };

      breadcrumb.push(data1);
      breadcrumb.push(data2);
      breadcrumb.push(data3);

      const stack = breadcrumb.getStack();
      expect(stack[0].time).toBe(1000);
      expect(stack[1].time).toBe(2000);
      expect(stack[2].time).toBe(3000);
    });

    it("should respect max breadcrumbs limit", () => {
      const smallBreadcrumb = new Breadcrumb(2);

      for (let i = 0; i < 5; i++) {
        smallBreadcrumb.push({
          type: EVENT_TYPE.CLICK,
          category: BREADCRUMB_TYPE.CLICK,
          data: { index: i },
          time: i * 1000,
          status: STATUS_CODE.OK,
        });
      }

      expect(smallBreadcrumb.getStack()).toHaveLength(2);
      // 应该保留最新的两个
      expect(smallBreadcrumb.getStack()[0].data.index).toBe(3);
      expect(smallBreadcrumb.getStack()[1].data.index).toBe(4);
    });

    it("should call beforePushCallback and use its result", () => {
      const callback = vi.fn((data: BreadcrumbData) => ({
        ...data,
        data: { ...data.data, modified: true },
      }));

      const customBreadcrumb = new Breadcrumb(20, callback);

      const originalData: BreadcrumbData = {
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button" },
        time: 1000,
        status: STATUS_CODE.OK,
      };

      customBreadcrumb.push(originalData);

      const stack = customBreadcrumb.getStack();
      expect(stack[0].data.modified).toBe(true);
      expect(callback).toHaveBeenCalledWith(originalData);
    });

    it("should not add breadcrumb if callback returns null", () => {
      const callback = vi.fn(() => null);
      const customBreadcrumb = new Breadcrumb(20, callback);

      customBreadcrumb.push({
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button" },
        time: 1000,
        status: STATUS_CODE.OK,
      });

      expect(customBreadcrumb.getStack()).toHaveLength(0);
    });
  });

  describe("getCategory", () => {
    it("should return correct category for HTTP events", () => {
      expect(breadcrumb.getCategory(EVENT_TYPE.XHR)).toBe(BREADCRUMB_TYPE.HTTP);
      expect(breadcrumb.getCategory(EVENT_TYPE.FETCH)).toBe(
        BREADCRUMB_TYPE.HTTP
      );
    });

    it("should return correct category for click events", () => {
      expect(breadcrumb.getCategory(EVENT_TYPE.CLICK)).toBe(
        BREADCRUMB_TYPE.CLICK
      );
    });

    it("should return correct category for route events", () => {
      expect(breadcrumb.getCategory(EVENT_TYPE.HISTORY)).toBe(
        BREADCRUMB_TYPE.ROUTE
      );
      expect(breadcrumb.getCategory(EVENT_TYPE.HASHCHANGE)).toBe(
        BREADCRUMB_TYPE.ROUTE
      );
    });

    it("should return correct category for resource events", () => {
      expect(breadcrumb.getCategory(EVENT_TYPE.RESOURCE)).toBe(
        BREADCRUMB_TYPE.RESOURCE
      );
    });

    it("should return correct category for error events", () => {
      expect(breadcrumb.getCategory(EVENT_TYPE.ERROR)).toBe(
        BREADCRUMB_TYPE.CODE_ERROR
      );
      expect(breadcrumb.getCategory(EVENT_TYPE.UNHANDLEDREJECTION)).toBe(
        BREADCRUMB_TYPE.CODE_ERROR
      );
    });

    it("should return correct category for console events", () => {
      expect(breadcrumb.getCategory(EVENT_TYPE.CONSOLE)).toBe(
        BREADCRUMB_TYPE.CONSOLE
      );
    });

    it("should return CUSTOM for unknown events", () => {
      // @ts-ignore - 测试未知事件类型
      expect(breadcrumb.getCategory("UNKNOWN_EVENT")).toBe(
        BREADCRUMB_TYPE.CUSTOM
      );
    });
  });

  describe("clear", () => {
    it("should clear all breadcrumbs", () => {
      breadcrumb.push({
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button" },
        time: 1000,
        status: STATUS_CODE.OK,
      });

      expect(breadcrumb.getStack()).toHaveLength(1);
      breadcrumb.clear();
      expect(breadcrumb.getStack()).toHaveLength(0);
    });
  });

  describe("shift", () => {
    it("should remove first breadcrumb and return true", () => {
      breadcrumb.push({
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button1" },
        time: 1000,
        status: STATUS_CODE.OK,
      });

      breadcrumb.push({
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button2" },
        time: 2000,
        status: STATUS_CODE.OK,
      });

      expect(breadcrumb.getStack()).toHaveLength(2);
      const result = breadcrumb.shift();

      expect(result).toBe(true);
      expect(breadcrumb.getStack()).toHaveLength(1);
      expect(breadcrumb.getStack()[0].data.element).toBe("button2");
    });

    it("should return false when stack is empty", () => {
      const result = breadcrumb.shift();
      expect(result).toBe(false);
    });
  });

  describe("findInsertIndex", () => {
    it("should find correct insert position for binary search", () => {
      // 添加一些有序的数据
      breadcrumb.push({
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button1" },
        time: 1000,
        status: STATUS_CODE.OK,
      });

      breadcrumb.push({
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button2" },
        time: 3000,
        status: STATUS_CODE.OK,
      });

      // 插入时间为2000的项，应该插入到索引1的位置
      breadcrumb.push({
        type: EVENT_TYPE.CLICK,
        category: BREADCRUMB_TYPE.CLICK,
        data: { element: "button3" },
        time: 2000,
        status: STATUS_CODE.OK,
      });

      const stack = breadcrumb.getStack();
      expect(stack[0].time).toBe(1000);
      expect(stack[1].time).toBe(2000);
      expect(stack[2].time).toBe(3000);
    });
  });
});
