// ==UserScript==
// @name         Linux.do 自动滚动阅读助手
// @namespace    http://tampermonkey.net/
// @version      1.5.2
// @description  为 linux.do 论坛添加自动滚动功能，支持速度调节、暂停/继续、智能处理 Discourse 懒加载、可拖拽浮动面板，图标样式最小化，运行状态显示
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
                    <span class="autoscroll-icon">📖</span>
                    <span class="autoscroll-text">自动滚动助手</span>
                </span>
                <button class="autoscroll-minimize-btn" id="autoscroll-minimize" title="最小化">−</button>
            </div>
            <div class="autoscroll-content">
                <button id="autoscroll-toggle" class="autoscroll-btn autoscroll-btn-primary">
                    ▶️ 开始滚动
                </button>
                <div class="autoscroll-controls">
                    <div class="autoscroll-speed-control">
                        <label>速度: <span id="speed-value">${settings.speed}</span></label>
                        <input type="range" id="autoscroll-speed" min="${CONFIG.MIN_SPEED}" max="${CONFIG.MAX_SPEED}" step="0.5" value="${settings.speed}">
                    </div>
                </div>
                <div class="autoscroll-status" id="autoscroll-status">就绪</div>
            </div>
        `;

        // 添加样式
        GM_addStyle(`
            #linuxdo-autoscroll-panel {
                position: fixed;
                top: 100px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 0;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                z-index: 99999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: white;
                min-width: 200px;
                transition: all 0.3s ease;
                cursor: move;
                will-change: transform;
            }

            #linuxdo-autoscroll-panel:hover {
                transform: translateY(-2px);
                box-shadow: 0 12px 40px rgba(0,0,0,0.4);
            }

            #linuxdo-autoscroll-panel.dragging {
                transition: none;
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                transform: none;
            }


            .autoscroll-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 15px;
                border-bottom: 1px solid rgba(255,255,255,0.3);
                cursor: move;
                user-select: none;
            }

            .autoscroll-title {
                font-size: 14px;
                font-weight: bold;
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .autoscroll-icon {
                font-size: 14px;
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-title {
                font-size: 18px;
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-icon {
                font-size: 18px;
            }


            #linuxdo-autoscroll-panel.minimized .autoscroll-text {
                display: none;
            }

            .autoscroll-minimize-btn {
                width: 24px;
                height: 24px;
                border: none;
                background: rgba(255,255,255,0.2);
                color: white;
                border-radius: 4px;
                cursor: pointer;
                font-size: 18px;
                line-height: 1;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
            }

            .autoscroll-minimize-btn:hover {
                background: rgba(255,255,255,0.3);
                transform: scale(1.1);
            }

            .autoscroll-content {
                padding: 15px;
                transition: all 0.3s ease;
            }

            #linuxdo-autoscroll-panel.minimized {
                min-width: auto;
                width: 40px;
                height: 40px;
                padding: 0;
                border-radius: 50%;
                cursor: pointer;
            }

            #linuxdo-autoscroll-panel.minimized.scrolling {
                background: linear-gradient(135deg, #4e76ff 0%, #6b5bff 35%, #38d4ff 70%, #7b5cff 100%);
                background-size: 300% 300%;
                animation: linuxdo-autoscroll-pulse 1.4s ease-in-out infinite;
            }

            @keyframes linuxdo-autoscroll-pulse {
                0% {
                    background-position: 0% 50%;
                    box-shadow: 0 0 10px rgba(78,118,255,0.3);
                }
                50% {
                    background-position: 100% 50%;
                    box-shadow: 0 0 28px rgba(56,212,255,0.6);
                }
                100% {
                    background-position: 0% 50%;
                    box-shadow: 0 0 10px rgba(123,92,255,0.3);
                }
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

            .autoscroll-btn {
                width: 100%;
                padding: 10px;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.2s ease;
                margin-bottom: 10px;
            }

            .autoscroll-btn-primary {
                background: white;
                color: #667eea;
            }

            .autoscroll-btn-primary:hover {
                background: #f0f0f0;
                transform: scale(1.02);
            }

            .autoscroll-btn-primary:active {
                transform: scale(0.98);
            }

            .autoscroll-speed-control {
                margin: 10px 0;
            }

            .autoscroll-speed-control label {
                display: block;
                font-size: 12px;
                margin-bottom: 5px;
            }

            .autoscroll-speed-control input[type="range"] {
                width: 100%;
                height: 6px;
                border-radius: 3px;
                background: rgba(255,255,255,0.3);
                outline: none;
                -webkit-appearance: none;
            }

            .autoscroll-speed-control input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: white;
                cursor: pointer;
                box-shadow: 0 2px 6px rgba(0,0,0,0.2);
            }

            .autoscroll-status {
                font-size: 11px;
                text-align: center;
                opacity: 0.8;
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid rgba(255,255,255,0.2);
            }
        `);

        document.body.appendChild(panel);

        // 应用保存的位置
        if (settings.position.x !== 0 || settings.position.y !== 0) {
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
            if (e.target.classList.contains('autoscroll-minimize-btn')) {
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

        minimizeBtn.textContent = isMinimized ? '+' : '−';
        minimizeBtn.title = isMinimized ? '展开' : '最小化';
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
        if (e.target !== minimizeBtn) {
            toggleMinimize();
        }
    });

    // 单击标题栏在最小化状态下展开
    header.addEventListener('click', (e) => {
        // 如果刚刚拖动过，不展开
        if (dragAPI.hasRecentlyDragged()) {
            return;
        }

        if (panel.classList.contains('minimized') && e.target !== minimizeBtn) {
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
        toggleBtn.textContent = '⏸️ 暂停滚动';
        toggleBtn.style.background = '#ff6b6b';
        toggleBtn.style.color = 'white';
        statusDiv.textContent = '正在滚动...';

        // 最小化状态时显示绿色
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
        toggleBtn.textContent = '▶️ 继续滚动';
        toggleBtn.style.background = 'white';
        toggleBtn.style.color = '#667eea';
        statusDiv.textContent = '已暂停';

        // 移除绿色，恢复默认颜色
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

    console.log('🚀 Linux.do 自动滚动助手已加载！');
    console.log('💡 快捷键: Alt+S 开始/暂停, Alt+↑/↓ 调整速度');
})();
