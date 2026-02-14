// ==UserScript==
// @name         Linux.do 自动滚动阅读助手
// @namespace    http://tampermonkey.net/
// @version      1.6.0
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

    // 创建控制面板
    function createControlPanel(settings) {
        const panel = document.createElement('div');
        panel.id = 'linuxdo-autoscroll-panel';
        panel.classList.add(settings.isMinimized ? 'minimized' : 'expanded'); // 应用保存的状态
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
                    <span class="autoscroll-text">自动滚动</span>
                </span>
                <button class="autoscroll-minimize-btn" id="autoscroll-minimize" title="最小化">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
            </div>
            <div class="autoscroll-content">
                <button id="autoscroll-toggle" class="autoscroll-btn autoscroll-btn-primary">
                    <span class="btn-icon">▶</span> 开始滚动
                </button>
                <div class="autoscroll-controls">
                    <div class="autoscroll-speed-control">
                        <label>
                            <span>速度</span>
                            <span id="speed-value">${settings.speed}</span>
                        </label>
                        <input type="range" id="autoscroll-speed" min="${CONFIG.MIN_SPEED}" max="${CONFIG.MAX_SPEED}" step="0.5" value="${settings.speed}">
                    </div>
                </div>
                <div class="autoscroll-status" id="autoscroll-status">就绪</div>
            </div>
        `;

        // 添加样式
        GM_addStyle(`
            /* ===== Panel Container ===== */
            #linuxdo-autoscroll-panel {
                position: fixed;
                top: 100px;
                right: 20px;
                background: rgba(255, 255, 255, 0.78);
                background: color-mix(in srgb, var(--secondary, #ffffff) 82%, transparent);
                backdrop-filter: blur(24px) saturate(180%);
                -webkit-backdrop-filter: blur(24px) saturate(180%);
                padding: 0;
                border-radius: 16px;
                border: 1px solid rgba(0, 0, 0, 0.06);
                border: 1px solid color-mix(in srgb, var(--primary, #000000) 6%, transparent);
                box-shadow:
                    0 8px 32px rgba(0, 0, 0, 0.08),
                    0 2px 8px rgba(0, 0, 0, 0.04);
                z-index: 99999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: var(--primary, #1a1a1a);
                min-width: 200px;
                transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
                cursor: move;
                will-change: transform;
                --tx: 0;
                --ty: 0;
                overflow: hidden;
            }

            #linuxdo-autoscroll-panel:hover {
                box-shadow:
                    0 12px 40px rgba(0, 0, 0, 0.12),
                    0 4px 12px rgba(0, 0, 0, 0.06);
                transform: translate(var(--tx, 0), var(--ty, 0)) translateY(-1px);
            }

            #linuxdo-autoscroll-panel.dragging {
                transition: none;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
                transform: none;
                animation: none !important;
            }

            /* ===== Header ===== */
            .autoscroll-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 14px;
                border-bottom: 1px solid rgba(0, 0, 0, 0.05);
                border-bottom: 1px solid color-mix(in srgb, var(--primary, #000000) 5%, transparent);
                cursor: move;
                user-select: none;
            }

            .autoscroll-title {
                font-size: 13px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 7px;
                color: var(--primary, #333);
                letter-spacing: 0.2px;
            }

            .autoscroll-icon {
                display: flex;
                align-items: center;
                color: var(--tertiary, #4a90d9);
            }

            /* ===== Minimize Button ===== */
            .autoscroll-minimize-btn {
                width: 22px;
                height: 22px;
                border: none;
                background: rgba(0, 0, 0, 0.05);
                background: color-mix(in srgb, var(--primary, #000000) 5%, transparent);
                color: var(--primary, #666);
                border-radius: 6px;
                cursor: pointer;
                font-size: 16px;
                line-height: 1;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                opacity: 0.45;
            }

            .autoscroll-minimize-btn:hover {
                background: rgba(0, 0, 0, 0.1);
                background: color-mix(in srgb, var(--primary, #000000) 10%, transparent);
                opacity: 1;
                transform: scale(1.1);
            }

            /* ===== Content Area ===== */
            .autoscroll-content {
                padding: 12px 14px 14px;
            }

            /* ===== Action Button ===== */
            .autoscroll-btn {
                width: 100%;
                padding: 9px 16px;
                border: none;
                border-radius: 10px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                margin-bottom: 10px;
                letter-spacing: 0.3px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }

            .autoscroll-btn .btn-icon {
                font-size: 11px;
            }

            .autoscroll-btn-primary {
                background: var(--tertiary, #4a90d9);
                color: #fff;
            }

            .autoscroll-btn-primary:hover {
                filter: brightness(1.1);
                transform: scale(1.02);
                box-shadow: 0 4px 14px rgba(74, 144, 217, 0.3);
                box-shadow: 0 4px 14px color-mix(in srgb, var(--tertiary, #4a90d9) 30%, transparent);
            }

            .autoscroll-btn-primary:active {
                transform: scale(0.97);
                filter: brightness(0.95);
            }

            .autoscroll-btn-primary.scrolling-active {
                background: #ef4444;
            }

            .autoscroll-btn-primary.scrolling-active:hover {
                box-shadow: 0 4px 14px rgba(239, 68, 68, 0.3);
            }

            /* ===== Speed Control ===== */
            .autoscroll-speed-control {
                margin: 6px 0;
            }

            .autoscroll-speed-control label {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 12px;
                margin-bottom: 8px;
                opacity: 0.55;
                font-weight: 500;
            }

            .autoscroll-speed-control input[type="range"] {
                width: 100%;
                height: 4px;
                border-radius: 2px;
                background: rgba(0, 0, 0, 0.08);
                background: color-mix(in srgb, var(--primary, #000000) 8%, transparent);
                outline: none;
                -webkit-appearance: none;
                transition: background 0.2s;
            }

            .autoscroll-speed-control input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: var(--tertiary, #4a90d9);
                cursor: pointer;
                box-shadow: 0 1px 6px rgba(74, 144, 217, 0.35);
                transition: all 0.2s ease;
                border: 2px solid #fff;
            }

            .autoscroll-speed-control input[type="range"]::-webkit-slider-thumb:hover {
                transform: scale(1.2);
            }

            .autoscroll-speed-control input[type="range"]::-moz-range-thumb {
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: var(--tertiary, #4a90d9);
                cursor: pointer;
                border: 2px solid #fff;
                box-shadow: 0 1px 6px rgba(74, 144, 217, 0.35);
            }

            .autoscroll-speed-control input[type="range"]::-moz-range-track {
                height: 4px;
                border-radius: 2px;
                background: rgba(0, 0, 0, 0.08);
                border: none;
            }

            /* ===== Status ===== */
            .autoscroll-status {
                font-size: 11px;
                text-align: center;
                opacity: 0.4;
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid rgba(0, 0, 0, 0.05);
                border-top: 1px solid color-mix(in srgb, var(--primary, #000000) 5%, transparent);
                font-weight: 500;
                letter-spacing: 0.3px;
            }

            /* ===== Minimized State ===== */
            #linuxdo-autoscroll-panel.minimized {
                min-width: auto;
                width: 42px;
                height: 42px;
                padding: 0;
                border-radius: 50%;
                cursor: pointer;
                background: var(--tertiary, #4a90d9);
                border: 2px solid rgba(255, 255, 255, 0.25);
                box-shadow: 0 4px 16px rgba(74, 144, 217, 0.3);
                box-shadow: 0 4px 16px color-mix(in srgb, var(--tertiary, #4a90d9) 30%, transparent);
            }

            #linuxdo-autoscroll-panel.minimized:hover {
                transform: translate(var(--tx, 0), var(--ty, 0)) scale(1.1);
                box-shadow: 0 6px 24px rgba(74, 144, 217, 0.4);
                box-shadow: 0 6px 24px color-mix(in srgb, var(--tertiary, #4a90d9) 45%, transparent);
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-title {
                font-size: 16px;
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-icon {
                color: #fff;
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-icon svg {
                width: 18px;
                height: 18px;
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-text {
                display: none;
            }

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
                    transform: translate(var(--tx, 0), var(--ty, 0)) scale(1);
                    box-shadow: 0 4px 16px rgba(74, 144, 217, 0.3);
                }
                50% {
                    transform: translate(var(--tx, 0), var(--ty, 0)) scale(1.12);
                    box-shadow: 0 8px 28px rgba(74, 144, 217, 0.5);
                }
            }
        `);

        document.body.appendChild(panel);

        // 应用保存的位置
        if (settings.position.x !== 0 || settings.position.y !== 0) {
            panel.style.setProperty('--tx', `${settings.position.x}px`);
            panel.style.setProperty('--ty', `${settings.position.y}px`);
            panel.style.transform = `translate(${settings.position.x}px, ${settings.position.y}px)`;
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
                panel.style.transform = `translate(${settings.position.x}px, ${settings.position.y}px)`;
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
            el.style.transform = `translate(${xPos}px, ${yPos}px)`;
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
    const statusDiv = document.getElementById('autoscroll-status');

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
        toggleBtn.innerHTML = '<span class="btn-icon">⏸</span> 暂停滚动';
        toggleBtn.classList.add('scrolling-active');
        statusDiv.textContent = '正在滚动...';

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
                statusDiv.textContent = `加载新内容...`;
                noChangeCount = 0; // 重置无变化计数
            } else if (distanceToBottom < CONFIG.BOTTOM_THRESHOLD) {
                // 到达或接近底部，增加等待计数
                noChangeCount++;
            }

            lastScrollHeight = scrollHeight;

            // 如果长时间（配置的时间）页面高度没有变化，才真正停止
            const maxWaitFrames = CONFIG.WAIT_TIME_SECONDS * 60;
            if (noChangeCount > maxWaitFrames) {
                statusDiv.textContent = '已到达底部';
                stopScroll();
                return;
            }

            // 显示等待状态
            if (distanceToBottom < CONFIG.BOTTOM_THRESHOLD && noChangeCount > 60) {
                const waitSeconds = Math.ceil((maxWaitFrames - noChangeCount) / 60);
                statusDiv.textContent = `等待加载... ${waitSeconds}s`;
            } else if (noChangeCount <= 60 && distanceToBottom < CONFIG.BOTTOM_THRESHOLD) {
                statusDiv.textContent = '触发加载...';
            }

            // 继续滚动（即使到达底部也继续滚动，以触发懒加载）
            window.scrollBy(0, currentSpeed);

            scrollRafId = requestAnimationFrame(scrollLoop);
        }

        scrollRafId = requestAnimationFrame(scrollLoop);
    }

    // 停止滚动
    function stopScroll() {
        isScrolling = false;
        toggleBtn.innerHTML = '<span class="btn-icon">▶</span> 继续滚动';
        toggleBtn.classList.remove('scrolling-active');
        statusDiv.textContent = '已暂停';

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
        speedValue.textContent = targetSpeed;
        statusDiv.textContent = `速度: ${targetSpeed}`;

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
            speedValue.textContent = targetSpeed;

            // 保存速度设置（防抖）
            settings.speed = targetSpeed;
            debouncedSaveSettings(settings);
        }
        if (e.altKey && e.key === 'ArrowDown') {
            e.preventDefault();
            targetSpeed = Math.max(targetSpeed - 0.5, CONFIG.MIN_SPEED);
            speedSlider.value = targetSpeed;
            speedValue.textContent = targetSpeed;

            // 保存速度设置（防抖）
            settings.speed = targetSpeed;
            debouncedSaveSettings(settings);
        }
    });

    // 监听页面可见性变化（根据配置决定是否启用）
    if (CONFIG.AUTO_PAUSE_ON_HIDE) {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && isScrolling) {
                stopScroll();
                statusDiv.textContent = '页面隐藏，自动暂停';
            }
        });
    }

    console.log('Linux.do 自动滚动助手已加载');
    console.log('快捷键: Alt+S 开始/暂停, Alt+↑/↓ 调整速度');
})();
