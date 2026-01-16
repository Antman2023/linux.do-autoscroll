// ==UserScript==
// @name         Linux.do 自动滚动阅读助手
// @namespace    http://tampermonkey.net/
// @version      1.5.0
// @description  为 linux.do 论坛添加自动滚动功能，支持速度调节、暂停/继续、智能处理 Discourse 懒加载、可拖拽浮动面板，图标样式最小化
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

    let isScrolling = false;
    let scrollSpeed = CONFIG.INITIAL_SPEED;
    let scrollInterval = null;
    let targetSpeed = 2;
    let currentSpeed = 0;
    let smoothScrollInterval = null;
    let bottomDetectionCount = 0; // 底部检测计数器
    let lastScrollHeight = 0; // 记录上次的页面高度
    let noChangeCount = 0; // 页面高度未变化的计数器

    // 创建控制面板
    function createControlPanel() {
        const panel = document.createElement('div');
        panel.id = 'linuxdo-autoscroll-panel';
        panel.classList.add('minimized'); // 默认最小化
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
                        <label>速度: <span id="speed-value">${CONFIG.INITIAL_SPEED}</span></label>
                        <input type="range" id="autoscroll-speed" min="${CONFIG.MIN_SPEED}" max="${CONFIG.MAX_SPEED}" step="0.5" value="${CONFIG.INITIAL_SPEED}">
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
            }

            #linuxdo-autoscroll-panel:hover {
                transform: translateY(-2px);
                box-shadow: 0 12px 40px rgba(0,0,0,0.4);
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
                font-size: 16px;
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
                width: 50px;
                height: 50px;
                padding: 0;
                border-radius: 50%;
                cursor: pointer;
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

            #linuxdo-autoscroll-panel.minimized .autoscroll-title {
                font-size: 28px;
            }

            #linuxdo-autoscroll-panel.minimized .autoscroll-icon {
                font-size: 28px;
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
        return panel;
    }

    // 添加拖拽功能
    function makeDraggable(panel) {
        const header = panel.querySelector('.autoscroll-header');
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        header.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        function dragStart(e) {
            if (e.target.classList.contains('autoscroll-minimize-btn')) {
                return; // 如果点击的是最小化按钮，不拖拽
            }
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            isDragging = true;
        }

        function drag(e) {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                xOffset = currentX;
                yOffset = currentY;
                setTranslate(currentX, currentY, panel);
            }
        }

        function dragEnd(e) {
            initialX = currentX;
            initialY = currentY;
            isDragging = false;
        }

        function setTranslate(xPos, yPos, el) {
            el.style.transform = `translate(${xPos}px, ${yPos}px)`;
        }
    }

    // 初始化控制面板
    const panel = createControlPanel();

    // 添加拖拽功能
    makeDraggable(panel);

    // 最小化按钮
    const minimizeBtn = document.getElementById('autoscroll-minimize');
    minimizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('minimized');
        minimizeBtn.textContent = panel.classList.contains('minimized') ? '+' : '−';
        minimizeBtn.title = panel.classList.contains('minimized') ? '展开' : '最小化';
    });

    // 双击标题栏也可以最小化/展开
    const header = document.getElementById('autoscroll-header');
    header.addEventListener('dblclick', (e) => {
        if (e.target !== minimizeBtn) {
            panel.classList.toggle('minimized');
            minimizeBtn.textContent = panel.classList.contains('minimized') ? '+' : '−';
            minimizeBtn.title = panel.classList.contains('minimized') ? '展开' : '最小化';
        }
    });

    // 单击标题栏在最小化状态下展开
    header.addEventListener('click', (e) => {
        if (panel.classList.contains('minimized') && e.target !== minimizeBtn) {
            panel.classList.remove('minimized');
            minimizeBtn.textContent = '−';
            minimizeBtn.title = '最小化';
        }
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
        bottomDetectionCount = 0; // 重置底部计数
        noChangeCount = 0; // 重置无变化计数
        lastScrollHeight = document.documentElement.scrollHeight; // 初始化高度
        toggleBtn.textContent = '⏸️ 暂停滚动';
        toggleBtn.style.background = '#ff6b6b';
        toggleBtn.style.color = 'white';
        statusDiv.textContent = '正在滚动...';

        // 平滑加速到目标速度
        smoothScrollInterval = setInterval(() => {
            if (currentSpeed < targetSpeed) {
                currentSpeed = Math.min(currentSpeed + 0.1, targetSpeed);
            } else if (currentSpeed > targetSpeed) {
                currentSpeed = Math.max(currentSpeed - 0.1, targetSpeed);
            }
        }, 50);

        // 执行滚动
        scrollInterval = setInterval(() => {
            const scrollHeight = document.documentElement.scrollHeight;
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const clientHeight = document.documentElement.clientHeight;
            const distanceToBottom = scrollHeight - (scrollTop + clientHeight);

            // 检测页面高度是否变化（Discourse懒加载新内容）
            if (scrollHeight > lastScrollHeight) {
                // 页面高度增长，说明新内容已加载
                const addedPosts = Math.floor((scrollHeight - lastScrollHeight) / 200); // 估算新增帖子数
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
        }, 16); // 约60fps
    }

    // 停止滚动
    function stopScroll() {
        isScrolling = false;
        toggleBtn.textContent = '▶️ 继续滚动';
        toggleBtn.style.background = 'white';
        toggleBtn.style.color = '#667eea';
        statusDiv.textContent = '已暂停';

        clearInterval(scrollInterval);
        clearInterval(smoothScrollInterval);
        currentSpeed = 0;
    }

    // 切换按钮点击事件
    toggleBtn.addEventListener('click', toggleScroll);

    // 速度滑块事件
    speedSlider.addEventListener('input', (e) => {
        targetSpeed = parseFloat(e.target.value);
        speedValue.textContent = targetSpeed;
        statusDiv.textContent = `速度: ${targetSpeed}`;
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
        }
        if (e.altKey && e.key === 'ArrowDown') {
            e.preventDefault();
            targetSpeed = Math.max(targetSpeed - 0.5, CONFIG.MIN_SPEED);
            speedSlider.value = targetSpeed;
            speedValue.textContent = targetSpeed;
        }
    });

    // 自动跳转到下一个帖子（可选功能）
    function autoNextPost() {
        // 查找"下一话题"按钮
        const nextButton = document.querySelector('.topic-footer-buttons .next') ||
                          document.querySelector('a[href*="/next"]');

        if (nextButton) {
            statusDiv.textContent = '跳转到下一个帖子...';
            setTimeout(() => {
                window.location.href = nextButton.href;
            }, 2000);
        }
    }

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
