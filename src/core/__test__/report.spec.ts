import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ReportDataController } from "../report";
import { Breadcrumb } from "../breadcrumb";
import { EVENT_TYPE, SDK } from "../constant";
import { IOptionsParams } from "../../typings/options";
import { ISendData, ReportData } from "../typing";

// Mock dependencies
vi.mock("../queue");
vi.mock("../breadcrumb");
vi.mock("../../utils", () => ({
  generateUUID: vi.fn().mockReturnValue("test-uuid-123"),
  getLocationHref: vi.fn().mockReturnValue("https://example.com/page"),
  isEmpty: vi.fn().mockImplementation((value) => !value),
}));
vi.mock("../global", () => ({
  Global: {
    deviceInfo: {
      browser: "Chrome",
      os: "Windows",
    },
  },
}));
vi.mock("../session-manager", () => ({
  SessionManager: {
    getSessionId: vi.fn().mockReturnValue("session-456"),
  },
}));

describe("ReportDataController", () => {
  let reportController: ReportDataController;
  let mockBreadcrumb: vi.Mocked<Breadcrumb>;
  let mockOptions: IOptionsParams;

  beforeEach(async () => {
    // 确保 mock 正确应用
    const utils = await import("../../utils");
    vi.mocked(utils.generateUUID).mockReturnValue("test-uuid-123");
    vi.mocked(utils.getLocationHref).mockReturnValue(
      "https://example.com/page"
    );
    vi.mocked(utils.isEmpty).mockImplementation((value) => !value);

    const { Global } = await import("../global");
    Global.deviceInfo = {
      browser: "Chrome",
      os: "Windows",
    };

    const { SessionManager } = await import("../session-manager");
    vi.mocked(SessionManager.getSessionId).mockReturnValue("session-456");

    mockBreadcrumb = {
      getStack: vi.fn().mockReturnValue([]),
    } as any;

    mockOptions = {
      dsn: "https://api.example.com/report",
      apikey: "test-api-key",
      appVersion: "1.0.0",
      getUserId: vi.fn().mockReturnValue("user-123"),
      beforeDataReport: vi.fn().mockImplementation((data) => data),
    } as IOptionsParams;

    reportController = new ReportDataController({
      options: mockOptions,
      breadcrumb: mockBreadcrumb,
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with correct properties", () => {
      expect(reportController.dsn).toBe("https://api.example.com/report");
      expect(reportController.apikey).toBe("test-api-key");
      expect(reportController.uuid).toBe("test-uuid-123");
      expect(reportController.breadcrumb).toBe(mockBreadcrumb);
      expect(reportController.options).toBe(mockOptions);
    });

    it("should handle missing optional properties", () => {
      const minimalOptions = {
        dsn: "https://api.example.com/report",
      } as IOptionsParams;

      const controller = new ReportDataController({
        options: minimalOptions,
        breadcrumb: mockBreadcrumb,
      });

      expect(controller.apikey).toBe("");
      expect(controller.getUserId).toBeUndefined();
    });
  });

  describe("getAuthId", () => {
    it("should return user ID from getUserId function", () => {
      const result = reportController.getAuthId();
      expect(result).toBe("user-123");
      expect(mockOptions.getUserId).toHaveBeenCalled();
    });

    it("should return empty string if getUserId is not a function", () => {
      reportController.getUserId = "not-a-function";
      const result = reportController.getAuthId();
      expect(result).toBe("");
    });

    it("should handle getUserId returning invalid type", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      reportController.getUserId = vi
        .fn()
        .mockReturnValue({ invalid: "object" });

      const result = reportController.getAuthId();

      expect(result).toBe("");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "userId: [object Object] 期望 string 或 number 类型，但是传入 object"
        )
      );

      consoleSpy.mockRestore();
    });

    it("should accept number type user ID", () => {
      reportController.getUserId = vi.fn().mockReturnValue(12345);
      const result = reportController.getAuthId();
      expect(result).toBe(12345);
    });
  });

  describe("getTransportData", () => {
    it("should add common information to data", () => {
      const inputData = {
        type: EVENT_TYPE.ERROR,
        message: "Test error",
      };

      const result = reportController.getTransportData(inputData);

      expect(result).toEqual(
        expect.objectContaining({
          type: EVENT_TYPE.ERROR,
          message: "Test error",
          uuid: "test-uuid-123",
          appVersion: "1.0.0",
          pageUrl: "https://example.com/page",
          sessionID: "session-456",
          breadcrumb: [],
          userInfo: expect.objectContaining({
            userId: "user-123",
            sdkVersion: SDK.VERSION,
            apikey: "test-api-key",
          }),
          deviceInfo: expect.objectContaining({
            browser: "Chrome",
            os: "Windows",
          }),
        })
      );
    });

    it("should exclude breadcrumb for performance events", () => {
      const performanceData = {
        type: EVENT_TYPE.PERFORMANCE,
        name: "performance-metric",
      };

      const result = reportController.getTransportData(performanceData);

      expect(result.breadcrumb).toBeUndefined();
    });

    it("should exclude breadcrumb for record screen events", () => {
      const recordData = {
        type: EVENT_TYPE.RECORDSCREEN,
        data: "screen-data",
      };

      const result = reportController.getTransportData(recordData);

      expect(result.breadcrumb).toBeUndefined();
    });

    it("should include breadcrumb for other event types", () => {
      mockBreadcrumb.getStack.mockReturnValue([
        { type: EVENT_TYPE.CLICK, data: "click-data" },
      ] as any);

      const errorData = {
        type: EVENT_TYPE.ERROR,
        message: "Test error",
      };

      const result = reportController.getTransportData(errorData);

      expect(result.breadcrumb).toEqual([
        { type: EVENT_TYPE.CLICK, data: "click-data" },
      ]);
    });
  });

  describe("isSdkTransportUrl", () => {
    it("should return true for SDK transport URL", () => {
      const result = reportController.isSdkTransportUrl(
        "https://api.example.com/report/endpoint"
      );
      expect(result).toBe(true);
    });

    it("should return false for non-SDK URL", () => {
      const result = reportController.isSdkTransportUrl(
        "https://other-api.com/endpoint"
      );
      expect(result).toBe(false);
    });

    it("should return false when dsn is empty", () => {
      reportController.dsn = "";
      const result = reportController.isSdkTransportUrl(
        "https://api.example.com/report"
      );
      expect(result).toBe(false);
    });
  });

  describe("isFilterHttpUrl", () => {
    it("should return true when URL matches filter regex", () => {
      const filterRegex = /test-filter/;
      reportController.options.filterXhrUrlRegExp = filterRegex;

      const result = reportController.isFilterHttpUrl(
        "https://example.com/test-filter/api"
      );
      expect(result).toBe(true);
    });

    it("should return false when URL does not match filter regex", () => {
      const filterRegex = /test-filter/;
      reportController.options.filterXhrUrlRegExp = filterRegex;

      const result = reportController.isFilterHttpUrl(
        "https://example.com/other/api"
      );
      expect(result).toBe(false);
    });

    it("should return false when no filter regex is set", () => {
      const result = reportController.isFilterHttpUrl(
        "https://example.com/api"
      );
      expect(result).toBe(false);
    });
  });

  describe("beacon", () => {
    it("should use sendBeacon API when available", () => {
      const mockSendBeacon = vi.fn().mockReturnValue(true);
      Object.defineProperty(navigator, "sendBeacon", {
        value: mockSendBeacon,
        configurable: true,
      });

      const testData = { test: "data" };
      const result = reportController.beacon(
        "https://api.example.com",
        testData
      );

      expect(result).toBe(true);
      expect(mockSendBeacon).toHaveBeenCalledWith(
        "https://api.example.com",
        expect.any(Blob)
      );
    });

    it("should create proper Blob with JSON data", () => {
      const mockSendBeacon = vi.fn().mockReturnValue(true);
      Object.defineProperty(navigator, "sendBeacon", {
        value: mockSendBeacon,
        configurable: true,
      });

      const testData = { message: "test", level: "error" };
      reportController.beacon("https://api.example.com", testData);

      const [, blob] = mockSendBeacon.mock.calls[0];
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("application/json");
    });
  });

  describe("imgRequest", () => {
    it("should create image request with encoded data", () => {
      const testData = { message: "test error" } as ReportData;
      const url = "https://api.example.com";

      // Mock Image constructor
      const mockImage = {
        src: "",
      };
      global.Image = vi.fn(() => mockImage) as any;

      reportController.imgRequest(testData, url);

      expect(mockImage.src).toContain("https://api.example.com?data=");
      expect(mockImage.src).toContain(
        encodeURIComponent(JSON.stringify(testData))
      );
    });

    it("should handle URL with existing query parameters", () => {
      const testData = { message: "test" } as ReportData;
      const url = "https://api.example.com?existing=param";

      const mockImage = { src: "" };
      global.Image = vi.fn(() => mockImage) as any;

      reportController.imgRequest(testData, url);

      expect(mockImage.src).toContain(
        "https://api.example.com?existing=param&data="
      );
    });
  });

  describe("send", () => {
    let mockBeacon: vi.SpyInstance;
    let mockImgRequest: vi.SpyInstance;
    let mockXhrPost: vi.SpyInstance;

    beforeEach(() => {
      mockBeacon = vi.spyOn(reportController, "beacon");
      mockImgRequest = vi.spyOn(reportController, "imgRequest");
      mockXhrPost = vi.spyOn(reportController, "xhrPost");
    });

    it("should return early if dsn is empty", async () => {
      const utils = await import("../../utils");
      vi.mocked(utils.isEmpty).mockReturnValue(true);

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const testData: ISendData = {
        type: EVENT_TYPE.ERROR,
        message: "test error",
      };

      await reportController.send(testData);

      expect(consoleSpy).toHaveBeenCalledWith(
        "dsn为空，没有传入监控错误上报的dsn地址，请在init中传入"
      );
      expect(mockBeacon).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should use beacon when available and successful", async () => {
      const utils = await import("../../utils");
      vi.mocked(utils.isEmpty).mockReturnValue(false);

      mockBeacon.mockReturnValue(true);

      const testData: ISendData = {
        type: EVENT_TYPE.ERROR,
        message: "test error",
      };

      await reportController.send(testData);

      expect(mockBeacon).toHaveBeenCalled();
      expect(mockImgRequest).not.toHaveBeenCalled();
      expect(mockXhrPost).not.toHaveBeenCalled();
    });

    it("should fallback to imgRequest when beacon fails and useImgUpload is true", async () => {
      const utils = await import("../../utils");
      vi.mocked(utils.isEmpty).mockReturnValue(false);

      mockBeacon.mockReturnValue(false);
      reportController.useImgUpload = true;

      const testData: ISendData = {
        type: EVENT_TYPE.ERROR,
        message: "test error",
      };

      await reportController.send(testData);

      expect(mockBeacon).toHaveBeenCalled();
      expect(mockImgRequest).toHaveBeenCalled();
      expect(mockXhrPost).not.toHaveBeenCalled();
    });

    it("should fallback to xhrPost when beacon fails and useImgUpload is false", async () => {
      const utils = await import("../../utils");
      vi.mocked(utils.isEmpty).mockReturnValue(false);

      mockBeacon.mockReturnValue(false);
      reportController.useImgUpload = false;

      const testData: ISendData = {
        type: EVENT_TYPE.ERROR,
        message: "test error",
      };

      await reportController.send(testData);

      expect(mockBeacon).toHaveBeenCalled();
      expect(mockImgRequest).not.toHaveBeenCalled();
      expect(mockXhrPost).toHaveBeenCalled();
    });

    it("should add uuid, apiKey and pageUrl to data", async () => {
      const utils = await import("../../utils");
      vi.mocked(utils.isEmpty).mockReturnValue(false);
      vi.mocked(utils.getLocationHref).mockReturnValue(
        "https://current-page.com"
      );

      const beforePostSpy = vi.spyOn(reportController, "beforePost");
      mockBeacon.mockReturnValue(true);

      const testData: ISendData = {
        type: EVENT_TYPE.ERROR,
        message: "test error",
      };

      await reportController.send(testData);

      expect(testData.uuid).toBe("test-uuid-123");
      expect(testData.apiKey).toBe("test-api-key");
      expect(testData.pageUrl).toBe("https://current-page.com");
    });

    it("should not send if beforePost returns null", async () => {
      const utils = await import("../../utils");
      vi.mocked(utils.isEmpty).mockReturnValue(false);

      const beforePostSpy = vi
        .spyOn(reportController, "beforePost")
        .mockResolvedValue(null);

      const testData: ISendData = {
        type: EVENT_TYPE.ERROR,
        message: "test error",
      };

      await reportController.send(testData);

      expect(mockBeacon).not.toHaveBeenCalled();
      expect(mockImgRequest).not.toHaveBeenCalled();
      expect(mockXhrPost).not.toHaveBeenCalled();
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete send workflow", async () => {
      const utils = await import("../../utils");
      vi.mocked(utils.isEmpty).mockReturnValue(false);

      // Mock successful beacon
      const mockSendBeacon = vi.fn().mockReturnValue(true);
      Object.defineProperty(navigator, "sendBeacon", {
        value: mockSendBeacon,
        configurable: true,
      });

      const testData: ISendData = {
        type: EVENT_TYPE.ERROR,
        message: "Integration test error",
        stack: "Error stack trace",
      };

      await reportController.send(testData);

      // Verify data was processed and sent
      expect(testData.uuid).toBe("test-uuid-123");
      expect(testData.apiKey).toBe("test-api-key");
      expect(mockSendBeacon).toHaveBeenCalled();
    });
  });
});
