// protected-site/html/collector.js
(function() {
    const CHECK_URL = '/api/check';
    const BEHAVIOR_URL = (sessionId) => `/api/behavior/${sessionId}`;
    const FLUSH_INTERVAL = 3000;        
    const MAX_BATCH_SIZE = 100;          
    
    const siteMeta = document.querySelector('meta[name="humanguard-site-id"]');
    const SITE_ID = siteMeta ? siteMeta.getAttribute('content') : null;
    
    if (!SITE_ID) {
        console.warn('[HumanGuard] site-id не найден. Коллектор не будет работать.');
        return;
    }
    
    let sessionId = null;
    let eventBuffer = [];
    let flushTimer = null;
    let checkInProgress = false;
    
    async function sendData(endpoint, data) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Site-ID': SITE_ID
                },
                body: JSON.stringify(data),
                credentials: 'include',    
                keepalive: true              
            });
            
            if (!response.ok) {
                console.warn(`[HumanGuard] Ошибка отправки: ${response.status}`);
                return null;
            }
            
            return await response.json();
        } catch (err) {
            console.error('[HumanGuard] Ошибка сети:', err);
            return null;
        }
    }
    
    async function flushEvents() {
        if (!sessionId || eventBuffer.length === 0) return;
        
        const eventsToSend = [...eventBuffer];
        eventBuffer = [];
        
        const counters = {};
        eventsToSend.forEach(event => {
            counters[event.type] = (counters[event.type] || 0) + 1;
        });
        
        const metrics = {
            counters: counters,
            sample_events: eventsToSend.slice(-20),  
            session_duration_ms: Date.now() - (window.performance.timing?.navigationStart || Date.now()),
            screen_resolution: `${window.screen.width}x${window.screen.height}`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            timestamp: new Date().toISOString()
        };
        
        if (window.navigator) {
            metrics.fingerprint = {
                user_agent: window.navigator.userAgent,
                language: window.navigator.language,
                platform: window.navigator.platform,
                hardware_concurrency: window.navigator.hardwareConcurrency,
                device_memory: window.navigator.deviceMemory,
                do_not_track: window.navigator.doNotTrack
            };
        }
        
        const result = await sendData(BEHAVIOR_URL(sessionId), {
            session_id: sessionId,
            metrics: metrics
        });
        
        if (result && result.risk_score !== undefined) {
            console.log(`[HumanGuard] Текущий риск: ${result.risk_score}/100`);
            if (result.risk_score >= 80) {
                console.warn('[HumanGuard] Сессия заблокирована!');
            }
        }
    }
    
    function addEvent(type, data = {}) {
        if (!sessionId) return;
        
        eventBuffer.push({
            type: type,
            timestamp: Date.now(),
            data: data
        });
        
        if (eventBuffer.length >= MAX_BATCH_SIZE) {
            flushEvents();
        }
    }
    
    async function initSession() {
        if (checkInProgress) return;
        checkInProgress = true;
        
        try {
            const result = await sendData(CHECK_URL, {
                site_id: SITE_ID
            });
            
            if (result && result.session_id) {
                sessionId = result.session_id;
                console.log('[HumanGuard] Сессия создана:', sessionId, 'Action:', result.action);
                
                if (result.action === 'block') {
                    showBlockPage(result.message || 'Доступ заблокирован');
                } else if (result.action === 'captcha') {
                    showCaptcha();
                } else {
                    startCollection();
                }
            }
        } catch (err) {
            console.error('[HumanGuard] Ошибка инициализации:', err);
        } finally {
            checkInProgress = false;
        }
    }
    
    function showBlockPage(message) {
        document.body.innerHTML = `
            <div style="text-align: center; padding: 50px; font-family: Arial, sans-serif;">
                <h1>🚫 Доступ запрещён</h1>
                <p>${message || 'Ваша активность распознана как автоматическая.'}</p>
                <p>Код ошибки: HG-BLOCK-001</p>
            </div>
        `;
    }
    
    function showCaptcha() {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        `;
        
        modal.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 10px; text-align: center;">
                <h2>🔒 Проверка безопасности</h2>
                <div class="h-captcha" data-sitekey="10000000-ffff-ffff-ffff-000000000001"></div>
                <p>Пожалуйста, подтвердите, что вы человек</p>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const script = document.createElement('script');
        script.src = 'https://js.hcaptcha.com/1/api.js';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
    }
    
    // Сбор событий
    function startCollection() {
        let scrollTimeout;
        let mouseMoveTimeout;
        
        document.addEventListener('click', (e) => {
            addEvent('click', {
                target: e.target.tagName,
                x: e.clientX,
                y: e.clientY
            });
        });
        
        document.addEventListener('mousemove', (e) => {
            if (mouseMoveTimeout) return;
            mouseMoveTimeout = setTimeout(() => {
                addEvent('mouse_move', {
                    x: e.clientX,
                    y: e.clientY
                });
                mouseMoveTimeout = null;
            }, 100);
        });
        
        window.addEventListener('scroll', () => {
            if (scrollTimeout) return;
            scrollTimeout = setTimeout(() => {
                addEvent('scroll', {
                    scrollY: window.scrollY,
                    scrollX: window.scrollX
                });
                scrollTimeout = null;
            }, 200);
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Alt' || e.key === 'Control' || e.key === 'Shift') return;
            
            addEvent('keydown', {
                key: e.key,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                shiftKey: e.shiftKey
            });
        });
        
        window.addEventListener('blur', () => addEvent('blur'));
        window.addEventListener('focus', () => addEvent('focus'));
        
        window.addEventListener('beforeunload', () => {
            if (eventBuffer.length > 0) {
                flushEvents();
            }
        });
        
        flushTimer = setInterval(() => flushEvents(), FLUSH_INTERVAL);
        
        console.log('[HumanGuard] Сбор поведенческих данных запущен');
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSession);
    } else {
        initSession();
    }
})();