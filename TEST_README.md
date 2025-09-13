# 单元测试说明

## 📋 测试概览

本项目使用 **Vitest** 作为测试框架，提供了全面的单元测试和集成测试覆盖。

## 🚀 快速开始

### 运行所有测试
```bash
npm test
```

### 运行测试（一次性）
```bash
npm run test:run
```

### 监听模式运行测试
```bash
npm run test:watch
```

### 生成测试覆盖率报告
```bash
npm run test:coverage
```

## 📁 测试文件结构

```
src/
├── __test__/
│   └── integration.spec.ts          # 集成测试
├── core/
│   └── __test__/
│       ├── breadcrumb.spec.ts       # 面包屑功能测试
│       ├── queue.spec.ts            # 队列功能测试
│       ├── report.spec.ts           # 报告功能测试
│       └── filter_url.spec.ts       # URL过滤测试（已存在）
├── plugins/
│   └── __test__/
│       ├── console_plugin.spec.ts   # Console插件测试
│       └── error_plugin.spec.ts     # Error插件测试
└── utils/
    └── __test__/
        └── utils.spec.ts            # 工具函数测试
```

## 🧪 测试覆盖范围

### 核心功能测试
- **工具函数** (`utils.spec.ts`)
  - 时间戳生成
  - UUID生成
  - 节流函数
  - 类型检查函数
  - AOP替换函数

- **面包屑系统** (`breadcrumb.spec.ts`)
  - 面包屑添加和排序
  - 容量限制管理
  - 事件分类
  - 回调处理

- **队列系统** (`queue.spec.ts`)
  - 单例模式
  - 异步任务调度
  - 错误处理
  - 性能优化

- **报告系统** (`report.spec.ts`)
  - 数据上报
  - 多种上报方式（Beacon、Image、XHR）
  - 数据转换和过滤
  - 用户认证

### 插件测试
- **Console插件** (`console_plugin.spec.ts`)
  - Console方法拦截
  - 面包屑记录
  - 多种日志级别支持

- **Error插件** (`error_plugin.spec.ts`)
  - JavaScript错误捕获
  - 资源加载错误处理
  - Promise rejection处理
  - 错误去重机制

### 集成测试
- **完整流程测试** (`integration.spec.ts`)
  - 多插件协同工作
  - 真实场景模拟
  - 配置选项验证
  - 内存管理测试

## 🔧 测试配置

### Vitest 配置特性
- **环境**: Happy DOM（轻量级DOM模拟）
- **覆盖率**: V8 provider
- **报告格式**: Text、JSON、HTML
- **全局变量**: 启用（describe、it、expect等）

### Mock 策略
- **外部依赖**: 使用 `vi.mock()` 模拟
- **浏览器API**: 使用 `vi.stubGlobal()` 模拟
- **时间控制**: 使用 `vi.useFakeTimers()` 控制

## 📊 测试最佳实践

### 1. 测试结构
```typescript
describe('功能模块', () => {
  beforeEach(() => {
    // 测试前准备
  });

  afterEach(() => {
    // 测试后清理
  });

  describe('具体功能', () => {
    it('should 期望行为', () => {
      // 测试实现
    });
  });
});
```

### 2. Mock 使用
```typescript
// Mock 外部依赖
vi.mock('../dependency');

// Mock 全局对象
vi.stubGlobal('console', mockConsole);

// Mock 时间
vi.useFakeTimers();
vi.setSystemTime(new Date('2023-01-01'));
```

### 3. 断言示例
```typescript
// 基本断言
expect(result).toBe(expected);
expect(array).toHaveLength(3);
expect(object).toEqual(expectedObject);

// 函数调用断言
expect(mockFn).toHaveBeenCalledWith(arg1, arg2);
expect(mockFn).toHaveBeenCalledTimes(1);

// 异常断言
expect(() => dangerousFunction()).toThrow();
```

## 🎯 测试指标

### 覆盖率目标
- **语句覆盖率**: > 90%
- **分支覆盖率**: > 85%
- **函数覆盖率**: > 90%
- **行覆盖率**: > 90%

### 性能指标
- **测试执行时间**: < 30秒
- **单个测试**: < 100ms
- **内存使用**: 合理范围内

## 🐛 调试测试

### 查看详细输出
```bash
npm test -- --reporter=verbose
```

### 运行特定测试文件
```bash
npm test breadcrumb.spec.ts
```

### 运行特定测试用例
```bash
npm test -- -t "should add breadcrumb"
```

### 调试模式
```bash
npm test -- --inspect-brk
```

## 📈 持续集成

测试应该在以下情况下运行：
- 每次代码提交前
- Pull Request 创建时
- 发布新版本前

### CI 命令
```bash
# 安装依赖
npm ci

# 运行测试
npm run test:run

# 生成覆盖率
npm run test:coverage
```

## 🔍 常见问题

### Q: 测试运行缓慢？
A: 检查是否有未清理的定时器或异步操作，使用 `vi.restoreAllMocks()` 清理。

### Q: Mock 不生效？
A: 确保 mock 在导入模块之前调用，使用 `vi.hoisted()` 提升 mock。

### Q: 覆盖率不准确？
A: 检查 vitest.config.ts 中的 include/exclude 配置。

### Q: 测试环境问题？
A: Happy DOM 可能不支持某些浏览器API，考虑使用 JSDOM 或添加 polyfill。

## 📚 参考资源

- [Vitest 官方文档](https://vitest.dev/)
- [Happy DOM 文档](https://github.com/capricorn86/happy-dom)
- [测试最佳实践](https://github.com/goldbergyoni/javascript-testing-best-practices)