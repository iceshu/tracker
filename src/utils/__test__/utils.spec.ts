import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getTimestamp,
  generateUUID,
  throttle,
  isEmpty,
  isString,
  isUndefined,
  isObject,
  getLocationHref,
  replaceAop,
} from "../index";

describe("Utils Functions", () => {
  describe("getTimestamp", () => {
    it("should return current timestamp", () => {
      const now = Date.now();
      const timestamp = getTimestamp();
      expect(timestamp).toBeGreaterThanOrEqual(now);
      expect(timestamp).toBeLessThanOrEqual(Date.now());
    });

    it("should return number type", () => {
      expect(typeof getTimestamp()).toBe("number");
    });
  });

  describe("generateUUID", () => {
    it("should generate valid UUID format", () => {
      const uuid = generateUUID();
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(uuid)).toBe(true);
    });

    it("should generate unique UUIDs", () => {
      const uuid1 = generateUUID();
      const uuid2 = generateUUID();
      expect(uuid1).not.toBe(uuid2);
    });

    it("should always have version 4", () => {
      const uuid = generateUUID();
      expect(uuid.charAt(14)).toBe("4");
    });
  });

  describe("throttle", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should throttle function calls", () => {
      const mockFn = vi.fn();
      const throttledFn = throttle(mockFn, 100);

      // 快速调用多次
      throttledFn();
      throttledFn();
      throttledFn();

      // 只应该执行一次
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should allow execution after delay", () => {
      const mockFn = vi.fn();
      const throttledFn = throttle(mockFn, 100);

      throttledFn();
      expect(mockFn).toHaveBeenCalledTimes(1);

      // 快进时间
      vi.advanceTimersByTime(100);

      throttledFn();
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it("should preserve function arguments", () => {
      const mockFn = vi.fn();
      const throttledFn = throttle(mockFn, 100);

      throttledFn("arg1", "arg2");
      expect(mockFn).toHaveBeenCalledWith("arg1", "arg2");
    });
  });

  describe("isEmpty", () => {
    it("should return true for null and undefined", () => {
      expect(isEmpty(null)).toBe(true);
      expect(isEmpty(undefined)).toBe(true);
    });

    it("should return true for empty objects", () => {
      expect(isEmpty({})).toBe(true);
    });

    it("should return true for empty arrays", () => {
      expect(isEmpty([])).toBe(true);
    });

    it("should return true for empty strings", () => {
      expect(isEmpty("")).toBe(true);
      expect(isEmpty("   ")).toBe(true);
    });

    it("should return false for non-empty values", () => {
      expect(isEmpty("hello")).toBe(false);
      expect(isEmpty({ key: "value" })).toBe(false);
      expect(isEmpty([1, 2, 3])).toBe(false);
      expect(isEmpty(0)).toBe(false);
      expect(isEmpty(false)).toBe(false);
    });
  });

  describe("isString", () => {
    it("should return true for strings", () => {
      expect(isString("hello")).toBe(true);
      expect(isString("")).toBe(true);
      expect(isString(String("test"))).toBe(true);
    });

    it("should return false for non-strings", () => {
      expect(isString(123)).toBe(false);
      expect(isString(null)).toBe(false);
      expect(isString(undefined)).toBe(false);
      expect(isString({})).toBe(false);
      expect(isString([])).toBe(false);
    });
  });

  describe("isUndefined", () => {
    it("should return true for undefined", () => {
      expect(isUndefined(undefined)).toBe(true);
    });

    it("should return false for defined values", () => {
      expect(isUndefined(null)).toBe(false);
      expect(isUndefined("")).toBe(false);
      expect(isUndefined(0)).toBe(false);
      expect(isUndefined(false)).toBe(false);
    });
  });

  describe("isObject", () => {
    it("should return true for plain objects", () => {
      expect(isObject({})).toBe(true);
      expect(isObject({ key: "value" })).toBe(true);
    });

    it("should return false for non-objects", () => {
      expect(isObject(null)).toBe(false);
      expect(isObject(undefined)).toBe(false);
      expect(isObject([])).toBe(false);
      expect(isObject("string")).toBe(false);
      expect(isObject(123)).toBe(false);
    });
  });

  describe("getLocationHref", () => {
    it("should return empty string when document is undefined", () => {
      // 模拟服务端环境
      const originalDocument = global.document;
      // @ts-ignore
      delete global.document;

      expect(getLocationHref()).toBe("");

      // 恢复
      global.document = originalDocument;
    });

    it("should return current location href in browser environment", () => {
      // 在测试环境中，happy-dom 会提供 document
      const href = getLocationHref();
      expect(typeof href).toBe("string");
    });
  });

  describe("replaceAop", () => {
    it("should replace method on object", () => {
      const obj = {
        method: vi.fn(() => "original"),
      };

      const replacement = (original: Function) => {
        return function (...args: any[]) {
          return "replaced-" + original.apply(this, args);
        };
      };

      replaceAop(obj, "method", replacement);

      expect(obj.method()).toBe("replaced-original");
    });

    it("should handle non-existent methods when forced", () => {
      const obj = {};

      const replacement = () => {
        return function () {
          return "new-method";
        };
      };

      replaceAop(obj, "newMethod", replacement, true);

      // @ts-ignore
      expect(obj.newMethod()).toBe("new-method");
    });

    it("should not replace non-existent methods when not forced", () => {
      const obj = {};

      const replacement = () => {
        return function () {
          return "new-method";
        };
      };

      replaceAop(obj, "newMethod", replacement, false);

      // @ts-ignore
      expect(obj.newMethod).toBeUndefined();
    });

    it("should handle undefined source", () => {
      expect(() => {
        replaceAop(undefined, "method", () => {});
      }).not.toThrow();
    });
  });
});
