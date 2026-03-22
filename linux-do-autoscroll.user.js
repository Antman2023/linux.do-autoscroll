// ==UserScript==
// @name         Linux.do 自动滚动阅读助手
// @namespace    http://tampermonkey.net/
// @version      1.6.5
// @description  为 linux.do 论坛添加自动滚动功能，支持速度调节、暂停/继续、智能处理 Discourse 懒加载、可拖拽浮动面板，毛玻璃风格，跟随论坛主题配色
// @author       pboy
// @match        https://linux.do/t/*
// @match        https://linux.do/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ========== 配置选项 ==========
    const CONFIG = {
        INITIAL_SPEED: 7,           // 初始速度（像素/帧）
        MIN_SPEED: 0.5,             // 最小速度
        MAX_SPEED: 10,              // 最大速度
        BOTTOM_THRESHOLD: 100,      // 距离底部多少像素视为到达底部
        WAIT_TIME_SECONDS: 5,       // 到达底部后等待新内容加载的时间（秒）
        AUTO_PAUSE_ON_HIDE: false,  // 页面隐藏时是否自动暂停
    };
    // ==============================

    // ========== 存储管理器 ==========
    const StorageManager = {
        STORAGE_KEY: 'linuxdo-autoscroll-settings',
        VERSION: '1.0',

        // 默认设置
        getDefaults() {
            return {
                version: this.VERSION,
                position: { x: 0, y: 0 },
                speed: CONFIG.INITIAL_SPEED,
                isMinimized: true
            };
        },

        // 从 localStorage 加载设置
        load() {
            try {
                const saved = localStorage.getItem(this.STORAGE_KEY);
                if (!saved) return this.getDefaults();

                const settings = JSON.parse(saved);
                // 验证并合并默认值
                return {
                    ...this.getDefaults(),
                    ...settings,
                    // 确保 position 包含有效数字
                    position: {
                        x: typeof settings.position?.x === 'number' ? settings.position.x : 0,
                        y: typeof settings.position?.y === 'number' ? settings.position.y : 0
                    }
                };
            } catch (e) {
                console.warn('加载自动滚动设置失败:', e);
                return this.getDefaults();
            }
        },

        // 保存设置到 localStorage
        save(settings) {
            try {
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
                    ...settings,
                    version: this.VERSION
                }));
            } catch (e) {
                console.warn('保存自动滚动设置失败:', e);
            }
        },

        // 防抖保存辅助函数
        createDebouncedSave(delay = 500) {
            let timeoutId = null;
            return (settings) => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => this.save(settings), delay);
            };
        }
    };

    // ========== 事件标准化器 ==========
    const EventNormalizer = {
        // 从鼠标或触摸事件获取客户端坐标
        getClientCoordinates(e) {
            if (e.type.startsWith('touch')) {
                const touch = e.touches[0] || e.changedTouches[0];
                return { clientX: touch.clientX, clientY: touch.clientY };
            }
            return { clientX: e.clientX, clientY: e.clientY };
        },

        // 检查是否为触摸事件
        isTouchEvent(e) {
            return e.type.startsWith('touch');
        }
    };
    // ==============================

    let isScrolling = false;
    let scrollRafId = null;
    let targetSpeed = 2;
    let currentSpeed = 0;
    let lastScrollHeight = 0; // 记录上次的页面高度
    let noChangeCount = 0; // 页面高度未变化的计数器
    let lastFrameTime = 0; // 上一帧时间

    function getSpeedProgress(value) {
        const ratio = ((value - CONFIG.MIN_SPEED) / (CONFIG.MAX_SPEED - CONFIG.MIN_SPEED)) * 100;
        return `${Math.max(0, Math.min(100, ratio))}%`;
    }

    function formatSpeedValue(value) {
        return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
    }

    const STATE_LABELS = {
        idle: '待机',
        running: '滚动',
        loading: '载入',
        waiting: '等待',
        paused: '暂停',
        done: '完成'
    };

    const BUTTON_ICONS = {
        play: `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M8 6v12l10-6-10-6Z" fill="currentColor"></path>
            </svg>
        `,
        pause: `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="7" y="6" width="3.5" height="12" rx="1.4" fill="currentColor"></rect>
                <rect x="13.5" y="6" width="3.5" height="12" rx="1.4" fill="currentColor"></rect>
            </svg>
        `
    };

    function getToggleButtonContent(icon, label) {
        return `
            <span class="btn-icon">${BUTTON_ICONS[icon]}</span>
            <span class="btn-copy">
                <span class="btn-label">${label}</span>
                <span class="btn-caption">滚动控制</span>
            </span>
        `;
    }

    // 创建控制面板
    function createControlPanel(settings) {
        const panel = document.createElement('div');
        panel.id = 'linuxdo-autoscroll-panel';
        panel.dataset.state = 'idle';
        panel.classList.add(settings.isMinimized ? 'minimized' : 'expanded'); // 应用保存的状态
        panel.style.setProperty('--speed-progress', getSpeedProgress(settings.speed));
        panel.innerHTML = `
            <div class="autoscroll-header" id="autoscroll-header">
                <span class="autoscroll-title">
                    <span class="autoscroll-icon">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="17 1 21 5 17 9"></polyline>
                            <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                            <polyline points="7 23 3 19 7 15"></polyline>
                            <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                        </svg>
                    </span>
                    <span class="autoscroll-heading">
                        <span class="autoscroll-kicker">LINUX.DO</span>
                        <span class="autoscroll-text">自动滚动</span>
                    </span>
                </span>
                <span class="autoscroll-header-actions">
                    <span class="autoscroll-mode-chip" id="autoscroll-mode-chip">待机</span>
                    <button class="autoscroll-minimize-btn" id="autoscroll-minimize" title="最小化">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                </span>
            </div>
            <div class="autoscroll-content">
                <button id="autoscroll-toggle" class="autoscroll-btn autoscroll-btn-primary">
                    ${getToggleButtonContent('play', '开始滚动')}
                </button>
                <div class="autoscroll-controls">
                    <div class="autoscroll-speed-control">
                        <label for="autoscroll-speed">
                            <span class="autoscroll-speed-meta">
                                <span class="autoscroll-speed-title">速度</span>
                                <span class="autoscroll-speed-caption">平滑阅读节奏</span>
                            </span>
                            <span class="autoscroll-speed-readout">
                                <span id="speed-value">${formatSpeedValue(settings.speed)}</span>
                                <span class="autoscroll-speed-unit">px/f</span>
                            </span>
                        </label>
                        <input type="range" id="autoscroll-speed" min="${CONFIG.MIN_SPEED}" max="${CONFIG.MAX_SPEED}" step="0.5" value="${settings.speed}">
                        <div class="autoscroll-shortcuts">Alt + S 切换滚动 · Alt + ↑ / ↓ 调速</div>
                    </div>
                </div>
                <div class="autoscroll-status" id="autoscroll-status">
                    <span class="autoscroll-status-dot" aria-hidden="true"></span>
                    <span class="autoscroll-status-text" id="autoscroll-status-text">就绪</span>
                </div>
            </div>
        `;

        // 添加样式
        GM_addStyle(`
            /* ===== Panel Container ===== */
            #linuxdo-autoscroll-panel {
                position: fixed;
                top: 88px;
                right: 18px;
                min-width: 246px;
                padding: 0;
                border-radius: 21px;
                background: linear-gradient(
                    180deg,
                    color-mix(in srgb, var(--secondary, #ffffff) 84%, var(--primary, #000000) 7%) 0%,
                    color-mix(in srgb, var(--secondary, #ffffff) 74%, var(--primary, #000000) 13%) 100%
                );
                backdrop-filter: blur(24px) saturate(148%);
                -webkit-backdrop-filter: blur(24px) saturate(148%);
                border: 1px solid color-mix(in srgb, var(--primary, #000000) 12%, transparent);
                box-shadow:
                    0 18px 42px color-mix(in srgb, var(--primary, #000000) 20%, transparent),
                    inset 0 1px 0 color-mix(in srgb, #ffffff 10%, transparent);
                z-index: 99999;
                font-family: 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
                color: var(--primary, #1a1a1a);
                transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
                cursor: move;
                will-change: transform;
                --tx: 0px;
                --ty: 0px;
                --speed-progress: 0%;
                --accent-strong: color-mix(in srgb, var(--tertiary, #4a90d9) 56%, #25303d 44%);
                --accent-deep: color-mix(in srgb, var(--tertiary, #4a90d9) 34%, #0b1018 66%);
                --accent-soft: color-mix(in srgb, var(--accent-strong) 8%, transparent);
                --accent-halo: color-mix(in srgb, var(--accent-strong) 12%, transparent);
                transform: translate(var(--tx, 0px), var(--ty, 0px));
                overflow: hidden;
                isolation: isolate;
            }

            #linuxdo-autoscroll-panel::before,
            #linuxdo-autoscroll-panel::after {
                content: '';
                position: absolute;
                pointer-events: none;
            }

            #linuxdo-autoscroll-panel::before {
                inset: 0;
                background: linear-gradient(
                    180deg,
                    var(--accent-soft) 0%,
                    transparent 34%
                );
            }

            #linuxdo-autoscroll-panel::after {
                top: -36px;
                right: -28px;
                width: 128px;
                height: 128px;
                opacity: 0.44;
                background: radial-gradient(circle, var(--accent-halo), transparent 72%);
                filter: blur(10px);
            }

            #linuxdo-autoscroll-panel:hover {
                box-shadow:
                    0 22px 48px color-mix(in srgb, var(--primary, #000000) 22%, transparent),
                    inset 0 1px 0 color-mix(in srgb, #ffffff 10%, transparent);
                transform: translate(var(--tx, 0px), var(--ty, 0px)) translateY(-2px);
            }

            #linuxdo-autoscroll-panel.dragging {
                transition: none;
                box-shadow: 0 14px 34px color-mix(in srgb, var(--primary, #000000) 20%, transparent);
                transform: translate(var(--tx, 0px), var(--ty, 0px));
                animation: none !important;
            }

            /* ===== Header ===== */
            .autoscroll-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                padding: 15px 15px 11px;
                border-bottom: 1px solid color-mix(in srgb, var(--primary, #000000) 6%, transparent);
                cursor: move;
                user-select: none;
            }

            .autoscroll-title {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                min-width: 0;
            }

            .autoscroll-icon {
                width: 30px;
                height: 30px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: color-mix(in srgb, var(--accent-strong) 88%, #c4d0dc 12%);
                background:
                    linear-gradient(
                        180deg,
                        color-mix(in srgb, var(--accent-soft) 54%, transparent) 0%,
                        color-mix(in srgb, var(--primary, #000000) 5%, transparent) 100%
                    );
                border-radius: 11px;
                border: 1px solid color-mix(in srgb, var(--accent-strong) 14%, transparent);
                box-shadow: inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent);
                flex: 0 0 auto;
            }

            .autoscroll-heading {
                display: grid;
                gap: 2px;
                min-width: 0;
            }

            .autoscroll-kicker {
                font-size: 10px;
                line-height: 1;
                font-weight: 700;
                letter-spacing: 1.1px;
                opacity: 0.4;
            }

            .autoscroll-text {
                font-size: 15px;
                line-height: 1.05;
                font-weight: 700;
                color: color-mix(in srgb, var(--primary, #000000) 84%, #334155 16%);
                letter-spacing: 0.16px;
            }

            .autoscroll-header-actions {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .autoscroll-mode-chip {
                position: relative;
                min-width: 34px;
                padding: 0 0 0 10px;
                background: none;
                border: none;
                color: color-mix(in srgb, var(--primary, #111111) 60%, #8b99a8 40%);
                font-size: 10px;
                line-height: 1;
                font-weight: 700;
                letter-spacing: 0.12em;
                text-align: right;
                text-transform: uppercase;
            }

            .autoscroll-mode-chip::before {
                content: '';
                position: absolute;
                left: 0;
                top: 50%;
                width: 1px;
                height: 16px;
                background: color-mix(in srgb, var(--primary, #000000) 18%, transparent);
                transform: translateY(-50%);
            }

            #linuxdo-autoscroll-panel[data-state="running"] .autoscroll-mode-chip,
            #linuxdo-autoscroll-panel[data-state="loading"] .autoscroll-mode-chip,
            #linuxdo-autoscroll-panel[data-state="waiting"] .autoscroll-mode-chip {
                color: color-mix(in srgb, var(--accent-strong) 68%, #d8e3ee 32%);
            }

            #linuxdo-autoscroll-panel[data-state="running"] .autoscroll-mode-chip::before,
            #linuxdo-autoscroll-panel[data-state="loading"] .autoscroll-mode-chip::before,
            #linuxdo-autoscroll-panel[data-state="waiting"] .autoscroll-mode-chip::before {
                background: color-mix(in srgb, var(--accent-strong) 50%, transparent);
            }

            #linuxdo-autoscroll-panel[data-state="done"] .autoscroll-mode-chip {
                color: color-mix(in srgb, var(--accent-strong) 34%, #a5b4c2 66%);
            }

            #linuxdo-autoscroll-panel[data-state="done"] .autoscroll-mode-chip::before {
                background: color-mix(in srgb, var(--accent-strong) 26%, transparent);
            }

            /* ===== Minimize Button ===== */
            .autoscroll-minimize-btn {
                width: 26px;
                height: 26px;
                border: 1px solid color-mix(in srgb, var(--primary, #000000) 10%, transparent);
                background: color-mix(in srgb, var(--primary, #000000) 6%, transparent);
                color: color-mix(in srgb, var(--primary, #000000) 56%, #68788a 44%);
                border-radius: 9px;
                cursor: pointer;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                opacity: 0.72;
            }

            .autoscroll-minimize-btn:hover {
                background: color-mix(in srgb, var(--primary, #000000) 10%, transparent);
                opacity: 1;
                transform: translateY(-1px);
            }

            /* ===== Content Area ===== */
            .autoscroll-content {
                padding: 14px 15px 15px;
            }

            /* ===== Action Button ===== */
            .autoscroll-btn {
                width: 100%;
                min-height: 54px;
                padding: 11px 12px;
                border: 1px solid color-mix(in srgb, var(--accent-strong) 12%, transparent);
                border-radius: 14px;
                font-size: 14px;
                font-weight: 700;
                cursor: pointer;
                transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), filter 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                margin-bottom: 12px;
                letter-spacing: 0.1px;
                display: flex;
                align-items: center;
                justify-content: flex-start;
                gap: 12px;
                text-align: left;
                position: relative;
                overflow: hidden;
            }

            .autoscroll-btn .btn-icon {
                width: 32px;
                height: 32px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 auto;
                border-radius: 10px;
                background: color-mix(in srgb, #ffffff 5%, var(--accent-soft) 95%);
                box-shadow: inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent);
            }

            .autoscroll-btn .btn-icon svg {
                width: 15px;
                height: 15px;
            }

            .autoscroll-btn .btn-copy {
                display: grid;
                gap: 3px;
                flex: 1 1 auto;
                min-width: 0;
            }

            .autoscroll-btn .btn-label {
                font-size: 14px;
                line-height: 1.05;
                font-weight: 700;
            }

            .autoscroll-btn .btn-caption {
                font-size: 10px;
                line-height: 1;
                font-weight: 700;
                letter-spacing: 0.08em;
                opacity: 0.48;
            }

            .autoscroll-btn-primary {
                background: linear-gradient(
                    180deg,
                    color-mix(in srgb, var(--accent-strong) 68%, #1a2430 32%) 0%,
                    color-mix(in srgb, var(--accent-deep) 88%, #070b10 12%) 100%
                );
                color: #fff;
                box-shadow:
                    0 12px 24px color-mix(in srgb, var(--accent-deep) 18%, transparent),
                    inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent);
            }

            .autoscroll-btn-primary::before {
                content: '';
                position: absolute;
                inset: 0;
                background:
                    linear-gradient(
                        90deg,
                        color-mix(in srgb, #ffffff 6%, transparent) 0,
                        color-mix(in srgb, #ffffff 6%, transparent) 42px,
                        transparent 42px,
                        transparent 100%
                    );
                pointer-events: none;
            }

            .autoscroll-btn-primary:hover {
                filter: brightness(1.02);
                transform: translateY(-1px);
                box-shadow:
                    0 15px 28px color-mix(in srgb, var(--accent-deep) 20%, transparent),
                    inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent);
            }

            .autoscroll-btn-primary:active {
                transform: translateY(1px) scale(0.995);
                filter: brightness(0.95);
            }

            .autoscroll-btn-primary.scrolling-active {
                background: linear-gradient(
                    180deg,
                    color-mix(in srgb, var(--accent-strong) 58%, #131b25 42%) 0%,
                    color-mix(in srgb, var(--accent-deep) 88%, #05080d 12%) 100%
                );
            }

            .autoscroll-btn-primary.scrolling-active:hover {
                box-shadow:
                    0 15px 28px color-mix(in srgb, var(--accent-deep) 18%, transparent),
                    inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent);
            }

            /* ===== Speed Control ===== */
            .autoscroll-speed-control {
                margin: 2px 0 0;
            }

            .autoscroll-speed-control label {
                display: flex;
                justify-content: space-between;
                align-items: flex-end;
                gap: 14px;
                margin-bottom: 11px;
            }

            .autoscroll-speed-meta {
                display: grid;
                gap: 3px;
            }

            .autoscroll-speed-title {
                font-size: 12px;
                line-height: 1;
                font-weight: 700;
            }

            .autoscroll-speed-caption {
                font-size: 11px;
                line-height: 1.2;
                opacity: 0.5;
            }

            .autoscroll-speed-readout {
                display: grid;
                justify-items: end;
                gap: 2px;
                padding-left: 12px;
                border-left: 1px solid color-mix(in srgb, var(--primary, #000000) 10%, transparent);
            }

            #speed-value {
                font-size: 22px;
                line-height: 1;
                font-weight: 700;
                letter-spacing: -0.05em;
            }

            .autoscroll-speed-unit {
                font-size: 10px;
                line-height: 1;
                font-weight: 700;
                opacity: 0.42;
                text-transform: uppercase;
                letter-spacing: 0.14em;
            }

            .autoscroll-speed-control input[type="range"] {
                width: 100%;
                height: 5px;
                border-radius: 999px;
                background: linear-gradient(
                    90deg,
                    color-mix(in srgb, var(--accent-strong) 72%, transparent) 0%,
                    color-mix(in srgb, var(--accent-strong) 72%, transparent) var(--speed-progress),
                    color-mix(in srgb, var(--primary, #000000) 15%, transparent) var(--speed-progress),
                    color-mix(in srgb, var(--primary, #000000) 15%, transparent) 100%
                );
                outline: none;
                -webkit-appearance: none;
                transition: background 0.2s;
            }

            .autoscroll-speed-control input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 15px;
                height: 15px;
                border-radius: 999px;
                background: color-mix(in srgb, var(--accent-strong) 92%, #d8e2ed 8%);
                cursor: pointer;
                box-shadow: 0 2px 10px color-mix(in srgb, var(--accent-deep) 20%, transparent);
                transition: all 0.2s ease;
                border: 1px solid color-mix(in srgb, #ffffff 14%, transparent);
            }

            .autoscroll-speed-control input[type="range"]::-webkit-slider-thumb:hover {
                transform: scale(1.08);
            }

            .autoscroll-speed-control input[type="range"]::-moz-range-thumb {
                width: 15px;
                height: 15px;
                border-radius: 999px;
                background: color-mix(in srgb, var(--accent-strong) 92%, #d8e2ed 8%);
                cursor: pointer;
                border: 1px solid color-mix(in srgb, #ffffff 14%, transparent);
                box-shadow: 0 2px 10px color-mix(in srgb, var(--accent-deep) 20%, transparent);
            }

            .autoscroll-speed-control input[type="range"]::-moz-range-track {
                height: 5px;
                border-radius: 999px;
                background: color-mix(in srgb, var(--primary, #000000) 15%, transparent);
                border: none;
            }

            .autoscroll-shortcuts {
                margin-top: 10px;
                font-size: 11px;
                line-height: 1.35;
                opacity: 0.48;
            }

            /* ===== Status ===== */
            .autoscroll-status {
                display: flex;
                align-items: center;
                gap: 9px;
                font-size: 11px;
                margin-top: 12px;
                padding-top: 12px;
                border-top: 1px solid color-mix(in srgb, var(--primary, #000000) 6%, transparent);
                font-weight: 600;
                letter-spacing: 0.2px;
            }

            .autoscroll-status-dot {
                width: 7px;
                height: 7px;
                border-radius: 999px;
                background: color-mix(in srgb, var(--primary, #000000) 38%, transparent);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary, #000000) 7%, transparent);
                flex: 0 0 auto;
            }

            .autoscroll-status-text {
                opacity: 0.62;
                line-height: 1.35;
            }

            #linuxdo-autoscroll-panel[data-state="running"] .autoscroll-status-dot,
            #linuxdo-autoscroll-panel[data-state="loading"] .autoscroll-status-dot,
            #linuxdo-autoscroll-panel[data-state="waiting"] .autoscroll-status-dot {
                background: var(--accent-strong);
                box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-strong) 12%, transparent);
                animation: autoscroll-status-pulse 1.8s ease-in-out infinite;
            }

            #linuxdo-autoscroll-panel[data-state="done"] .autoscroll-status-dot {
                background: color-mix(in srgb, var(--accent-strong) 28%, #cfd8e2 72%);
                box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-strong) 8%, transparent);
            }

            @keyframes autoscroll-status-pulse {
                0%, 100% {
                    transform: scale(1);
                }
                50% {
                    transform: scale(1.18);
                }
            }

            /* ===== Minimized State ===== */
            #linuxdo-autoscroll-panel.minimized {
                min-width: auto;
                width: 50px;
                height: 50px;
                padding: 0;
                border-radius: 18px;
                cursor: pointer;
                background: linear-gradient(
                    180deg,
                    color-mix(in srgb, var(--accent-strong) 70%, #1a2430 30%) 0%,
                    color-mix(in srgb, var(--accent-deep) 92%, #090d13 8%) 100%
                );
                border: 1px solid color-mix(in srgb, #ffffff 12%, transparent);
                box-shadow:
                    0 10px 24px color-mix(in srgb, var(--accent-deep) 20%, transparent),
                    inset 0 1px 0 color-mix(in srgb, #ffffff 7%, transparent);
            }

            #linuxdo-autoscroll-panel.minimized:hover {
                transform: translate(var(--tx, 0px), var(--ty, 0px)) scale(1.05);
                box-shadow:
                    0 14px 28px color-mix(in srgb, var(--accent-deep) 24%, transparent),
                    inset 0 1px 0 color-mix(in srgb, #ffffff 7%, transparent);
            }

            #linuxdo-autoscroll-panel.minimized::before {
                inset: 5px;
                border-radius: 14px;
                background: linear-gradient(
                    180deg,
                    color-mix(in srgb, #ffffff 5%, transparent) 0%,
                    color-mix(in srgb, #ffffff 1%, transparent) 100%
                );
                box-shadow:
                    inset 0 1px 0 color-mix(in srgb, #ffffff 8%, transparent),
                    inset 0 -8px 14px color-mix(in srgb, #000000 20%, transparent);
                opacity: 1;
            }

            #linuxdo-autoscroll-panel.minimized::after {
                top: 6px;
                right: 6px;
                width: 7px;
                height: 7px;
                border-radius: 999px;
                background: color-mix(in srgb, #cfd8e2 66%, transparent);
                border: 1px solid color-mix(in srgb, var(--accent-strong) 44%, #cfd8e2 56%);
                opacity: 1;
                filter: none;
            }

            #linuxdo-autoscroll-panel.minimized[data-state="running"]::after,
            #linuxdo-autoscroll-panel.minimized[data-state="loading"]::after,
            #linuxdo-autoscroll-panel.minimized[data-state="waiting"]::after {
                background: #d8e1eb;
                box-shadow: 0 0 0 4px color-mix(in srgb, #d8e1eb 12%, transparent);
                animation: autoscroll-minimized-dot-pulse 1.8s ease-in-out infinite;
            }

            #linuxdo-autoscroll-panel.minimized[data-state="done"]::after {
                background: color-mix(in srgb, #c8d2dd 80%, transparent);
                box-shadow: 0 0 0 4px color-mix(in srgb, #c8d2dd 8%, transparent);
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-title {
                font-size: 0;
                position: relative;
                z-index: 1;
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-icon {
                color: #d9e2ec;
                background: color-mix(in srgb, #ffffff 5%, transparent);
                box-shadow:
                    inset 0 1px 0 color-mix(in srgb, #ffffff 8%, transparent),
                    0 6px 14px color-mix(in srgb, #000000 20%, transparent);
                width: 28px;
                height: 28px;
                border-radius: 12px;
                border: 1px solid color-mix(in srgb, #ffffff 10%, transparent);
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-icon svg {
                width: 20px;
                height: 20px;
                stroke-width: 2.15;
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-heading,
            #linuxdo-autoscroll-panel.minimized .autoscroll-header-actions,
            #linuxdo-autoscroll-panel.minimized .autoscroll-content {
                display: none;
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-header {
                border-bottom: none;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100%;
                cursor: pointer;
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-minimize-btn {
                display: none;
            }

            /* ===== Scrolling Pulse Animation ===== */
            #linuxdo-autoscroll-panel.minimized.scrolling {
                animation: linuxdo-autoscroll-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }

            @keyframes linuxdo-autoscroll-pulse {
                0%, 100% {
                    transform: translate(var(--tx, 0px), var(--ty, 0px)) scale(1);
                    box-shadow: 0 10px 24px color-mix(in srgb, var(--accent-deep) 22%, transparent);
                }
                50% {
                    transform: translate(var(--tx, 0px), var(--ty, 0px)) scale(1.04);
                    box-shadow: 0 16px 30px color-mix(in srgb, var(--accent-deep) 28%, transparent);
                }
            }

            @keyframes autoscroll-minimized-dot-pulse {
                0%, 100% {
                    transform: scale(1);
                    box-shadow: 0 0 0 4px color-mix(in srgb, #d8e1eb 12%, transparent);
                }
                50% {
                    transform: scale(1.18);
                    box-shadow: 0 0 0 7px color-mix(in srgb, #d8e1eb 8%, transparent);
                }
            }

            @media (max-width: 640px) {
                #linuxdo-autoscroll-panel {
                    top: 82px;
                    right: 12px;
                    min-width: 232px;
                }
            }
        `);

        document.body.appendChild(panel);

        // 应用保存的位置
        if (settings.position.x !== 0 || settings.position.y !== 0) {
            panel.style.setProperty('--tx', `${settings.position.x}px`);
            panel.style.setProperty('--ty', `${settings.position.y}px`);
        }

        // 确保初始位置不出屏幕
        requestAnimationFrame(() => {
            const rect = panel.getBoundingClientRect();
            const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
            const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
            const clampedLeft = Math.min(Math.max(rect.left, 8), maxLeft);
            const clampedTop = Math.min(Math.max(rect.top, 8), maxTop);

            if (clampedLeft !== rect.left || clampedTop !== rect.top) {
                const deltaX = clampedLeft - rect.left;
                const deltaY = clampedTop - rect.top;
                settings.position = {
                    x: settings.position.x + deltaX,
                    y: settings.position.y + deltaY
                };
                StorageManager.save(settings);
            }
        });


        return panel;
    }

    // 添加拖拽功能
    function makeDraggable(panel, settings) {
        const header = panel.querySelector('.autoscroll-header');
        const debouncedSave = StorageManager.createDebouncedSave(500);

        let isDragging = false;
        let hasMoved = false; // 是否真正拖动过（有位移）
        let currentX = 0;
        let currentY = 0;
        let initialX = 0;
        let initialY = 0;
        let xOffset = settings.position.x;  // 从保存的设置初始化
        let yOffset = settings.position.y;  // 从保存的设置初始化

        // 鼠标事件
        header.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        // 触摸事件
        header.addEventListener('touchstart', dragStart, { passive: false });
        document.addEventListener('touchmove', drag, { passive: false });
        document.addEventListener('touchend', dragEnd);

        let rafId = null;
        let pendingX = 0;
        let pendingY = 0;
        const edgePadding = 8;
        const snapThreshold = 24;

        function clampOffset(x, y) {
            const rect = panel.getBoundingClientRect();
            const deltaX = x - xOffset;
            const deltaY = y - yOffset;
            const nextLeft = rect.left + deltaX;
            const nextTop = rect.top + deltaY;
            const maxLeft = Math.max(edgePadding, window.innerWidth - rect.width - edgePadding);
            const maxTop = Math.max(edgePadding, window.innerHeight - rect.height - edgePadding);
            const clampedLeft = Math.min(Math.max(nextLeft, edgePadding), maxLeft);
            const clampedTop = Math.min(Math.max(nextTop, edgePadding), maxTop);

            return {
                x: xOffset + (clampedLeft - rect.left),
                y: yOffset + (clampedTop - rect.top)
            };
        }

        function applyClampedPosition() {
            const clamped = clampOffset(xOffset, yOffset);

            if (clamped.x !== xOffset || clamped.y !== yOffset) {
                xOffset = clamped.x;
                yOffset = clamped.y;
                setTranslate(xOffset, yOffset, panel);
                settings.position = { x: xOffset, y: yOffset };
                debouncedSave(settings);
            }
        }

        function applySnapPosition() {
            const rect = panel.getBoundingClientRect();
            const maxLeft = Math.max(edgePadding, window.innerWidth - rect.width - edgePadding);
            const maxTop = Math.max(edgePadding, window.innerHeight - rect.height - edgePadding);
            let targetLeft = rect.left;
            let targetTop = rect.top;

            if (rect.left - edgePadding <= snapThreshold) {
                targetLeft = edgePadding;
            } else if (maxLeft - rect.left <= snapThreshold) {
                targetLeft = maxLeft;
            }

            if (rect.top - edgePadding <= snapThreshold) {
                targetTop = edgePadding;
            } else if (maxTop - rect.top <= snapThreshold) {
                targetTop = maxTop;
            }

            if (targetLeft !== rect.left || targetTop !== rect.top) {
                xOffset += targetLeft - rect.left;
                yOffset += targetTop - rect.top;
                setTranslate(xOffset, yOffset, panel);
                settings.position = { x: xOffset, y: yOffset };
                debouncedSave(settings);
            }
        }

        function dragStart(e) {
            if (e.target.closest('.autoscroll-minimize-btn')) {
                return; // 如果点击的是最小化按钮，不拖拽
            }

            const coords = EventNormalizer.getClientCoordinates(e);
            initialX = coords.clientX - xOffset;
            initialY = coords.clientY - yOffset;
            isDragging = true;
            hasMoved = false;
            panel.classList.add('dragging');
        }

        function drag(e) {
            if (!isDragging) {
                return;
            }

            e.preventDefault(); // 防止移动设备上的页面滚动

            const coords = EventNormalizer.getClientCoordinates(e);
            currentX = coords.clientX - initialX;
            currentY = coords.clientY - initialY;

            // 检测是否有实际位移（3px 阈值）
            if (Math.abs(currentX - xOffset) > 3 || Math.abs(currentY - yOffset) > 3) {
                hasMoved = true;
            }

            const clamped = clampOffset(currentX, currentY);
            xOffset = clamped.x;
            yOffset = clamped.y;
            pendingX = clamped.x;
            pendingY = clamped.y;

            if (rafId === null) {
                rafId = requestAnimationFrame(() => {
                    setTranslate(pendingX, pendingY, panel);
                    rafId = null;
                });
            }
        }

        function dragEnd(e) {
            initialX = currentX;
            initialY = currentY;
            isDragging = false;
            panel.classList.remove('dragging');

            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
                setTranslate(xOffset, yOffset, panel);
            }

            applyClampedPosition();
            applySnapPosition();

            // 保存位置到 localStorage（防抖）
            if (hasMoved) {
                settings.position = { x: xOffset, y: yOffset };
                debouncedSave(settings);

                // 如果拖动过，延迟重置标志，防止触发单击事件
                setTimeout(() => {
                    hasMoved = false;
                }, 100);
            }
        }


        function setTranslate(xPos, yPos, el) {
            el.style.setProperty('--tx', `${xPos}px`);
            el.style.setProperty('--ty', `${yPos}px`);
        }

        // 返回 API 对象
        return {
            hasRecentlyDragged: () => hasMoved,
            getPosition: () => ({ x: xOffset, y: yOffset }),
            clampToViewport: applyClampedPosition,
            snapToEdges: applySnapPosition
        };

    }

    // 初始化控制面板
    // 加载保存的设置
    const settings = StorageManager.load();
    const debouncedSaveSettings = StorageManager.createDebouncedSave(500);

    // 使用保存的设置初始化控制面板
    const panel = createControlPanel(settings);

    // 从设置中初始化 targetSpeed
    targetSpeed = settings.speed;

    // 添加拖拽功能，并获取 API 对象
    const dragAPI = makeDraggable(panel, settings);

    // 切换最小化状态
    function toggleMinimize(forceState = null) {
        const isMinimized = forceState !== null ? forceState : !panel.classList.contains('minimized');

        if (isMinimized) {
            panel.classList.add('minimized');
        } else {
            panel.classList.remove('minimized');
        }

        settings.isMinimized = isMinimized;
        StorageManager.save(settings);
    }

    // 最小化按钮
    const minimizeBtn = document.getElementById('autoscroll-minimize');
    minimizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMinimize();
    });

    // 双击标题栏也可以最小化/展开
    const header = document.getElementById('autoscroll-header');
    header.addEventListener('dblclick', (e) => {
        if (!e.target.closest('.autoscroll-minimize-btn')) {
            toggleMinimize();
        }
    });

    // 单击标题栏在最小化状态下展开
    header.addEventListener('click', (e) => {
        // 如果刚刚拖动过，不展开
        if (dragAPI.hasRecentlyDragged()) {
            return;
        }

        if (panel.classList.contains('minimized') && !e.target.closest('.autoscroll-minimize-btn')) {
            toggleMinimize(false);
        }
    });

    // 视口变化时收回到可视范围内
    window.addEventListener('resize', () => {
        dragAPI.clampToViewport();
        dragAPI.snapToEdges();
    });


    // 获取元素
    const toggleBtn = document.getElementById('autoscroll-toggle');
    const speedSlider = document.getElementById('autoscroll-speed');
    const speedValue = document.getElementById('speed-value');
    const modeChip = document.getElementById('autoscroll-mode-chip');
    const statusText = document.getElementById('autoscroll-status-text');

    function setStatus(text, state = panel.dataset.state || 'idle') {
        statusText.textContent = text;
        panel.dataset.state = state;
        modeChip.textContent = STATE_LABELS[state] || STATE_LABELS.idle;
    }

    function syncSpeedControl(value) {
        speedValue.textContent = formatSpeedValue(value);
        panel.style.setProperty('--speed-progress', getSpeedProgress(value));
    }

    syncSpeedControl(settings.speed);
    setStatus('就绪', 'idle');

    // 开始/停止滚动
    function toggleScroll() {
        if (isScrolling) {
            stopScroll();
        } else {
            startScroll();
        }
    }

    // 开始滚动
    function startScroll() {
        isScrolling = true;
        noChangeCount = 0; // 重置无变化计数
        lastScrollHeight = document.documentElement.scrollHeight; // 初始化高度
        lastFrameTime = performance.now();
        toggleBtn.innerHTML = getToggleButtonContent('pause', '暂停滚动');
        toggleBtn.classList.add('scrolling-active');
        setStatus('正在滚动...', 'running');

        // 最小化状态时显示脉冲动画
        panel.classList.add('scrolling');

        // 滚动动画
        function scrollLoop(timestamp) {
            if (!isScrolling) return;

            const deltaTime = timestamp - lastFrameTime;
            lastFrameTime = timestamp;

            // 平滑加速到目标速度
            if (currentSpeed < targetSpeed) {
                currentSpeed = Math.min(currentSpeed + 0.1, targetSpeed);
            } else if (currentSpeed > targetSpeed) {
                currentSpeed = Math.max(currentSpeed - 0.1, targetSpeed);
            }

            const scrollHeight = document.documentElement.scrollHeight;
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const clientHeight = document.documentElement.clientHeight;
            const distanceToBottom = scrollHeight - (scrollTop + clientHeight);

            // 检测页面高度是否变化（Discourse懒加载新内容）
            if (scrollHeight > lastScrollHeight) {
                setStatus('加载新内容...', 'loading');
                noChangeCount = 0; // 重置无变化计数
            } else if (distanceToBottom < CONFIG.BOTTOM_THRESHOLD) {
                // 到达或接近底部，增加等待计数
                noChangeCount++;
            }

            lastScrollHeight = scrollHeight;

            // 如果长时间（配置的时间）页面高度没有变化，才真正停止
            const maxWaitFrames = CONFIG.WAIT_TIME_SECONDS * 60;
            if (noChangeCount > maxWaitFrames) {
                stopScroll('已到达底部', 'done');
                return;
            }

            // 显示等待状态
            if (distanceToBottom < CONFIG.BOTTOM_THRESHOLD && noChangeCount > 60) {
                const waitSeconds = Math.ceil((maxWaitFrames - noChangeCount) / 60);
                setStatus(`等待加载... ${waitSeconds}s`, 'waiting');
            } else if (noChangeCount <= 60 && distanceToBottom < CONFIG.BOTTOM_THRESHOLD) {
                setStatus('触发加载...', 'waiting');
            } else {
                setStatus('正在滚动...', 'running');
            }

            // 继续滚动（即使到达底部也继续滚动，以触发懒加载）
            window.scrollBy(0, currentSpeed);

            scrollRafId = requestAnimationFrame(scrollLoop);
        }

        scrollRafId = requestAnimationFrame(scrollLoop);
    }

    // 停止滚动
    function stopScroll(status = '已暂停', state = 'paused') {
        isScrolling = false;
        toggleBtn.innerHTML = getToggleButtonContent('play', '继续滚动');
        toggleBtn.classList.remove('scrolling-active');
        setStatus(status, state);

        // 移除脉冲动画
        panel.classList.remove('scrolling');

        if (scrollRafId !== null) {
            cancelAnimationFrame(scrollRafId);
            scrollRafId = null;
        }
        currentSpeed = 0;
    }

    // 切换按钮点击事件
    toggleBtn.addEventListener('click', toggleScroll);

    // 速度滑块事件
    speedSlider.addEventListener('input', (e) => {
        targetSpeed = parseFloat(e.target.value);
        syncSpeedControl(targetSpeed);
        statusText.textContent = `速度: ${formatSpeedValue(targetSpeed)}`;

        // 保存速度设置（防抖）
        settings.speed = targetSpeed;
        debouncedSaveSettings(settings);
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        // Alt + S: 开始/停止
        if (e.altKey && e.key === 's') {
            e.preventDefault();
            toggleScroll();
        }
        // Alt + ↑/↓: 调整速度
        if (e.altKey && e.key === 'ArrowUp') {
            e.preventDefault();
            targetSpeed = Math.min(targetSpeed + 0.5, CONFIG.MAX_SPEED);
            speedSlider.value = targetSpeed;
            syncSpeedControl(targetSpeed);
            statusText.textContent = `速度: ${formatSpeedValue(targetSpeed)}`;

            // 保存速度设置（防抖）
            settings.speed = targetSpeed;
            debouncedSaveSettings(settings);
        }
        if (e.altKey && e.key === 'ArrowDown') {
            e.preventDefault();
            targetSpeed = Math.max(targetSpeed - 0.5, CONFIG.MIN_SPEED);
            speedSlider.value = targetSpeed;
            syncSpeedControl(targetSpeed);
            statusText.textContent = `速度: ${formatSpeedValue(targetSpeed)}`;

            // 保存速度设置（防抖）
            settings.speed = targetSpeed;
            debouncedSaveSettings(settings);
        }
    });

    // 监听页面可见性变化（根据配置决定是否启用）
    if (CONFIG.AUTO_PAUSE_ON_HIDE) {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && isScrolling) {
                stopScroll('页面隐藏，自动暂停', 'paused');
            }
        });
    }

    console.log('Linux.do 自动滚动助手已加载');
    console.log('快捷键: Alt+S 开始/暂停, Alt+↑/↓ 调整速度');
})();
