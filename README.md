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
# Functions 功能
- Open inspiration images in their original source websites
- Automatically download saved inspirations to a local folder; clearing favorites will not delete local files
- Customizable local download directory
- Custom RSS feed sources
- Option to enable/disable image downloads per category
- Configurable push intervals and scheduled notifications
- Multiple color themes available for switching
>  
- 点击灵感图片前往其原网站
- 收藏灵感时自动下载图片至本地文件夹，清空收藏夹不会删除本地文件
- 可指定下载图片的本地文件夹路径
- 可自定义RSS内容源
- 可根据不同分类的需要，选择是否下载图片
- 可自定义推送间隔、定时推送
- 多种颜色皮肤可供切换
# Usage Notes 使用注意事项
- Use RSSHub Radar to find RSS feeds for target platforms
- Not all platforms provide public RSS support; some default RSS sources are included
- If you don’t want images downloaded for a specific tag, you can disable it in Settings > Content Source Management
- You can clear the favorites with one click; it’s recommended to regularly organize local folder contents
>  
- 可使用RSSHub Radar查找目标平台的RSS
- 并非所有平台都有公开RSS支持订阅，已提供一些默认RSS
- 若不希望在收藏某分类灵感时下载其图片，可在设置>内容源管理中取消勾选下载图标
- 收藏夹堆积过多内容时可一键清除，建议定期整理本地文件夹内内容
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

