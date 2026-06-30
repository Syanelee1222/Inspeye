# Inspeye 灵感桌宠
A tool helpful for artists and designers to gain inspiration, in a desktop pet form that stays on your screen.<br>
Simply hover your mouse over the desktop pet to bring up a sleek panel for browsing the latest cases.<br>
>  
一款专为艺术设计工作者获取灵感的支持工具，以桌宠形态常驻桌面。<br>
只需将鼠标移至桌宠上方，即可弹出精美面板浏览最新设计案例。
# WIP 仍在开发中
This project is still being actively tested and optimized to improve the user experience.<br>
>  
该项目仍在持续测试并优化用户体验中。
# Framework 框架
- Electron: Cross-platform desktop app framework with multi-window, system tray, and IPC support 
- Node.js: Handles file system, HTTPS requests, crypto hashing, and path utilities 
- Vanilla JavaScript: Pure rendering logic without any framework dependencies (no Vue/React) 
- CSS3: Glassmorphism UI, animations, responsive layout, and CSS variable theme system
>  
- Electron: 跨平台桌面应用框架，提供多窗口 / 系统托盘 / IPC 通信
- Node.js: 文件系统操作 / HTTPS 请求 / 加密哈希 / 路径处理
- 原生 JavaScript: 渲染进程逻辑，无框架依赖（无 Vue/React）
- CSS3: Glass Morphism / 动画 / 响应式布局 / CSS 变量主题系统
# Features 特点
- Uses regex to parse RSS 2.0 and Atom XML (no xml2js / fast-xml-parser)
- Uses Electron session.defaultSession.fetch() with Chromium network stack + system proxy support
- Native DOM-based UI rendering (no Vue/React/jQuery)
- 7-day local JSON cache with auto cleanup of expired entries
>  
- 使用正则表达式解析 RSS 2.0 和 Atom XML，不依赖 xml2js、fast-xml-parser 等库
- 复用 Electron 的 session.defaultSession.fetch()，走 Chromium 网络栈，自动支持系统代理
- UI渲染原生 DOM 操作，不依赖 Vue/React/jQuery
- 7 天本地 JSON 缓存，自动清理过期条目
