# Linux.do 自动滚动阅读助手

为 linux.do 论坛设计的自动滚动脚本，帮助你轻松浏览长帖子。

## ✨ 功能特性

- **一键自动滚动** - 点击按钮即可开始/暂停自动滚动
- **速度可调节** - 支持 0.5x 到 10x 速度调节
- **平滑滚动** - 采用平滑加速/减速效果
- **键盘快捷键** - 支持快捷键操作
- **智能暂停** - 页面隐藏时自动暂停
- **到达底部提醒** - 滚动到底部时自动停止并提示
- **精美界面** - 渐变色设计，悬浮面板

## 📦 安装步骤

### 1. 安装浏览器扩展

首先需要安装用户脚本管理器，选择以下任一方式：

- **Tampermonkey** (推荐): [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) | [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/) | [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

- **Violentmonkey**: [Chrome](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) | [Firefox](https://addons.mozilla.org/firefox/addon/violentmonkey/)

### 2. 安装脚本

方式一：直接安装
1. 点击 [GreasyFork 脚本页面](https://greasyfork.org/zh-CN/scripts/559885-linux-do-%E8%87%AA%E5%8A%A8%E6%BB%9A%E5%8A%A8%E9%98%85%E8%AF%BB)
2. 点击"安装此脚本"按钮

方式二：手动安装
1. 复制 `linux-do-autoscroll.user.js` 文件内容
2. 在 Tampermonkey 中点击"添加新脚本"
3. 粘贴代码并保存

## 🎮 使用方法

### 基本操作

1. 访问任意 linux.do 帖子页面
2. 页面右侧会出现紫色控制面板
3. 点击 **"▶️ 开始滚动"** 按钮开始自动滚动
4. 使用滑块调节滚动速度

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt + S` | 开始/暂停滚动 |
| `Alt + ↑` | 加快滚动速度 |
| `Alt + ↓` | 减慢滚动速度 |

### 界面操作

- **双击标题栏** - 最小化/展开控制面板
- **拖动滑块** - 实时调节滚动速度

## 🎯 适用场景

- 快速浏览长帖子
- 批量阅读未读内容
- 解放双手浏览内容
- 提升阅读效率

## 🔧 自定义设置

你可以修改脚本中的 `CONFIG` 对象来自定义行为：

```javascript
const CONFIG = {
    INITIAL_SPEED: 2,           // 初始速度（像素/帧）
    MIN_SPEED: 0.5,             // 最小速度
    MAX_SPEED: 10,              // 最大速度
    BOTTOM_THRESHOLD: 50,       // 距离底部多少像素视为到达底部
    BOTTOM_DETECTION_COUNT: 5,  // 连续多少次检测到底部才停止（防止误判）
    AUTO_PAUSE_ON_HIDE: false,  // 页面隐藏时是否自动暂停
};
```

### 配置说明

- `BOTTOM_DETECTION_COUNT`: 增大此值可减少因懒加载导致的误暂停，但会延迟真正的底部检测
- `AUTO_PAUSE_ON_HIDE`: 设为 `true` 可在切换标签页时自动暂停滚动

## 📸 界面预览

```
┌─────────────────┐
│  📖 自动滚动助手  │
├─────────────────┤
│  ▶️ 开始滚动      │
├─────────────────┤
│  速度: 2         │
│  ━━━●━━━━━━     │
├─────────────────┤
│  正在滚动...     │
└─────────────────┘
```

## 🛠️ 技术细节

- **框架**: 原生 JavaScript (无依赖)
- **兼容性**: Discourse 论坛系统
- **性能**: ~60fps 平滑滚动
- **安全性**: 仅在 linux.do 域名下运行

## 🔗 相关资源

- [GreasyFork 脚本页面](https://greasyfork.org/zh-CN/scripts/559885-linux-do-%E8%87%AA%E5%8A%A8%E6%BB%9A%E5%8A%A8%E9%98%85%E8%AF%BB)
- [Tampermonkey 官网](https://www.tampermonkey.net/)

## 📝 更新日志

### v1.3.0 (2025-01-16)
- 🔧 完全重写滚动逻辑，适配 Discourse 自动懒加载机制
- ✨ 移除"加载更多"按钮点击逻辑（Discourse 使用自动懒加载）
- ✨ 优化底部检测阈值（100px）
- ✨ 延长默认等待时间到 5 秒
- ✨ 改进状态提示（触发加载、等待加载）

### v1.2.0 (2025-01-16)
- 🔧 修复到达底部后停止的问题
- ✨ 添加自动点击"加载更多"按钮功能
- ✨ 添加智能等待机制（到达底部后等待新内容加载）
- ✨ 显示加载倒计时提示
- ✨ 可配置等待时间

### v1.1.0 (2025-01-16)
- 🔧 修复滚动意外暂停的问题
- ✨ 智能检测 Discourse 懒加载内容
- ✨ 改进底部检测逻辑，防止误判
- ✨ 添加可配置选项
- ✨ 移除默认的页面隐藏自动暂停功能

### v1.0.0 (2025-01-16)
- 初始版本发布
- 支持基础自动滚动功能
- 添加速度调节
- 添加键盘快捷键
- 添加平滑滚动效果

## ⚠️ 注意事项

1. 确保已安装 Tampermonkey 或类似扩展
2. 仅在 linux.do 域名下生效
3. 建议速度设置在 1-3 之间以获得最佳阅读体验
4. 页面隐藏时会自动暂停滚动

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License
