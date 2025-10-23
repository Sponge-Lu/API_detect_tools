# API Detector - Electron版本

一个基于Electron的API检测工具，能自动从浏览器获取认证信息，简化API的调试和管理流程。

## 核心功能

- **自动认证**：通过连接Chrome调试实例，自动获取并使用Cookie进行API请求。
- **多站点管理**：集中管理和检测多个API站点。
- **智能检测**：自动发现站点支持的模型列表。
- **状态查询**：快速查询账户余额。
- **灵活检测**：支持并发或串行模式对多个站点进行检测。

## 技术栈

- **框架**: Electron + React + TypeScript
- **UI**: Tailwind CSS
- **浏览器自动化**: Puppeteer

## 快速开始

1.  **安装依赖**
    ```bash
    npm install
    ```

2.  **启动开发环境**
    ```bash
    npm run dev
    ```

3.  **构建应用**
    ```bash
    npm run dist
    ```

## 许可证

MIT