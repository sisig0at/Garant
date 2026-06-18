(async function() {
    'use strict';

    if (typeof supabase === 'undefined' || typeof SUPABASE_CONFIG === 'undefined') return;

    // Принудительная очистка старого небезопасного аккаунта с ID 1
    try {
        var _old = localStorage.getItem('vg_user');
        if (_old) {
            var _parsed = JSON.parse(_old);
            if (_parsed.id == 1) {
                localStorage.clear();
                console.log("Старый небезопасный аккаунт с ID 1 принудительно стерт из localStorage.");
            }
        }
    } catch(e) {}

    const sb = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });

    let currentUser = null;
    let users = [];
    let deals = [];
    let reviews = [];
    let dealMessages = {};
    let fakeOnline = parseInt(localStorage.getItem('cached_online_counter')) || 300;
    let onlineBaseValue = fakeOnline;
    let lastDealsFeedArray = [];
    let isLoginMode = true;
    let isDarkTheme = true;
    let systemStats = { total_deals: 0, total_turnover: 0 };
    window.appNotifications = [];
    const statusTranslations = {
        'opened': 'Открыта',
        'escrow': 'Заморожена (Гарант)',
        'escroy': 'Заморожена (Гарант)',
        'dispute': 'Арбитраж / Спор',
        'completed': 'Успешно завершена',
        'closed': 'Закрыта',
        'cancelled': 'Отменена'
    };
    window.adminCurrentUsersPage = 1;
    let currentDealId = null;
    window.isAdmin = false;
    let supportTickets = [];
    let supportTicketMessages = {};
    let userCurrentTicketId = null;
    let adminCurrentTicketId = null;
    let openTicketCount = 0;

    // ===== ГЛОБАЛЬНЫЙ СЛУШАТЕЛЬ АВТОРИЗАЦИИ =====
    sb.auth.onAuthStateChange(function(event, session) {
        if (event === 'SIGNED_OUT') {
            currentUser = null;
            try { updateUI(); } catch(e) {}
        } else if (session && session.user && session.user.email && users.length > 0) {
            var sessionEmail = session.user.email;
            var u = users.find(function(x) { return x.email === sessionEmail; });
            if (u && !u.banned) {
                currentUser = u;
                verifyAdminRole().then(function() {
                    try { updateUI(); } catch(e) {}
                    if (currentDealId) {
                        try { loadSingleDealPage(currentDealId); } catch(e) {}
                    }
                });
            }
        }
    });

    function showToast(msg) {
        let t = document.createElement('div');
        t.className = 'toast';
        t.innerHTML = '<i class="fas fa-bell"></i> ' + msg;
        document.body.appendChild(t);
        setTimeout(function() { t.remove(); }, 3000);
    }

    function showNotification(text) {
        try {
            var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            var osc = audioCtx.createOscillator();
            var gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
            osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.25);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.25);
        } catch (e) {
            console.log("Звук заблокирован политикой браузера до первого клика.");
        }
        window.appNotifications.unshift({ text: text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) });
        if (window.appNotifications.length > 4) window.appNotifications.pop();
        renderNotificationsList();
        var container = document.getElementById('toast-container');
        if (container) {
            var toast = document.createElement('div');
            toast.style.cssText = 'background:#2a1a5a; color:#fff; padding:12px 16px; border-radius:8px; border-left:4px solid #c084fc; box-shadow:0 4px 12px rgba(0,0,0,0.3); min-width:280px; max-width:360px; opacity:0; transition:opacity 0.3s ease;';
            toast.innerText = text;
            container.appendChild(toast);
            setTimeout(function() { toast.style.opacity = '1'; }, 10);
            setTimeout(function() {
                toast.style.opacity = '0';
                setTimeout(function() { toast.remove(); }, 300);
            }, 4000);
        }
        var badge = document.getElementById('bell-badge');
        if (badge) {
            var count = parseInt(badge.innerText) || 0;
            count++;
            badge.innerText = count;
            badge.classList.remove('hidden');
            var bellWrapper = document.getElementById('bell-wrapper');
            if (bellWrapper) bellWrapper.style.display = 'inline-block';
        }
    }

    function renderNotificationsList() {
        const listContainer = document.getElementById('notifications-list');
        if (!listContainer) return;
        listContainer.innerHTML = '';
        if (!window.appNotifications || window.appNotifications.length === 0) {
            listContainer.innerHTML = '<div style="color:#6b7280; text-align:center; padding:15px 0;">Уведомлений нет</div>';
            return;
        }
        window.appNotifications.forEach(function(notif, idx) {
            const item = document.createElement('div');
            item.style.padding = '12px 14px';
            item.style.borderBottom = idx === window.appNotifications.length - 1 ? 'none' : '1px solid rgba(139, 92, 246, 0.1)';
            item.style.display = 'flex';
            item.style.flexDirection = 'column';
            item.style.gap = '4px';
            item.style.transition = 'background 0.2s';
            item.onmouseover = function() { item.style.background = 'rgba(139, 92, 246, 0.03)'; };
            item.onmouseout = function() { item.style.background = 'none'; };
            item.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                '<span style="color:#6b7280;font-size:11px;font-weight:500;letter-spacing:0.5px;"><i class="fas fa-clock" style="margin-right:4px;color:#a78bfa;"></i> ' + notif.time + '</span>' +
                '</div>' +
                '<div style="font-size:13px;color:#e2e8f0;line-height:1.4;display:flex;align-items:center;gap:8px;">' +
                '<span style="font-size:15px;flex-shrink:0;"><i class="fas fa-bell" style="color:#a78bfa;"></i></span>' +
                '<span>' + notif.text.replace('✅', '').replace('🔔', '').trim() + '</span>' +
                '</div>';
            listContainer.appendChild(item);
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function(m) {
            return m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;';
        });
    }

    function getDisplayName(login) {
        if (!login) return '';
        if (login.startsWith('User#')) return login;
        var u = users.find(function(x) { return x.login === login; });
        return u && u.nickname ? u.nickname : login;
    }

    function getDisplayNameOrLogin(obj) {
        if (!obj) return '';
        return obj.nickname || obj.login || '';
    }

    function anonymizeName(name) {
        if (!name) return 'User#000000';
        if (name.startsWith('User#')) return name;
        var hash = 0;
        for (var i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        var finalId = Math.abs(hash % 900000) + 100000;
        return 'User#' + finalId;
    }

    function getStatusText(status) {
        return { waiting_payment: 'Ожидание оплаты', escroy: 'Деньги на гаранте', completed: 'Завершена', disputed: 'Диспут' }[status] || status;
    }

    function getTrustPercent(user) {
        return Math.min(100, Math.floor((user.total_deposit || 0) / 50000 * 100));
    }

    function truncateId(id) {
        if (!id) return '';
        var s = String(id);
        if (s.length <= 8) return s;
        return s.substring(0, 4) + '...' + s.substring(s.length - 4);
    }

    async function generateShortId() {
        while (true) {
            var code = String(Math.floor(100000 + Math.random() * 900000));
            var exists = users.find(function(u) { return u.short_id === code; });
            if (!exists) return code;
        }
    }

    function findUserByLogin(login) {
        return users.find(function(x) { return x.login === login; });
    }

    async function verifyAdminRole() {
        if (!currentUser || !currentUser.id) {
            window.isAdmin = false;
            return false;
        }
        try {
            const { data, error } = await sb.from('users').select('role').eq('login', currentUser.login).single();
            if (!error && data && data.role === 'admin') {
                currentUser.role = 'admin';
                window.isAdmin = true;
                return true;
            }
        } catch(e) {
            console.error('[AdminCheck] Ошибка верификации роли:', e);
        }
        currentUser.role = 'user';
        window.isAdmin = false;
        return false;
    }

    // ===== SUPABASE DATA FUNCTIONS =====

    async function loadAllData() {
        let r1 = await sb.from('users').select('*');
        if (!r1.error && r1.data) users = r1.data;
        let r2 = await sb.from('deals').select('*').order('id', { ascending: true });
        if (!r2.error && r2.data) deals = r2.data;
        let r3 = await sb.from('reviews').select('*').order('id', { ascending: true });
        if (!r3.error && r3.data) reviews = r3.data;
        // Принудительный сид 6 именных отзывов авторитетных трейдеров, если их нет в БД
        var seedReviews = [
            { user_login: 'zeiten', rating: 4, text: 'Сделка прошла успешно, но продавец долго не выходил на связь. К гаранту претензий нет, холдирование работает четко. 4 звезды.', date: '2026-06-01' },
            { user_login: 'Monter', rating: 5, text: 'Лучший гарант в СНГ сегменте, комиссии минимальные.', date: '2026-06-01' },
            { user_login: 'milawka38', rating: 4, text: 'Сначала залагало пополнение через СБП, испугалась. Но поддержка ответила за 30 секунд и всё зачислила вручную! Сервис надёжный, но за лаг ставлю 4 звезды.', date: '2026-06-01' },
            { user_login: '777', rating: 5, text: 'Работаю тут на постоянной основе, холдирование работает честно.', date: '2026-06-01' },
            { user_login: 'Imprezza', rating: 4, text: 'Дизайн топ, сделки безопасные. Была задержка на выводе крупных средств, пришлось пообщаться с арбитром. В итоге всё вывели. 4 звезды за ожидание, к безопасности вопросов нет.', date: '2026-06-01' },
            { user_login: 'HeDViN', rating: 3, text: 'Долго не мог пройти верификацию почты, выдавало ошибку. Оператор в тикетах помог решить проблему. Сами сделки проходят отлично, ставлю 3 звезды чисто из-за багов с регистрацией.', date: '2026-06-01' },
            { user_login: 'User#834195', rating: 4, text: 'Ошибся в реквизитах при выводе, транзакция зависла. Пришлось писать в поддержку. Ответили минут через 10, деньги вернули на баланс. Ставлю 4 звезды за долгий ответ.', date: '2026-06-02' },
            { user_login: 'User#294105', rating: 3, text: 'Интерфейс красивый, но на мобилке кнопка создания сделки сначала не нажималась. Перезагрузил страницу — заработало. 3 звезды за баги, но саппорт пообещал исправить.', date: '2026-06-02' },
            { user_login: 'User#573921', rating: 4, text: 'Проводил обмен крипты. Курс немного скаканул пока сделка висела в эскроу. В итоге все завершили, но осадочек остался. 4 звезды.', date: '2026-06-02' }
        ];
        var existingLogins = reviews.map(function(r) { return r.user_login; });
        seedReviews.forEach(function(sr) {
            if (existingLogins.indexOf(sr.user_login) === -1) {
                reviews.push(sr);
            }
        });
        let r4 = await sb.from('deal_messages').select('*').order('id', { ascending: true });
        if (!r4.error && r4.data) {
            dealMessages = {};
            r4.data.forEach(function(m) {
                if (!dealMessages[m.deal_id]) dealMessages[m.deal_id] = [];
                dealMessages[m.deal_id].push(m);
            });
        }
        let r5 = await sb.from('system_stats').select('*').eq('id', 1).single();
        if (!r5.error && r5.data) systemStats = r5.data;
        let r6 = await sb.from('support_tickets').select('*').order('id', { ascending: false });
        if (!r6.error && r6.data) supportTickets = r6.data;
        let r7 = await sb.from('ticket_messages').select('*').order('id', { ascending: true });
        if (!r7.error && r7.data) {
            supportTicketMessages = {};
            r7.data.forEach(function(m) {
                if (!supportTicketMessages[m.ticket_id]) supportTicketMessages[m.ticket_id] = [];
                supportTicketMessages[m.ticket_id].push(m);
            });
        }
        recalcOpenTicketCount();
    }

    async function upsertUser(user) {
        if (!user.id) {
            let r = await sb.from('users').insert(user).select();
            if (!r.error && r.data && r.data[0]) {
                users.push(r.data[0]);
                return r.data[0];
            }
            return null;
        }
        let r = await sb.from('users').update(user).eq('id', user.id).select();
        if (!r.error && r.data && r.data[0]) {
            let idx = users.findIndex(function(u) { return u.id === r.data[0].id; });
            if (idx !== -1) users[idx] = r.data[0];
            return r.data[0];
        }
        return user;
    }

    async function insertUser(user) {
        let r = await sb.from('users').insert(user).select();
        if (!r.error && r.data && r.data[0]) {
            users.push(r.data[0]);
            return r.data[0];
        }
        return null;
    }

    async function getSystemStats() {
        let r = await sb.from('system_stats').select('*').eq('id', 1).single();
        if (!r.error && r.data) {
            systemStats = r.data;
            return r.data;
        }
        return systemStats;
    }

    async function updateSystemStats(data) {
        let r = await sb.from('system_stats').update(data).eq('id', 1).select();
        if (!r.error && r.data && r.data[0]) {
            systemStats = r.data[0];
            return r.data[0];
        }
        return null;
    }

    async function insertDeal(deal) {
        let r = await sb.from('deals').insert(deal).select();
        if (!r.error && r.data && r.data[0]) {
            deals.push(r.data[0]);
            return r.data[0];
        }
        return null;
    }

    async function updateDeal(id, data) {
        let r = await sb.from('deals').update(data).eq('id', id).select();
        if (!r.error && r.data && r.data[0]) {
            let idx = deals.findIndex(function(d) { return d.id === id; });
            if (idx !== -1) deals[idx] = r.data[0];
            return r.data[0];
        }
        return null;
    }

    async function deleteDeal(id) {
        await sb.from('deal_messages').delete().eq('deal_id', id);
        await sb.from('ratings').delete().eq('deal_id', id);
        await sb.from('deals').delete().eq('id', id);
        deals = deals.filter(function(d) { return d.id !== id; });
        delete dealMessages[id];
    }

    async function insertReview(review) {
        let r = await sb.from('reviews').insert(review).select();
        if (!r.error && r.data && r.data[0]) {
            reviews.push(r.data[0]);
            return r.data[0];
        }
        return null;
    }

    async function deleteReview(id) {
        await sb.from('reviews').delete().eq('id', id);
        reviews = reviews.filter(function(r) { return r.id !== id; });
    }

    async function insertRating(rating) {
        await sb.from('ratings').insert(rating);
    }

    async function getRatingsForUser(login) {
        let r = await sb.from('ratings').select('*').eq('to_user', login);
        return r.error ? [] : r.data;
    }

    async function getAchievementsForUser(login) {
        let r = await sb.from('achievements').select('*').eq('user_login', login);
        return r.error ? [] : r.data;
    }

    async function insertAchievement(login, name) {
        let r = await sb.from('achievements').insert({ user_login: login, achievement_name: name }).select();
        if (!r.error && r.data) return r.data[0];
        return null;
    }

    async function insertDealMessage(dealId, msg) {
        let r = await sb.from('deal_messages').insert(msg).select();
        if (!r.error && r.data && r.data[0]) {
            if (!dealMessages[dealId]) dealMessages[dealId] = [];
            dealMessages[dealId].push(r.data[0]);
            return r.data[0];
        }
        return null;
    }

    // ===== SUPPORT TICKETS DATA FUNCTIONS =====

    async function loadSupportTicketsFromDB() {
        let r1 = await sb.from('support_tickets').select('*').order('id', { ascending: false });
        if (!r1.error && r1.data) supportTickets = r1.data;
        let r2 = await sb.from('ticket_messages').select('*').order('id', { ascending: true });
        if (!r2.error && r2.data) {
            supportTicketMessages = {};
            r2.data.forEach(function(m) {
                if (!supportTicketMessages[m.ticket_id]) supportTicketMessages[m.ticket_id] = [];
                supportTicketMessages[m.ticket_id].push(m);
            });
        }
        recalcOpenTicketCount();
    }

    function recalcOpenTicketCount() {
        openTicketCount = supportTickets.filter(function(t) { return t.status === 'open'; }).length;
    }

    async function loadUserTickets() {
        if (!currentUser) return;
        
        console.log("Загрузка тикетов для пользователя с ID:", currentUser.id);
        
        const { data, error } = await sb
            .from('support_tickets')
            .select('*')
            .or(`user_id.eq.${currentUser.id},user_short_id.eq.${currentUser.id}`)
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Ошибка загрузки тикетов пользователя:", error.message);
            return;
        }

        console.log("Тикеты пользователя успешно загружены из БД:", data);
        renderUserTicketsList(data);
    }

    function renderUserTicketsList(tickets) {
        let container = document.getElementById('userTicketsList');
        if (!container) return;
        if (!tickets || tickets.length === 0) {
            container.innerHTML = '<p style="color:#888; text-align:center;">У вас нет обращений.</p>';
            return;
        }
        container.innerHTML = tickets.map(function(t) {
            var statusClass = t.status === 'open' ? 'open' : 'closed';
            var statusText = t.status === 'open' ? 'Открыто' : 'Закрыто';
            var activeClass = userCurrentTicketId === t.id ? ' active' : '';
            return '<div class="ticket-item' + activeClass + '" data-ticket-id="' + t.id + '">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                '<span class="ticket-subject">' + escapeHtml(t.subject) + '</span>' +
                '<span class="ticket-status ' + statusClass + '">' + statusText + '</span></div>' +
                '<div style="font-size:12px;color:#888;margin-top:4px;">' + new Date(t.created_at).toLocaleString() + '</div></div>';
        }).join('');
    }

    async function insertTicket(subjectText, messageText) {
        if (!currentUser || !currentUser.id) {
            alert("Ошибка: Пользователь не авторизован");
            return null;
        }
        console.log("Отправка тикета. user_id:", currentUser.id, "user_short_id:", currentUser.short_id);
        const { data, error } = await sb
            .from('support_tickets')
            .insert([
                {
                    user_id: currentUser.id,
                    user_short_id: String(currentUser.short_id || currentUser.id || "1"),
                    subject: subjectText,
                    message: messageText,
                    status: 'open'
                }
            ])
            .select();
        if (error) {
            console.error("Критическая ошибка Supabase при отправке тикета:", error.message);
            alert("Ошибка отправки: " + error.message);
            return null;
        }
        if (data && data[0]) {
            supportTickets.unshift(data[0]);
            recalcOpenTicketCount();
            return data[0];
        }
        return null;
    }

    async function updateTicket(id, data) {
        let r = await sb.from('support_tickets').update(data).eq('id', id).select();
        if (!r.error && r.data && r.data[0]) {
            let idx = supportTickets.findIndex(function(t) { return t.id === id; });
            if (idx !== -1) supportTickets[idx] = r.data[0];
            recalcOpenTicketCount();
            return r.data[0];
        }
        return null;
    }

    async function deleteTicketAndMessages(ticketId) {
        await sb.from('ticket_messages').delete().eq('ticket_id', ticketId);
        await sb.from('support_tickets').delete().eq('id', ticketId);
        supportTickets = supportTickets.filter(function(t) { return t.id !== ticketId; });
        delete supportTicketMessages[ticketId];
        recalcOpenTicketCount();
    }

    async function insertTicketMessage(ticketId, msg) {
        let r = await sb.from('ticket_messages').insert(msg).select();
        if (!r.error && r.data && r.data[0]) {
            if (!supportTicketMessages[ticketId]) supportTicketMessages[ticketId] = [];
            supportTicketMessages[ticketId].push(r.data[0]);
            return r.data[0];
        }
        if (r.error) {
            console.error("[insertTicketMessage] Критическая ошибка Supabase:", r.error.message, r.error.details, r.error.hint);
        }
        return null;
    }

    // ===== ACHIEVEMENTS =====

    async function checkAndAwardAchievements(userLogin) {
        let completedAsSeller = deals.filter(function(d) {
            return d.seller === userLogin && d.status === 'completed';
        });
        let count = completedAsSeller.length;
        let earned = await getAchievementsForUser(userLogin);
        let earnedNames = earned.map(function(a) { return a.achievement_name; });
        let toAward = [];

        if (count >= 1 && !earnedNames.includes('Первая сделка')) toAward.push('Первая сделка');
        if (count >= 10 && !earnedNames.includes('10 сделок')) toAward.push('10 сделок');
        let trustPct = getTrustPercent(users.find(function(u) { return u.login === userLogin; }));
        if (trustPct >= 80 && !earnedNames.includes('Золотой уровень доверия')) toAward.push('Золотой уровень доверия');

        for (let i = 0; i < toAward.length; i++) {
            await insertAchievement(userLogin, toAward[i]);
            showToast('Достижение разблокировано: ' + toAward[i]);
        }
    }

    // ===== UI RENDER =====

    async function updateUI() {
        if (currentUser) {
            localStorage.setItem('vg_user', JSON.stringify({ login: currentUser.login, role: currentUser.role, balance: currentUser.balance }));
        } else {
            localStorage.removeItem('vg_user');
        }
        let isGuest = !currentUser;
        let balEl = document.getElementById('balanceDisplay');
        if (balEl) balEl.innerText = currentUser ? (currentUser.balance || 0).toLocaleString() : '0';

        // Bell wrapper: show only when logged in
        var bellWrapper = document.getElementById('bell-wrapper');
        if (bellWrapper) bellWrapper.style.display = currentUser ? 'inline-block' : 'none';

        // Profile wrapper: show when logged in, hide when guest
        var profileWrapper = document.getElementById('profile-wrapper');
        if (profileWrapper) {
            profileWrapper.style.display = currentUser ? 'flex' : 'none';
        }

        // Auth button: show only for guests
        let authBtn = document.getElementById('authBtn');
        if (authBtn) {
            if (currentUser) {
                authBtn.style.display = 'none';
            } else {
                authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> <span>Вход</span>';
                authBtn.className = 'premium-auth-btn pulse-animation';
                authBtn.style.display = '';
            }
        }

        // Header nickname & avatar
        var headerNick = document.getElementById('header-nickname');
        if (headerNick) {
            headerNick.innerText = currentUser ? getDisplayNameOrLogin(currentUser) : 'Пользователь';
        }
        var headerAvatar = document.getElementById('header-avatar');
        if (headerAvatar) {
            if (currentUser && currentUser.avatar_url) {
                headerAvatar.src = currentUser.avatar_url;
            } else {
                headerAvatar.src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + (currentUser ? currentUser.login : 'default');
            }
        }

        ['navDeals', 'navReviews', 'navSupport'].forEach(function(id) {
            let el = document.getElementById(id);
            if (el) el.style.display = isGuest ? 'none' : 'inline-block';
        });
        let adminLink = document.getElementById('navAdmin');
        if (adminLink) adminLink.style.display = (currentUser && (currentUser.role === 'admin' || window.isAdmin)) ? 'inline-block' : 'none';
        let guestMsg = document.getElementById('guestMessage');
        if (guestMsg) guestMsg.style.display = isGuest ? 'block' : 'none';
        if (currentUser) renderProfile();
    }

    async function renderProfile() {
        if (!currentUser) return;
        document.getElementById('profileName').innerHTML = getDisplayNameOrLogin(currentUser);
        let percent = getTrustPercent(currentUser);
        document.getElementById('trustPercent').innerText = percent;
        document.getElementById('trustProgress').style.width = percent + '%';

        var profileAvatar = document.getElementById('profileAvatar');
        if (profileAvatar) {
            profileAvatar.src = currentUser.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + currentUser.login;
        }

        let userDeals = deals.filter(function(d) {
            return d.seller === currentUser.login || d.buyer === currentUser.login;
        });
        let completedDeals = userDeals.filter(function(d) { return d.status === 'completed'; }).length;
        let container = document.getElementById('profileInfo');
        if (container) {
            container.innerHTML =
                '<p><i class="fas fa-coins"></i> <strong>Баланс:</strong> ' + (currentUser.balance || 0).toLocaleString() + ' ₽</p>' +
                '<p><i class="fas fa-handshake"></i> <strong>Сделок проведено:</strong> ' + completedDeals + '</p>' +
                '<p><i class="fas fa-arrow-up"></i> <strong>Всего пополнений:</strong> ' + (currentUser.total_deposit || 0).toLocaleString() + ' ₽</p>' +
                '<p><i class="fas fa-arrow-down"></i> <strong>Всего выводов:</strong> ' + (currentUser.total_withdraw || 0).toLocaleString() + ' ₽</p>' +
                '<p><i class="fas fa-calendar-alt"></i> <strong>Регистрация:</strong> ' + new Date(currentUser.reg_date).toLocaleDateString() + '</p>' +
                '<p><i class="fas fa-fingerprint"></i> <strong>ID аккаунта:</strong> #' + (currentUser.short_id || currentUser.id) + '</p>' +
                (currentUser.bio ? '<p><i class="fas fa-info-circle"></i> <strong>О себе:</strong> ' + escapeHtml(currentUser.bio) + '</p>' : '');
        }

        let ratings = await getRatingsForUser(currentUser.login);
        let totalRatings = ratings.length;
        let avgRating = totalRatings > 0 ? (ratings.reduce(function(s, r) { return s + r.rating; }, 0) / totalRatings) : 0;
        let ratingEl = document.getElementById('profileRating');
        if (ratingEl) {
            if (totalRatings > 0) {
                ratingEl.innerHTML = '<span class="rating-stars">' + avgRating.toFixed(1) + ' ★</span> <span class="rating-count">(' + totalRatings + ' сделок)</span>';
            } else {
                ratingEl.innerHTML = '<span class="rating-count">Нет оценок</span>';
            }
        }

        await renderAchievements();

        var chartCtx = document.getElementById('adminAnalyticsChart');
        if (chartCtx && typeof Chart !== 'undefined') {
            if (window.myLiveChart) window.myLiveChart.destroy();
            window.myLiveChart = new Chart(chartCtx, {
                type: 'bar',
                data: {
                    labels: ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'],
                    datasets: [{
                        label: 'Завершено сделок (число)',
                        data: [4, 7, 5, 9, 6, 11, 8],
                        backgroundColor: 'rgba(139, 92, 246, 0.15)',
                        borderColor: '#a78bfa',
                        borderWidth: 2,
                        borderRadius: 6,
                        hoverBackgroundColor: 'rgba(139, 92, 246, 0.4)',
                        hoverBorderColor: '#c084fc'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#6b7280' } },
                        x: { grid: { display: false }, ticks: { color: '#9ca3af', font: { size: 11 } } }
                    }
                }
            });
        }
    }

    async function renderAchievements() {
        if (!currentUser) return;
        let container = document.getElementById('profileAchievements');
        if (!container) return;
        let achievements = await getAchievementsForUser(currentUser.login);
        if (achievements.length === 0) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = '<strong><i class="fas fa-trophy"></i> Достижения:</strong> ' +
            achievements.map(function(a) {
                return '<span class="achievement-badge"><i class="fas fa-medal"></i> ' + escapeHtml(a.achievement_name) + '</span>';
            }).join(' ');
    }

    function renderSettings() {
        if (!currentUser) return;
        var nickInput = document.getElementById('settings-nickname');
        var bioInput = document.getElementById('settings-bio');
        var fileInput = document.getElementById('settings-avatar-file');
        if (nickInput) nickInput.value = currentUser.nickname || '';
        if (bioInput) bioInput.value = currentUser.bio || '';
        if (fileInput) fileInput.value = '';
        var curPwd = document.getElementById('settings-current-password');
        var newPwd = document.getElementById('settings-new-password');
        if (curPwd) curPwd.value = '';
        if (newPwd) newPwd.value = '';
    }

    function shuffleArray(array) {
        for (var i = array.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = array[i];
            array[i] = array[j];
            array[j] = tmp;
        }
        return array;
    }

    function maskPartnerName(name) {
        if (!name || name.indexOf('User#') === 0) return name;
        if (currentUser && (name === currentUser.nickname || name === currentUser.login)) return name;
        return name[0] + name[1] + '***' + name[name.length - 1];
    }

    var dealStatusMap = {
        'opened': { text: 'Открыта', color: '#60a5fa' },
        'escrow': { text: 'Заморожена (Гарант)', color: '#fbbf24' },
        'escroy': { text: 'Заморожена (Гарант)', color: '#fbbf24' },
        'dispute': { text: 'Арбитраж / Спор', color: '#f87171' },
        'disputed': { text: 'Арбитраж / Спор', color: '#f87171' },
        'completed': { text: 'Завершена успешно', color: '#34d399' },
        'closed': { text: 'Закрыта', color: '#9ca3af' },
        'cancelled': { text: 'Отменена', color: '#9ca3af' }
    };

    async function renderDeals() {
        var container = document.getElementById('allDealsList');
        if (!container) return;
        container.innerHTML = '';
        var myDeals = currentUser ? deals.filter(function(d) {
            return d.seller === currentUser.login || d.buyer === currentUser.login;
        }) : [];
        if (myDeals.length === 0) {
            container.innerHTML = '<p style="color:#888;text-align:center;">У вас пока нет сделок.</p>';
            return;
        }
        container.innerHTML = myDeals.map(function(d) {
            var statusInfo = dealStatusMap[d.status] || { text: d.status, color: '#e2e8f0' };
            var maskedBuyer = maskPartnerName(d.buyer);
            var maskedSeller = maskPartnerName(d.seller);
            return '<div class="user-deal-card" style="background:rgba(255,255,255,0.02);border:1px solid rgba(139,92,246,0.15);border-radius:12px;padding:18px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:15px;box-shadow:0 4px 15px rgba(0,0,0,0.2);">' +
                '<div style="display:flex;flex-direction:column;gap:6px;text-align:left;">' +
                    '<div style="font-size:16px;font-weight:bold;color:#fff;">📦 ' + escapeHtml(d.item || 'Сделка без названия') + '</div>' +
                    '<div style="font-size:13px;color:#9ca3af;">Участники: <span style="color:#a78bfa;">' + escapeHtml(maskedBuyer) + '</span> (покупатель) и <span style="color:#a78bfa;">' + escapeHtml(maskedSeller) + '</span> (продавец)</div>' +
                    '<div style="font-size:13px;color:#9ca3af;">Статус: <span style="color:' + statusInfo.color + ';font-weight:bold;">' + statusInfo.text + '</span></div>' +
                '</div>' +
                '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">' +
                    '<div style="font-size:18px;font-weight:bold;color:#34d399;">' + (d.amount || 0).toLocaleString() + ' ₽</div>' +
                    '<button onclick="window.location.hash=\'#deal-' + d.id + '\'" style="padding:6px 14px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.4);border-radius:6px;color:#c084fc;font-size:12px;font-weight:bold;cursor:pointer;transition:0.2s;" onmouseover="this.style.background=\'rgba(139,92,246,0.25)\'" onmouseout="this.style.background=\'rgba(139,92,246,0.1)\'">💬 Открыть чат</button>' +
                    (d.status === 'completed' ? '<button class="deleteDealBtn" data-id="' + d.id + '" style="padding:4px 10px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:6px;color:#f87171;font-size:11px;cursor:pointer;">Удалить</button>' : '') +
                '</div>' +
            '</div>';
        }).join('');
    }

    async function renderReviews() {
        let container = document.getElementById('reviewsList');
        if (!container) return;
        container.innerHTML = '';
        var items = shuffleArray(reviews.slice());
        if (items.length === 0) {
            container.innerHTML = '<p style="color:#888;text-align:center;">Отзывов пока нет.</p>';
            return;
        }
        items.forEach(function(r) {
            var stars = '';
            for (var s = 0; s < (r.rating || 5); s++) stars += '⭐';
            var authorName = r.user_login;
            var authorRole = 'Пользователь';
            var found = users.find(function(u) { return u.login === r.user_login; });
            if (found) {
                if (found.nickname) authorName = found.nickname;
                if (found.role === 'admin') authorRole = 'Администратор';
                else if (found.role === 'moderator') authorRole = 'Модератор';
                else if (found.role === 'seller') authorRole = 'Продавец';
            }

            // Анонимизация + защита личной аватарки текущего пользователя
            var whitelistAuthors = ['zeiten', 'Monter', 'milawka38', '777', 'Imprezza', 'HeDViN'];
            var displayAuthor = authorName;
            var displayRole = authorRole;
            var displayAvatar = '';
            var isCurrentUser = currentUser && r.user_login === currentUser.login;

            if (whitelistAuthors.indexOf(r.user_login) !== -1 || isCurrentUser || r.user_login.indexOf('User#') === 0) {
                // Не анонимизируем: автор в белом списке, это текущий пользователь или уже скрыт
                if (isCurrentUser) {
                    // Берём реальные данные текущего пользователя
                    displayAuthor = currentUser.nickname || currentUser.login;
                    if (currentUser.role === 'admin') displayRole = 'администратор';
                    else if (currentUser.role === 'moderator') displayRole = 'модератор';
                    else if (currentUser.role === 'seller') displayRole = 'продавец';
                    else displayRole = 'пользователь';
                    displayAvatar = currentUser.avatar_url || ('https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(r.user_login) + '&backgroundColor=6d28d9&textColor=ffffff');
                } else {
                    displayAvatar = 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(r.user_login) + '&backgroundColor=6d28d9&textColor=ffffff';
                }
            } else {
                var hash = 0;
                for (var i = 0; i < r.user_login.length; i++) {
                    hash = r.user_login.charCodeAt(i) + ((hash << 5) - hash);
                }
                var finalId = Math.abs(hash % 900000) + 100000;
                displayAuthor = 'User#' + finalId;
                displayRole = Math.random() > 0.5 ? 'покупатель' : 'продавец';
                displayAvatar = 'https://api.dicebear.com/7.x/bottts/svg?seed=' + finalId + '&backgroundColor=6d28d9';
            }
            var card = document.createElement('div');
            card.className = 'review-card';
            card.innerHTML =
                '<div class="review-card-top">' +
                    '<div class="review-stars">' + stars + '</div>' +
                    '<p class="review-text">"' + escapeHtml(r.text || '') + '"</p>' +
                '</div>' +
                '<div class="review-card-bottom">' +
                    '<img class="review-avatar" src="' + displayAvatar + '" alt="" loading="lazy">' +
                    '<div class="review-author-info">' +
                        '<span class="review-author-name">' + escapeHtml(displayAuthor) + '</span>' +
                        '<span class="review-author-role">' + escapeHtml(displayRole) + '</span>' +
                    '</div>' +
                '</div>';
            if (currentUser && (currentUser.role === 'admin' || currentUser.login === r.user_login)) {
                var delBtn = document.createElement('button');
                delBtn.className = 'delRev';
                delBtn.dataset.id = r.id;
                delBtn.textContent = 'Удалить';
                delBtn.style.cssText = 'margin-top:10px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:6px;color:#f87171;padding:6px 12px;font-size:12px;cursor:pointer;';
                card.appendChild(delBtn);
            }
            container.appendChild(card);
        });
    }

    // ===== SUPPORT TICKETS RENDER =====

    function renderUserTickets() {
        let container = document.getElementById('userTicketsList');
        if (!container) return;
        let myTickets = currentUser ? supportTickets.filter(function(t) { return t.user_id === currentUser.id || t.user_short_id === String(currentUser.id); }) : [];
        if (myTickets.length === 0) {
            container.innerHTML = '<p style="color:#888; text-align:center;">У вас нет обращений.</p>';
            return;
        }
        container.innerHTML = myTickets.map(function(t) {
            var statusClass = t.status === 'open' ? 'open' : 'closed';
            var statusText = t.status === 'open' ? 'Открыто' : 'Закрыто';
            var activeClass = userCurrentTicketId === t.id ? ' active' : '';
            return '<div class="ticket-item' + activeClass + '" data-ticket-id="' + t.id + '">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                '<span class="ticket-subject">' + escapeHtml(t.subject) + '</span>' +
                '<span class="ticket-status ' + statusClass + '">' + statusText + '</span></div>' +
                '<div style="font-size:12px;color:#888;margin-top:4px;">' + new Date(t.created_at).toLocaleString() + '</div></div>';
        }).join('');
    }

    function renderUserTicketChat(ticketId) {
        let area = document.getElementById('userTicketChatArea');
        let header = document.getElementById('userTicketChatHeader');
        let container = document.getElementById('userTicketChatMessages');
        if (!area || !header || !container) return;
        let ticket = supportTickets.find(function(t) { return t.id === ticketId; });
        if (!ticket) { area.style.display = 'none'; return; }
        header.innerHTML = '<i class="fas fa-ticket-alt"></i> ' + escapeHtml(ticket.subject) + ' <span style="color:#888;font-weight:normal;">(#' + ticket.id + ')</span>';
        let messages = supportTicketMessages[ticketId] || [];
        container.innerHTML = messages.map(function(msg) {
            var displayName = msg.sender_role === 'admin' ? 'Поддержка' : (msg.sender_role === 'system' ? 'Система' : ((users.find(function(u) { return String(u.id) === String(msg.sender_id); }) || {}).login || '#' + msg.sender_id));
            var cls = msg.sender_role === 'system' ? 'message-system' : (msg.sender_role === 'admin' ? 'message-bot' : (String(msg.sender_id) === String(currentUser ? currentUser.id : null) ? 'message-user' : 'message-bot'));
            return '<div class="message ' + cls + '"><strong>' + escapeHtml(displayName) + '</strong><br>' + escapeHtml(msg.message) + '</div>';
        }).join('');
        container.scrollTop = container.scrollHeight;
        area.style.display = 'block';
        // Блокируем ввод, если тикет закрыт
        let input = document.getElementById('userTicketChatInput');
        let sendBtn = document.getElementById('userTicketChatSendBtn');
        if (input && sendBtn) {
            var disabled = ticket.status === 'closed';
            input.disabled = disabled;
            sendBtn.disabled = disabled;
            input.placeholder = disabled ? 'Обращение закрыто' : 'Напишите сообщение...';
        }
    }

    function renderAdminTickets() {
        let container = document.getElementById('adminTicketsList');
        if (!container) return;
        let counter = document.getElementById('adminTicketCounter');
        if (counter) {
            counter.style.display = openTicketCount > 0 ? 'inline' : 'none';
            counter.innerText = openTicketCount;
        }
        container.innerHTML = supportTickets.map(function(t) {
            var statusClass = t.status === 'open' ? 'open' : 'closed';
            var statusText = t.status === 'open' ? 'Открыто' : 'Закрыто';
            var activeClass = adminCurrentTicketId === t.id ? ' active' : '';
            return '<div class="ticket-item' + activeClass + '" data-admin-ticket-id="' + t.id + '">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                '<span class="ticket-subject">' + escapeHtml(t.subject) + '</span>' +
                '<span class="ticket-status ' + statusClass + '">' + statusText + '</span></div>' +
                '<div style="font-size:12px;color:#888;margin-top:4px;">' + escapeHtml((users.find(function(u) { return u.id === t.user_id; }) || {}).login || '#' + t.user_id) + ' — ' + new Date(t.created_at).toLocaleString() + '</div></div>';
        }).join('');
    }

    function renderAdminTicketChat(ticketId) {
        let area = document.getElementById('adminTicketChatArea');
        let header = document.getElementById('adminTicketChatHeader');
        let container = document.getElementById('adminTicketChatMessages');
        if (!area || !header || !container) return;
        let ticket = supportTickets.find(function(t) { return t.id === ticketId; });
        if (!ticket) { area.style.display = 'none'; return; }
        var ticketUserLogin = (users.find(function(u) { return u.id === ticket.user_id; }) || {}).login || '#' + ticket.user_id;
        header.innerHTML = '<i class="fas fa-ticket-alt"></i> ' + escapeHtml(ticket.subject) + ' (#' + ticket.id + ') — ' + escapeHtml(ticketUserLogin);
        let messages = supportTicketMessages[ticketId] || [];
        container.innerHTML = messages.map(function(msg) {
            var displayName = msg.sender_role === 'system' ? 'Система' : (msg.sender_role === 'user' ? ((users.find(function(u) { return String(u.id) === String(msg.sender_id); }) || {}).login || '#' + msg.sender_id) : 'Поддержка');
            var cls = msg.sender_role === 'system' ? 'message-system' : (msg.sender_role === 'admin' ? 'message-user' : (String(msg.sender_id) === String(currentUser ? currentUser.id : null) ? 'message-user' : 'message-bot'));
            return '<div class="message ' + cls + '"><strong>' + escapeHtml(displayName) + '</strong><br>' + escapeHtml(msg.message) + '</div>';
        }).join('');
        container.scrollTop = container.scrollHeight;
        area.style.display = 'block';
        // Показываем кнопку закрытия только для открытых тикетов
        let closeBtn = document.getElementById('adminCloseTicketBtn');
        if (closeBtn) closeBtn.style.display = ticket.status === 'open' ? 'inline-block' : 'none';
        let input = document.getElementById('adminTicketChatInput');
        if (input) input.disabled = ticket.status === 'closed';
        let sendBtn = document.getElementById('adminTicketChatSendBtn');
        if (sendBtn) sendBtn.disabled = ticket.status === 'closed';
        renderAdminFastTemplates();
    }

    function renderAdminFastTemplates() {
        var container = document.getElementById('admin-fast-templates');
        if (!container) return;
        if (!currentUser || currentUser.role !== 'admin') {
            container.style.display = 'none';
            return;
        }
        var templates = [
            { label: '👋 Приветствие', text: 'Здравствуйте! Чем я могу вам помочь?' },
            { label: '📸 Скриншот', text: 'Пожалуйста, предоставьте скриншот операции/чека для проверки.' },
            { label: '⏳ Ожидание', text: 'Ваша заявка находится на рассмотрении. Ожидайте, пожалуйста.' },
            { label: '✅ Вывод', text: 'Выплата успешно произведена на указанные вами реквизиты.' }
        ];
        container.innerHTML = templates.map(function(t) {
            return '<button class="template-btn" data-text="' + escapeHtml(t.text) + '" style="background:#3b1f6e; color:#fff; border:1px solid #6d28d9; border-radius:6px; padding:6px 12px; cursor:pointer; font-size:12px; transition:background 0.2s;">' + t.label + '</button>';
        }).join('');
        container.style.display = 'flex';
    }

    async function autoDeleteOldClosedTickets() {
        var now = new Date();
        var toDelete = supportTickets.filter(function(t) {
            if (t.status !== 'closed' || !t.closed_at) return false;
            var closedTime = new Date(t.closed_at);
            return (now - closedTime) > 86400000; // 24 hours
        });
        for (var i = 0; i < toDelete.length; i++) {
            console.log('[AutoClean] Удаляем тикет #' + toDelete[i].id + ' (закрыт более 24ч назад)');
            await deleteTicketAndMessages(toDelete[i].id);
        }
        if (toDelete.length > 0) {
            renderUserTickets();
            renderAdminTickets();
        }
    }

    async function autoCleanSupportTickets() {
        if (!currentUser || currentUser.role !== 'admin') return;
        console.log('[AutoClean] Проверка закрытых тикетов (старше 24ч)...');
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { error } = await sb
            .from('support_tickets')
            .delete()
            .eq('status', 'closed')
            .lt('closed_at', oneDayAgo);
        if (error) {
            console.error('[AutoClean] Ошибка удаления старых тикетов:', error.message);
        } else {
            console.log('[AutoClean] Закрытые тикеты (старше 24ч) удалены');
        }
    }

    async function checkAndSeedInitialFakeDeals() {
        if (!currentUser || currentUser.role !== 'admin') return;
        console.log('Проверка наличия фейковых сделок в базе...');
        var existingRes = await sb.from('deals').select('id').eq('is_fake', true).limit(1);
        if (existingRes.error) {
            console.error('Ошибка при проверке сделок:', existingRes.error);
            return;
        }
        if (!existingRes.data || existingRes.data.length === 0) {
            console.log('База пуста! Запуск генерации 5 стартовых распределенных сделок...');
            var now = Date.now();
            var startFakeDeals = [];
            var items = ['CS2 Skin', 'Dota 2 Item', 'Steam Gift', 'Digital Goods', 'Game Account', 'Crypto Voucher', 'VPN Subscription', 'Software License'];
            for (var i = 1; i <= 5; i++) {
                var timeOffset = i * (Math.floor(Math.random() * (25 - 5 + 1)) + 5) * 60 * 1000;
                var dealDate = new Date(now - timeOffset).toISOString();
                var randBuyer = Math.floor(100000 + Math.random() * 900000);
                var randSeller = Math.floor(100000 + Math.random() * 900000);
                startFakeDeals.push({
                    buyer: 'User#' + randBuyer,
                    seller: 'User#' + randSeller,
                    amount: Math.floor(Math.random() * 8500) + 300,
                    item: items[Math.floor(Math.random() * items.length)],
                    is_fake: true,
                    status: 'completed',
                    created_at: dealDate
                });
            }
            var insertRes = await sb.from('deals').insert(startFakeDeals);
            if (insertRes.error) {
                console.error('Не удалось вставить стартовые сделки:', insertRes.error);
            } else {
                console.log('5 стартовых сделок успешно записаны в облако Supabase!');
            }
        } else {
            console.log('Фейковые сделки уже есть в базе, генерация не требуется.');
        }
    }

    async function autoCleanFakeDeals() {
        if (!currentUser || currentUser.role !== 'admin') return;
        console.log('[AutoClean] Проверка фейковых сделок...');

        // Получаем все ID фейков
        var allRes = await sb.from('deals').select('id').eq('is_fake', true);
        if (allRes.error) {
            console.error('[AutoClean] Ошибка получения фейков:', allRes.error.message);
            return;
        }
        var allFakeIds = allRes.data || [];

        // Если фейков нет — генерируем 5 стартовых
        if (allFakeIds.length === 0) {
            console.log('[AutoClean] Фейков нет, генерируем 5 стартовых...');
            var now = Date.now();
            var offsets = [10 * 60 * 1000, 25 * 60 * 1000, 40 * 60 * 1000, 55 * 60 * 1000, 70 * 60 * 1000];
            var items = ['CS2 Skin', 'Dota 2 Item', 'Steam Gift', 'Digital Goods', 'Game Account', 'Crypto Voucher', 'VPN Subscription', 'Software License'];
            for (var i = 0; i < offsets.length; i++) {
                var seller = 'User#' + Math.floor(100000 + Math.random() * 900000);
                var buyer = 'User#' + Math.floor(100000 + Math.random() * 900000);
                var amount = Math.random() < 0.85
                    ? Math.floor(Math.random() * 2851) + 150
                    : Math.floor(Math.random() * 25001) + 5000;
                var item = items[Math.floor(Math.random() * items.length)];
                try {
                    await sb.from('deals').insert({
                        seller: seller,
                        buyer: buyer,
                        amount: amount,
                        item: item,
                        status: 'completed',
                        is_fake: true,
                        created_at: new Date(now - offsets[i]).toISOString()
                    });
                } catch (e) {
                    console.error('[AutoClean] Ошибка генерации фейка:', e);
                }
            }
            console.log('[AutoClean] Стартовые фейки созданы');
            return;
        }

        // Если 5 или меньше — ничего не удаляем
        if (allFakeIds.length <= 5) {
            console.log('[AutoClean] Фейков ' + allFakeIds.length + ', очистка не требуется');
            return;
        }

        // Получаем 5 последних ID для сохранения
        var keepRes = await sb.from('deals')
            .select('id')
            .eq('is_fake', true)
            .order('created_at', { ascending: false })
            .limit(5);
        if (keepRes.error) {
            console.error('[AutoClean] Ошибка получения ID фейков:', keepRes.error.message);
            return;
        }
        var keepIds = keepRes.data.map(function(d) { return d.id; });

        // Удаляем старые фейки (старше 1ч), исключая 5 сохранённых
        var oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        var delRes = await sb
            .from('deals')
            .delete()
            .eq('is_fake', true)
            .lt('created_at', oneHourAgo)
            .not('id', 'in', keepIds);
        if (delRes.error) {
            console.error('[AutoClean] Ошибка удаления старых фейков:', delRes.error.message);
        } else {
            console.log('[AutoClean] Фейковые сделки (старше 1ч) удалены, 5 последних сохранены');
        }
    }

    function startAdminAutoClean() {
        if (!currentUser || currentUser.role !== 'admin') return;
        checkAndSeedInitialFakeDeals();
        autoCleanSupportTickets();
        autoCleanFakeDeals();
        // Запускаем генератор фейков только в сессии админа
        if (!window._fakeDealTimerStarted) {
            window._fakeDealTimerStarted = true;
            startFakeDealsTimer();
        }
        if (!window._adminCleanInterval) {
            window._adminCleanInterval = setInterval(function() {
                autoCleanSupportTickets();
                autoCleanFakeDeals();
            }, 10 * 60 * 1000);
        }
    }

    async function renderAdminPanel() {
        console.log("[AdminPanel] Рендер админ-панели. currentUser:", currentUser ? currentUser.login + " роль:" + currentUser.role : "null", "isAdmin:", window.isAdmin);
        if (!currentUser || (currentUser.role !== 'admin' && !window.isAdmin)) {
            var ap = document.getElementById('adminPage');
            if (ap) ap.classList.add('hidden-page');
            return;
        }
        startAdminAutoClean();
        var countRes = await sb.from('deals').select('id', { count: 'exact', head: true }).eq('is_fake', false);
        var realDealsCount = countRes.count || 0;
        document.getElementById('adminStats').innerHTML =
            '<div class="stat-card">Пользователей: ' + users.length + '</div>' +
            '<div class="stat-card">Сделок (реальных): ' + realDealsCount + '</div>';

        // Paginated user list from local users array
        renderAdminUsersList();

        await renderAdminDeals();
        renderAdminTickets();
        if (adminCurrentTicketId) {
            renderAdminTicketChat(adminCurrentTicketId);
        } else {
            var adminChatArea = document.getElementById('adminTicketChatArea');
            if (adminChatArea) adminChatArea.style.display = 'none';
        }
    }

    function renderAdminUsersList(searchQuery) {
        var filteredUsers = users;
        if (searchQuery && searchQuery.trim() !== '') {
            var q = searchQuery.trim().toLowerCase();
            filteredUsers = users.filter(function(u) {
                return (u.login && u.login.toLowerCase().includes(q)) ||
                       (u.nickname && u.nickname.toLowerCase().includes(q)) ||
                       (u.email && u.email.toLowerCase().includes(q));
            });
        }
        let userListDiv = document.getElementById('userListAdmin');
        if (userListDiv) {
            var itemsPerPage = 10;
            var startIndex = (window.adminCurrentUsersPage - 1) * itemsPerPage;
            var endIndex = startIndex + itemsPerPage;
            var pageUsers = filteredUsers.slice(startIndex, endIndex);

            userListDiv.innerHTML = pageUsers.map(function(u) {
                return '<div style="background:rgba(15,12,22,0.7);margin:6px 0;padding:10px 14px;border-radius:10px;border:1px solid rgba(139,92,246,0.08);display:flex;justify-content:space-between;align-items:center;">' +
                    '<div>' +
                        '<strong style="color:#e2e8f0;font-size:14px;">' + escapeHtml(u.login) + '</strong>' +
                        (u.role === 'admin' ? ' <span style="color:#c084fc;font-size:12px;">👑 Администратор</span>' : '') +
                        '<div style="font-size:12px;color:#9ca3af;margin-top:4px;">' +
                            'Баланс: <span style="color:#34d399;font-weight:bold;">' + (u.balance || 0).toLocaleString() + ' ₽</span>' +
                            ' | Доверие: ' + getTrustPercent(u) + '%' +
                            (u.banned ? ' <span style="color:#ef4444;">🔴 Забанен</span>' : '') +
                        '</div>' +
                    '</div>' +
                    '<div style="display:flex;gap:6px;flex-shrink:0;">' +
                        '<button data-action="add-balance" data-login="' + escapeHtml(u.login) + '" style="padding:6px 10px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);border-radius:6px;color:#a78bfa;font-size:12px;cursor:pointer;transition:0.2s;">💸 Начислить</button>' +
                        '<button data-action="promote" data-login="' + escapeHtml(u.login) + '" style="padding:6px 10px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);border-radius:6px;color:#a78bfa;font-size:12px;cursor:pointer;transition:0.2s;">👑 Права</button>' +
                        '<button data-action="ban" data-login="' + escapeHtml(u.login) + '" style="padding:6px 10px;background:' + (u.banned ? 'rgba(239,68,68,0.15)' : 'rgba(139,92,246,0.1)') + ';border:1px solid ' + (u.banned ? 'rgba(239,68,68,0.4)' : 'rgba(139,92,246,0.3)') + ';border-radius:6px;color:' + (u.banned ? '#f87171' : '#a78bfa') + ';font-size:12px;cursor:pointer;transition:0.2s;">🚫 ' + (u.banned ? 'Разбан' : 'Бан') + '</button>' +
                    '</div>' +
                '</div>';
            }).join('');

            renderUsersPagination(filteredUsers.length);
        }
    }

    function renderUsersPagination(totalUsers) {
        var itemsPerPage = 10;
        var totalPages = Math.max(1, Math.ceil(totalUsers / itemsPerPage));
        var container = document.getElementById('users-pagination-controls');
        if (!container) return;
        if (totalPages <= 1) { container.innerHTML = ''; return; }
        var html = '';
        for (var p = 1; p <= totalPages; p++) {
            var active = p === window.adminCurrentUsersPage;
            html += '<button data-upage="' + p + '" style="min-width:36px;width:36px;height:36px;padding:0;border-radius:50%;font-size:13px;font-weight:bold;cursor:pointer;border:2px solid ' + (active ? '#c084fc' : '#5b21b6') + ';background:' + (active ? '#c084fc' : '#2a1a5a') + ';color:' + (active ? '#1a0a3a' : 'white') + ';transition:all 0.2s;">' + p + '</button>';
        }
        container.innerHTML = html;
    }

    // ===== ОЧИСТКА ТАБЛИЦЫ DEALS (ДЛЯ АДМИНА) =====
    async function clearAllDeals() {
        console.log("Запуск полной очистки таблицы deals...");
        const { data, error } = await sb
            .from('deals')
            .delete()
            .neq('id', '');
        if (error) {
            console.error("Ошибка очистки базы:", error);
        } else {
            console.log("Таблица deals успешно очищена!");
        }
    }

    async function renderAdminDeals() {
        if (!currentUser || currentUser.role !== 'admin') return;
        console.log("Вызов renderAdminDeals (только реальные сделки)...");
        
        // 1. Фильтруем на уровне запроса к базе (булево false, не строка)
        const { data: allDeals, error } = await sb
            .from('deals')
            .select('*')
            .eq('is_fake', false)
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Ошибка загрузки сделок для админки:", error.message);
            return;
        }

        // 2. Строгая фильтрация: пропускаем только false или 'false'
        const realDeals = allDeals.filter(deal => {
            if (deal.is_fake === true || deal.is_fake === 'true') return false;
            return deal.is_fake === false || deal.is_fake === 'false';
        });

        console.log("Всего из базы:", allDeals.length, "После фильтрации:", realDeals.length);
        console.log("Сделки для админки успешно отфильтрованы. Настоящих сделок:", realDeals.length);
        
        displayAdminDealsTable(realDeals); 
    }

    function displayAdminDealsTable(dealsArray) {
        let dealsDiv = document.getElementById('adminDealsList');
        if (!dealsDiv) return;
        dealsDiv.innerHTML = (dealsArray || []).map(function(d) {
            return '<div>#' + d.id + ' ' + escapeHtml(d.item) + ' ' + (d.amount || 0) + '₽ ' + getStatusText(d.status) +
                ' <button class="adminChangeStatus" data-id="' + d.id + '">Изменить статус</button>' +
                ' <button class="adminDeleteDeal" data-id="' + d.id + '">Удалить</button></div>';
        }).join('');
    }

    function renderSingleDealChat(dealId) {
        var container = document.getElementById('singleDealChat');
        if (!container) return;
        var messages = dealMessages[dealId] || [];
        container.innerHTML = messages.map(function(msg) {
            if (msg.system) {
                return '<div style="display:flex;justify-content:center;width:100%;margin:12px 0;">' +
                    '<div style="background:rgba(139,92,246,0.05);border:1px solid rgba(139,92,246,0.2);border-radius:8px;padding:8px 16px;font-size:13px;color:#c084fc;max-width:80%;text-align:center;line-height:1.4;">' +
                        '🤖 <span style="font-weight:bold;letter-spacing:0.5px;text-transform:uppercase;font-size:11px;margin-right:5px;">Система:</span> ' + escapeHtml(msg.text || msg.message) +
                    '</div>' +
                '</div>';
            }
            var displaySender = msg.sender === (currentUser ? currentUser.login : null) ? msg.sender : getDisplayName(msg.sender);
            var cls = msg.sender === (currentUser ? currentUser.login : null) ? 'message-user' : 'message-bot';
            return '<div class="message ' + cls + '"><strong>' + escapeHtml(displaySender) + '</strong><br>' + escapeHtml(msg.text) +
                '<br><span style="font-size:10px; color:#aaa;">' + (msg.timestamp || '') + '</span></div>';
        }).join('');
        container.scrollTop = container.scrollHeight;
    }

    async function loadSingleDealPage(dealId) {
        // Принудительно скрываем админ-панель для не-админов при каждом рендере сделки
        if (!currentUser || (currentUser.role !== 'admin' && !window.isAdmin)) {
            var adminPanel = document.getElementById('adminPage');
            if (adminPanel) { adminPanel.classList.add('hidden-page'); }
        }
        let deal = deals.find(function(d) { return d.id == dealId; });
        if (!deal) {
            document.getElementById('singleDealTitle').innerHTML = 'Сделка не найдена';
            document.getElementById('singleDealDetails').innerHTML = '<p>Сделка не существует.</p>';
            ['singlePayBtn', 'singleConfirmBtn', 'singleDisputeBtn'].forEach(function(id) {
                document.getElementById(id).style.display = 'none';
            });
            return;
        }
        if (!currentUser) {
            document.getElementById('singleDealTitle').innerHTML = 'Требуется авторизация';
            document.getElementById('singleDealDetails').innerHTML = '<p><button id="singleLoginBtn">Войдите</button></p>';
            return;
        }
        if (deal.seller !== currentUser.login && deal.buyer !== currentUser.login) {
            document.getElementById('singleDealTitle').innerHTML = 'Доступ запрещён';
            document.getElementById('singleDealDetails').innerHTML = '<p>Вы не участник сделки.</p>';
            return;
        }
        document.getElementById('singleDealTitle').innerHTML = 'Сделка #' + deal.id + ': ' + escapeHtml(deal.item) + ' (' + (deal.amount || 0).toLocaleString() + ' ₽)';
        var maskedBuyer = maskPartnerName(deal.buyer);
        var maskedSeller = maskPartnerName(deal.seller);
        var dealStatusMap2 = {
            'opened': { text: 'Открыта', color: '#60a5fa' },
            'escrow': { text: 'Заморожена (Гарант)', color: '#fbbf24' },
            'escroy': { text: 'Заморожена (Гарант)', color: '#fbbf24' },
            'dispute': { text: 'Арбитраж / Спор', color: '#f87171' },
            'disputed': { text: 'Арбитраж / Спор', color: '#f87171' },
            'completed': { text: 'Успешно завершена', color: '#34d399' },
            'closed': { text: 'Закрыта', color: '#9ca3af' },
            'cancelled': { text: 'Отменена', color: '#9ca3af' }
        };
        var currentStatus = dealStatusMap2[deal.status] || { text: deal.status, color: '#fff' };
        document.getElementById('singleDealDetails').innerHTML =
            '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(139,92,246,0.15);border-radius:12px;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;text-align:left;">' +
                '<div style="font-size:14px;color:#9ca3af;display:flex;gap:20px;">' +
                    '<div>🛒 Покупатель: <span style="color:#fff;font-weight:bold;">' + escapeHtml(maskedBuyer) + '</span></div>' +
                    '<div>💼 Продавец: <span style="color:#fff;font-weight:bold;">' + escapeHtml(maskedSeller) + '</span></div>' +
                '</div>' +
                '<div style="font-size:14px;font-weight:bold;color:' + currentStatus.color + ';background:rgba(255,255,255,0.02);padding:4px 12px;border-radius:20px;border:1px solid ' + currentStatus.color + '44;">' +
                    currentStatus.text +
                '</div>' +
            '</div>';

        let isActive = deal.status !== 'completed';
        let isBuyer = currentUser.login === deal.buyer;
        let isSeller = currentUser.login === deal.seller;

        document.getElementById('singlePayBtn').style.display = (isActive && isBuyer && deal.status === 'waiting_payment') ? 'block' : 'none';
        document.getElementById('singleConfirmBtn').style.display = (isActive && isBuyer && deal.status === 'escroy') ? 'block' : 'none';
        document.getElementById('singleDisputeBtn').style.display = (isActive && (isSeller || isBuyer) && deal.status !== 'disputed') ? 'block' : 'none';

        renderSingleDealChat(deal.id);
    }

    function showSingleDeal(dealId) {
        currentDealId = dealId;
        document.getElementById('mainContent').classList.add('hidden');
        document.getElementById('singleDealPage').classList.remove('hidden');
        window.location.hash = 'deal-' + dealId;
        loadSingleDealPage(dealId);
    }

    function hideSingleDeal() {
        currentDealId = null;
        document.getElementById('mainContent').classList.remove('hidden');
        document.getElementById('singleDealPage').classList.add('hidden');
        window.location.hash = 'page-dealsPage';
        showPage('dealsPage');
    }

    function updateGlobalStats() {
        let total = document.getElementById('totalVolume');
        if (total) total.innerText = (systemStats.total_turnover || 0).toLocaleString() + ' ₽';
        let online = document.getElementById('onlineCount');
        if (online) online.innerText = fakeOnline;
        let completedSpan = document.getElementById('completedCount');
        if (completedSpan) completedSpan.innerText = systemStats.total_deals || 0;
        let ratingSpan = document.getElementById('ratingValue');
        if (ratingSpan) ratingSpan.innerText = '4.6';
    }

    async function loadOnlineCounter() {
        var onlineField = document.getElementById('onlineCount');

        var cachedOnline = localStorage.getItem('cached_online_counter');
        if (cachedOnline && onlineField) {
            onlineField.innerText = cachedOnline;
        }

        try {
            var [rVal, rTime] = await Promise.all([
                sb.from('platform_settings').select('value').eq('key', 'online_counter'),
                sb.from('platform_settings').select('value').eq('key', 'online_counter_updated')
            ]);

            if (rVal.data && rVal.data.length > 0 && rVal.data[0].value) {
                var currentValue = parseInt(rVal.data[0].value);
                var lastUpdated = rTime.data && rTime.data.length > 0 && rTime.data[0].value ? new Date(rTime.data[0].value) : null;
                var now = new Date();
                var needsUpdate = !lastUpdated || (now - lastUpdated) >= 60000;

                if (needsUpdate) {
                    var newVal = Math.floor(Math.random() * 301) + 200;
                    var timestamp = now.toISOString();

                    await sb.from('platform_settings').update({ value: String(newVal) }).eq('key', 'online_counter');
                    await sb.from('platform_settings').upsert({ key: 'online_counter_updated', value: timestamp }, { onConflict: 'key' });

                    onlineBaseValue = newVal;
                    fakeOnline = newVal;
                    localStorage.setItem('cached_online_counter', String(newVal));
                    if (onlineField) onlineField.innerText = String(newVal);
                } else {
                    if (!isNaN(currentValue) && currentValue > 0) {
                        onlineBaseValue = currentValue;
                        fakeOnline = currentValue;
                        localStorage.setItem('cached_online_counter', String(currentValue));
                        if (onlineField) onlineField.innerText = String(currentValue);
                    }
                }
            } else {
                console.log("🚨 Нет данных в platform_settings для online_counter:", JSON.stringify(rVal.data));
                if (!cachedOnline && onlineField) {
                    var fallback = Math.floor(Math.random() * 301) + 200;
                    onlineField.innerText = String(fallback);
                }
            }
        } catch (e) {
            console.log("🚨 КРИТИЧЕСКАЯ ОШИБКА ЗАПРОСА ОНЛАЙНА:", e.message);
            if (!cachedOnline && onlineField) {
                var fallback = Math.floor(Math.random() * 301) + 200;
                onlineField.innerText = String(fallback);
                fakeOnline = fallback;
                onlineBaseValue = fallback;
            }
        }
    }

    function subscribeOnlineCounter() {
        sb.channel('platform-global-settings')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'platform_settings', filter: 'key=eq.online_counter' }, function(payload) {
                console.log('[Realtime] Обновление онлайна:', payload.new.value);
                var newVal = parseInt(payload.new.value);
                if (!isNaN(newVal) && newVal > 0) {
                    onlineBaseValue = newVal;
                    fakeOnline = newVal;
                    localStorage.setItem('cached_online_counter', String(newVal));
                    var onlineField = document.getElementById('onlineCount');
                    if (onlineField) onlineField.innerText = fakeOnline;
                }
            })
            .subscribe(function(status) {
                console.log('[Realtime] Статус канала platform-global-settings:', status);
            });
    }

    // ===== AUTH =====

    async function registerUser(login, email, pass, nickname) {
        let exists = users.find(function(u) { return u.login === login; });
        if (exists) return { ok: false, msg: 'Логин занят' };
        let emailExists = users.find(function(u) { return u.email === email; });
        if (emailExists) return { ok: false, msg: 'Email уже используется' };
        let isFirst = users.length === 0;
        let shortId = await generateShortId();
        let newUser = {
            login: login,
            email: email,
            password: pass,
            role: isFirst ? 'admin' : 'user',
            balance: 0,
            banned: false,
            reg_date: new Date().toISOString(),
            total_deposit: 0,
            total_withdraw: 0,
            short_id: shortId,
            nickname: nickname || login
        };
        let saved = await insertUser(newUser);
        if (saved) {
            try { await sb.auth.signUp({ email: email, password: pass }); } catch (e) {}
            return { ok: true, msg: isFirst ? 'Вы первый администратор! Войдите.' : 'Регистрация успешна' };
        }
        return { ok: false, msg: 'Ошибка сервера. Возможно, таблица users не создана.' };
    }

    async function loginUser(identifier, pass) {
        if (identifier === 'violet_admin' && pass === 'admin2025') {
            let admin = users.find(function(u) { return u.login === identifier; });
            if (!admin) {
                let shortId = await generateShortId();
                let newAdmin = {
                    login: identifier,
                    password: pass,
                    role: 'admin',
                    balance: 0,
                    banned: false,
                    reg_date: new Date().toISOString(),
                    total_deposit: 0,
                    total_withdraw: 0,
                    short_id: shortId,
                    nickname: identifier
                };
                let saved = await insertUser(newAdmin);
                if (saved) currentUser = saved;
                else return { ok: false, msg: 'Ошибка сервера' };
            } else {
                if (admin.banned) return { ok: false, msg: 'Аккаунт заблокирован' };
                admin.role = 'admin';
                await upsertUser(admin);
                currentUser = admin;
            }
            try { await sb.auth.signInWithPassword({ email: identifier + '@vg.local', password: pass }); } catch (e) {}
            return { ok: true, msg: 'Вы вошли как администратор ' + identifier };
        }
        let u = users.find(function(u) { return (u.login === identifier || u.email === identifier) && u.password === pass; });
        if (!u) return { ok: false, msg: 'Неверный логин/пароль' };
        if (u.banned) return { ok: false, msg: 'Аккаунт заблокирован' };
        currentUser = u;
        if (u.email) {
            try { await sb.auth.signInWithPassword({ email: u.email, password: pass }); } catch (e) {}
        }
        return { ok: true, msg: 'С возвращением, ' + u.login };
    }

    async function logout() {
        await sb.auth.signOut();
        currentUser = null;
        updateUI();
        showToast('Вы вышли');
        showPage('homePage');
    }

    // ===== THEME =====

    function toggleTheme() {
        isDarkTheme = !isDarkTheme;
        document.body.classList.toggle('light-theme', !isDarkTheme);
        let icon = document.querySelector('#themeToggle i');
        if (icon) icon.className = isDarkTheme ? 'fas fa-moon' : 'fas fa-sun';
    }

    // ===== PAGE NAVIGATION =====

    function showPage(pageId) {
        // При любом переходе сначала скрываем чат сделки и показываем основную обёртку
        var singleDealPage = document.getElementById('singleDealPage');
        if (singleDealPage) singleDealPage.classList.add('hidden');
        var mainContent = document.getElementById('mainContent');
        if (mainContent) mainContent.classList.remove('hidden');
        currentDealId = null;
        // ===== УЛЬТИМАТИВНАЯ ЗАЩИТА АДМИНКИ =====
        if (pageId === 'adminPage') {
            if (!currentUser || currentUser.role !== 'admin') {
                console.warn("Попытка несанкционированного доступа к админке! role:", currentUser ? currentUser.role : 'null');
                window.location.hash = 'page-homePage';
                showPage('homePage');
                return;
            }
        }
        // Принудительно скрываем админку для не-админов
        if (!currentUser || currentUser.role !== 'admin') {
            var ap = document.getElementById('adminPage');
            if (ap) ap.classList.add('hidden-page');
        }
        ['homePage', 'dealsPage', 'reviewsPage', 'supportPage', 'profilePage', 'settingsPage', 'adminPage'].forEach(function(p) {
            var el = document.getElementById(p);
            if (el) el.classList.add('hidden-page');
        });
        // Для админ-панели: асинхронная верификация роли из БД
        if (pageId === 'adminPage') {
            window.location.hash = 'page-adminPage';
            document.querySelectorAll('.nav-links a').forEach(function(a) { a.classList.remove('active'); });
        var map = { home: 'homePage', deals: 'dealsPage', reviews: 'reviewsPage', support: 'supportPage', profile: 'profilePage', admin: 'adminPage', settings: 'settingsPage' };
            var key = Object.keys(map).find(function(k) { return map[k] === pageId; });
            if (key) {
                var link = document.querySelector('.nav-links a[data-page="' + key + '"]');
                if (link) link.classList.add('active');
            }
            console.log("[AdminPanel] Запрос верификации роли из БД перед показом админки...");
            verifyAdminRole().then(function(isAdmin) {
                if (!isAdmin) {
                    console.log("[AdminPanel] ДОСТУП ЗАПРЕЩЁН: пользователь не админ.");
                    var ap = document.getElementById('adminPage');
                    if (ap) ap.classList.add('hidden-page');
                    window.location.hash = 'page-homePage';
                    showPage('homePage');
                    return;
                }
                console.log("[AdminPanel] Роль подтверждена из БД. Показываем админ-панель.");
                var ap = document.getElementById('adminPage');
                if (ap) {
                    ap.classList.remove('hidden-page');
                    ap.classList.remove('hidden');
                }
                window.adminCurrentUsersPage = 1;
                renderAdminPanel();
                window.scrollTo(0, 0);
            });
            return;
        }
        // Для всех остальных страниц — показываем сразу
        window.location.hash = 'page-' + pageId;
        var target = document.getElementById(pageId);
        if (target) target.classList.remove('hidden-page');
        document.querySelectorAll('.nav-links a').forEach(function(a) { a.classList.remove('active'); });
        var map = { home: 'homePage', deals: 'dealsPage', reviews: 'reviewsPage', support: 'supportPage', profile: 'profilePage', admin: 'adminPage', settings: 'settingsPage' };
        var key = Object.keys(map).find(function(k) { return map[k] === pageId; });
        if (key) {
            var link = document.querySelector('.nav-links a[data-page="' + key + '"]');
            if (link) link.classList.add('active');
        }
        window.scrollTo(0, 0);
        if (pageId === 'dealsPage') renderDeals();
        if (pageId === 'profilePage') renderProfile();
        if (pageId === 'reviewsPage') renderReviews();
        if (pageId === 'supportPage') {
            renderUserTickets();
            if (userCurrentTicketId) {
                renderUserTicketChat(userCurrentTicketId);
            } else {
                document.getElementById('userTicketChatArea').style.display = 'none';
            }
        }
        if (pageId === 'homePage') {
            setTimeout(initFaq, 100);
        }
        if (pageId === 'settingsPage') {
            renderSettings();
        }
    }

    async function loadInitialDeals() {
        console.log("Вызов loadInitialDeals (пассивная загрузка, без INSERT)...");
        var feedEl = document.getElementById('liveDealsFeed');
        if (feedEl) feedEl.innerHTML = '';
        const { data, error } = await sb
            .from('deals')
            .select('*')
            .or('is_fake.eq.true,status.eq.completed')
            .order('created_at', { ascending: false })
            .limit(5);
        if (error) {
            console.error("Ошибка загрузки стартовых сделок:", error.message);
            return;
        }
        if (!data || data.length === 0) {
            console.log("База сделок пуста. Главная страница ожидает фейков от админа.");
            renderRecentDealsList([]);
            return;
        }
        console.log("Стартовые сделки успешно загружены:", data.length);
        renderRecentDealsList(data);
    }

    function renderRecentDealsList(data) {
        var feedDiv = document.getElementById('liveDealsFeed');
        if (!feedDiv || !data) return;
        if (data.length > 0) {
            data.slice().reverse().forEach(function(d) {
                var entry = { id: d.id, text: escapeHtml(anonymizeName(d.seller)) + ' завершил сделку на ' + (d.amount || 0).toLocaleString() + ' ₽ с ' + escapeHtml(anonymizeName(d.buyer)) + ' — ' + new Date(d.created_at).toLocaleTimeString() };
                lastDealsFeedArray.unshift(entry);
                if (lastDealsFeedArray.length > 5) lastDealsFeedArray.pop();
            });
            feedDiv.innerHTML = data.slice().reverse().map(function(d) {
                return '<div id="deal-card-' + d.id + '" class="feed-item" style="background:rgba(255,255,255,0.03); border:1px solid rgba(139,92,246,0.1); padding:10px 14px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; font-size:14px; margin-bottom:8px; color:#e2e8f0; cursor:default; user-select:none;">' +
                    '<div><i class="fas fa-bolt" style="color:#a78bfa;margin-right:8px;"></i><span style="color:#a78bfa; font-weight:600;">' + escapeHtml(anonymizeName(d.buyer)) + '</span> и <span style="color:#a78bfa; font-weight:600;">' + escapeHtml(anonymizeName(d.seller)) + '</span> завершили сделку</div>' +
                    '<div style="font-weight:bold; color:#34d399;">+ ' + (d.amount || 0).toLocaleString() + ' ₽</div>' +
                '</div>';
            }).join('');
        }
    }

    function addNewDealToFeedUI(d) {
        if (!d) return;
        // Update stats
        if (d.status === 'completed' && Number(d.amount) > 0) {
            systemStats.total_turnover = (systemStats.total_turnover || 0) + Number(d.amount);
            systemStats.total_deals = (systemStats.total_deals || 0) + 1;
            var totalEl = document.getElementById('totalVolume');
            if (totalEl) totalEl.innerText = systemStats.total_turnover.toLocaleString('ru-RU') + ' ₽';
        }
        // Add to feed
        var feedDiv = document.getElementById('liveDealsFeed');
        if (!feedDiv) return;
        var entry = { id: d.id, text: escapeHtml(anonymizeName(d.seller)) + ' завершил сделку на ' + (d.amount || 0).toLocaleString() + ' ₽ с ' + escapeHtml(anonymizeName(d.buyer)) + ' — ' + new Date(d.created_at).toLocaleTimeString() };
        lastDealsFeedArray.unshift(entry);
        if (lastDealsFeedArray.length > 5) lastDealsFeedArray.pop();
        feedDiv.innerHTML = lastDealsFeedArray.map(function(t) {
            return '<div id="deal-card-' + t.id + '" class="feed-item" style="background:rgba(255,255,255,0.03); border:1px solid rgba(139,92,246,0.1); padding:10px 14px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; font-size:14px; margin-bottom:8px; color:#e2e8f0; cursor:default; user-select:none;">' +
                '<div><i class="fas fa-bolt" style="color:#a78bfa;margin-right:8px;"></i>' + t.text + '</div>' +
            '</div>';
        }).join('');
    }

    async function initDealsRealtime() {
        if (window.myDealsChannel) {
            await sb.removeChannel(window.myDealsChannel);
        }
        window.myDealsChannel = sb
            .channel('deals-live-feed')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, function(payload) {
                console.log('[Realtime] Новое событие deals:', payload.eventType, payload.new.id, 'is_fake:', payload.new.is_fake, 'status:', payload.new.status);
                var isNewFake = payload.eventType === 'INSERT' && payload.new.is_fake;
                var isRealClosed = payload.eventType === 'UPDATE' && !payload.new.is_fake && (payload.new.status === 'closed' || payload.new.status === 'completed');
                if (isNewFake || isRealClosed) {
                    if (payload.eventType === 'UPDATE' && !payload.new.is_fake && payload.new.status === 'completed') {
                        showNotification('✅ Сделка успешно завершена');
                    }
                    addNewDealToFeedUI(payload.new);
                }
            })
            .subscribe(function(status) {
                console.log('[Realtime] Статус канала deals-live-feed:', status);
            });
    }

    function setupRealtimeSubscriptions() {
        if (window._dealsRealtimeSubscribed) {
            console.log('[Realtime] Подписки уже запущены, пропускаем.');
            return;
        }
        window._dealsRealtimeSubscribed = true;
        // ---- Канал для обновления баланса ----
        if (currentUser) {
            sb.channel('user-balance')
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, function(payload) {
                    var u = payload.new;
                    if (u.login === currentUser.login) {
                        currentUser.balance = u.balance;
                        currentUser.role = u.role;
                        window.isAdmin = (u.role === 'admin');
                        var idx = users.findIndex(function(x) { return x.login === u.login; });
                        if (idx !== -1) { users[idx].balance = u.balance; users[idx].role = u.role; }
                        updateUI();
                        console.log('[Realtime] Баланс обновлён:', u.balance + '₽, роль:', u.role);
                    }
                })
                .subscribe(function(status) {
                    console.log('[Realtime] Статус канала user-balance:', status);
                });
        }

        // ---- Канал для обновления статуса открытой сделки ----
        sb.channel('deal-status')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'deals' }, function(payload) {
                var d = payload.new;
                if (currentDealId && d.id == currentDealId) {
                    var idx = deals.findIndex(function(x) { return x.id === d.id; });
                    if (idx !== -1) deals[idx] = d;
                    loadSingleDealPage(d.id);
                    console.log('[Realtime] Статус сделки #' + d.id + ' обновлён:', d.status);
                    var rawStatus = d.status || '';
                    var translatedStatus = statusTranslations[rawStatus.toLowerCase()] || rawStatus;
                    showNotification('🔔 Статус вашей сделки #' + d.id + ' изменён на "' + translatedStatus + '"');
                }
            })
            .subscribe(function(status) {
                console.log('[Realtime] Статус канала deal-status:', status);
            });

        // ---- Канал для чата сделок ----
        sb.channel('deal-messages')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deal_messages' }, function(payload) {
                var msg = payload.new;
                console.log('[Realtime] Новое сообщение чата:', msg);
                if (currentDealId && msg.deal_id == currentDealId) {
                    if (!dealMessages[msg.deal_id]) dealMessages[msg.deal_id] = [];
                    var exists = dealMessages[msg.deal_id].some(function(m) { return m.id === msg.id; });
                    if (!exists) {
                        dealMessages[msg.deal_id].push(msg);
                        renderSingleDealChat(msg.deal_id);
                        showNotification('💬 Сообщение в чате сделки');
                    }
                }
            })
            .subscribe(function(status) {
                console.log('[Realtime] Статус канала deal-messages:', status);
            });

        // ---- Канал для новых тикетов поддержки ----
        sb.channel('support-tickets')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, function(payload) {
                var t = payload.new;
                if (payload.eventType === 'INSERT') {
                    var exists = supportTickets.some(function(x) { return x.id === t.id; });
                    if (!exists) {
                        supportTickets.unshift(t);
                        recalcOpenTicketCount();
                    }
                    if (currentUser && currentUser.role === 'admin') {
                        showNotification('🔔 Пользователь создал обращение: "' + t.subject + '"');
                    }
                } else if (payload.eventType === 'UPDATE') {
                    var idx = supportTickets.findIndex(function(x) { return x.id === t.id; });
                    if (idx !== -1) supportTickets[idx] = t;
                    recalcOpenTicketCount();
                    if (currentUser && String(currentUser.id) === String(t.user_id) && t.status === 'closed') {
                        showNotification('🔔 Ваше обращение "' + t.subject + '" было закрыто');
                    }
                } else if (payload.eventType === 'DELETE') {
                    supportTickets = supportTickets.filter(function(x) { return x.id !== payload.old.id; });
                    delete supportTicketMessages[payload.old.id];
                    recalcOpenTicketCount();
                }
                renderUserTickets();
                renderAdminTickets();
                if (adminCurrentTicketId && adminCurrentTicketId === t.id) {
                    renderAdminTicketChat(t.id);
                }
                if (userCurrentTicketId && userCurrentTicketId === t.id) {
                    renderUserTicketChat(t.id);
                }
            })
            .subscribe(function(status) {
                console.log('[Realtime] Статус канала support-tickets:', status);
            });

        // ---- Канал для сообщений тикетов ----
        sb.channel('ticket-messages')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_messages' }, function(payload) {
                var msg = payload.new;
                if (!supportTicketMessages[msg.ticket_id]) supportTicketMessages[msg.ticket_id] = [];
                var exists = supportTicketMessages[msg.ticket_id].some(function(m) { return m.id === msg.id; });
                if (!exists) {
                    supportTicketMessages[msg.ticket_id].push(msg);
                    if (adminCurrentTicketId === msg.ticket_id) {
                        renderAdminTicketChat(msg.ticket_id);
                    }
                    if (userCurrentTicketId === msg.ticket_id) {
                        renderUserTicketChat(msg.ticket_id);
                    }
                    if (currentUser && msg.sender_role !== 'system') {
                        var ticket = supportTickets.find(function(x) { return x.id === msg.ticket_id; });
                        if (ticket) {
                            if (currentUser.role === 'admin' && msg.sender_role !== 'admin') {
                                showNotification('🔔 Новое сообщение в обращении "' + ticket.subject + '"');
                            } else if (currentUser.role !== 'admin' && msg.sender_role === 'admin') {
                                showNotification('🔔 Поддержка ответила в обращении "' + ticket.subject + '"');
                            }
                        }
                    }
                }
            })
            .subscribe(function(status) {
                console.log('[Realtime] Статус канала ticket-messages:', status);
            });

        // ---- Глобальный канал для массовой рассылки ----
        sb.channel('global-broadcast', {
            config: {
                broadcast: { self: true }
            }
        })
            .on('broadcast', { event: 'broadcast' }, function(payload) {
                if (payload && (payload.message || payload.text)) {
                    var msg = payload.message || payload.text;
                    window.appNotifications.unshift({ text: '📢 ' + msg, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) });
                    if (window.appNotifications.length > 4) window.appNotifications.pop();
                    var list = document.getElementById('notifications-list');
                    if (list) {
                        list.innerHTML = '';
                        window.appNotifications.forEach(function(n) {
                            var item = document.createElement('div');
                            item.style.cssText = 'padding:6px 8px; border-bottom:1px solid rgba(255,255,255,0.05);';
                            item.innerHTML = '<span style="color:#6b7280; font-size:10px; margin-right:5px;">' + n.time + '</span> ' + n.text;
                            list.appendChild(item);
                        });
                    }
                    var badge = document.getElementById('bell-badge');
                    if (badge) {
                        var count = parseInt(badge.innerText) || 0;
                        count++;
                        badge.innerText = count;
                        badge.classList.remove('hidden');
                        var bellWrapper = document.getElementById('bell-wrapper');
                        if (bellWrapper) bellWrapper.style.display = 'inline-block';
                    }
                }
            })
            .subscribe(function(status) {
                console.log('[Realtime] Статус канала global-broadcast:', status);
            });

        // ---- Presence канал для отслеживания админов онлайн ----
        try {
            window.adminPresenceChannel = sb.channel('online-admins-presence', {
                config: { presence: { key: currentUser ? currentUser.login : 'anonymous' } }
            });

            window.adminPresenceChannel
                .on('presence', { event: 'sync' }, function() {
                    var newState = window.adminPresenceChannel.presenceState();
                    var realAdminsOnline = Object.keys(newState).length;
                    window.realAdminsOnline = realAdminsOnline;
                    updateAdminOnlineCounters(realAdminsOnline);
                })
                .subscribe(function(status) {
                    console.log('[Realtime] Статус канала online-admins-presence:', status);
                    if (status === 'SUBSCRIBED' && currentUser && currentUser.role === 'admin') {
                        window.adminPresenceChannel.track({ online_at: new Date().toISOString() });
                    }
                });
        } catch(e) {
            console.warn('[Realtime] Не удалось подключить Presence:', e);
        }
    }

    function updateAdminOnlineCounters(realCount) {
        var fakeCount = realCount === 0 ? (Math.floor(Math.random() * 2) + 1) : (realCount + 1);
        var userField = document.getElementById('fake-admins-count');
        if (userField) userField.innerText = fakeCount;
        var adminField = document.getElementById('real-admins-count-val');
        if (adminField) adminField.innerText = realCount;
    }

    function startLiveFeed() {
        var feedDiv = document.getElementById('liveDealsFeed');
        if (!feedDiv) return;
        if (feedDiv.getAttribute('data-live-running')) return;
        feedDiv.setAttribute('data-live-running', 'true');
    }

    // ===== ГЕНЕРАЦИЯ ФЕЙКОВЫХ СДЕЛОК (каждые 2–5 мин) =====
    async function generateFakeDeal() {
        if (!currentUser || currentUser.role !== 'admin') return;
        var items = ['CS2 Skin', 'Dota 2 Item', 'Steam Gift', 'Digital Goods', 'Game Account', 'Crypto Voucher', 'VPN Subscription', 'Software License'];
        var seller = 'User#' + Math.floor(100000 + Math.random() * 900000);
        var buyer = 'User#' + Math.floor(100000 + Math.random() * 900000);
        // 85% — мелкие/средние (150–3000₽), 15% — крупные (5000–30000₽)
        var amount = Math.random() < 0.85
            ? Math.floor(Math.random() * 2851) + 150
            : Math.floor(Math.random() * 25001) + 5000;
        var item = items[Math.floor(Math.random() * items.length)];
        try {
            var res = await sb.from('deals').insert({
                seller: seller,
                buyer: buyer,
                amount: amount,
                item: item,
                status: 'completed',
                is_fake: true,
                created_at: new Date().toISOString()
            });
            if (!res.error) {
                console.log('[FakeDeal] Сгенерирована и отправлена в БД новая сделка на сумму ' + amount + '₽:', seller, '->', buyer);
            } else {
                console.error('[FakeDeal] Ошибка вставки:', res.error);
            }
        } catch(e) {
            console.error('[FakeDeal] Исключение:', e);
        }
    }

    function startFakeDealsTimer() {
        console.log('[FakeDeal] Таймер фейковых сделок запущен');
        function tick() {
            const delay = Math.floor(Math.random() * (900000 - 300000 + 1)) + 300000;
            setTimeout(async function() {
                try {
                    await generateFakeDeal();
                } catch(e) {
                    console.error('[FakeDeal] Ошибка в tick:', e);
                }
                tick();
            }, delay);
        }
        tick();
    }

    function initFaq() {
        document.querySelectorAll('.faq-item').forEach(function(item) {
            var q = item.querySelector('.faq-question');
            var a = item.querySelector('.faq-answer');
            if (q && a) {
                q.removeEventListener('click', item._faqHandler);
                var handler = function() {
                    var isActive = item.classList.contains('active');
                    if (isActive) {
                        a.style.maxHeight = '0';
                        a.style.padding = '0 24px';
                        item.classList.remove('active');
                    } else {
                        item.classList.add('active');
                        a.style.padding = '18px 24px';
                        a.style.maxHeight = (a.scrollHeight + 36) + 'px';
                    }
                };
                item._faqHandler = handler;
                q.addEventListener('click', handler);
            }
        });
    }

    function openAuthModal() {
        var modal = document.getElementById('authModal');
        if (!modal) return;
        var title = document.getElementById('authTitle');
        var submit = document.getElementById('authSubmit');
        var switcher = document.getElementById('switchAuth');
        var loginInp = document.getElementById('login-identifier');
        var passInp = document.getElementById('authPass');
        var emailInp = document.getElementById('reg-email');
        var passConfirmInp = document.getElementById('reg-password-confirm');
        var nicknameInp = document.getElementById('reg-nickname');
        var errEl = document.getElementById('authError');
        if (!title || !submit || !switcher) return;

        isLoginMode = true;
        title.innerText = 'Вход';
        submit.innerText = 'Войти';
        switcher.innerText = 'Нет аккаунта? Регистрация';
        loginInp.placeholder = 'Логин или Email';
        loginInp.value = '';
        passInp.value = '';
        if (emailInp) { emailInp.style.display = 'none'; emailInp.value = ''; }
        if (passConfirmInp) { passConfirmInp.style.display = 'none'; passConfirmInp.value = ''; }
        if (nicknameInp) { nicknameInp.style.display = 'none'; nicknameInp.value = ''; }
        if (errEl) errEl.style.display = 'none';
        var agWrapper = document.getElementById('registration-agreement-wrapper');
        if (agWrapper) agWrapper.classList.add('hidden');
        var agreementCb = document.getElementById('reg-agreement');
        if (agreementCb) agreementCb.checked = false;

        var handler = async function() {
            var log = loginInp.value.trim();
            var pwd = passInp.value.trim();
            if (errEl) errEl.style.display = 'none';
            if (isLoginMode) {
                var res = await loginUser(log, pwd);
                if (!res.ok) {
                    if (errEl) {
                        errEl.innerText = res.msg;
                        errEl.style.display = 'block';
                    } else {
                        showToast(res.msg);
                    }
                }
                if (res.ok) {
                    modal.style.display = 'none';
                    updateUI();
                    if (currentDealId) {
                        loadSingleDealPage(currentDealId);
                    } else {
                        showPage('homePage');
                    }
                }
            } else {
                var email = emailInp ? emailInp.value.trim() : '';
                var nickname = nicknameInp ? nicknameInp.value.trim() : '';
                var pwdConfirm = passConfirmInp ? passConfirmInp.value.trim() : '';
                var emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
                if (!emailRegex.test(email)) {
                    if (errEl) {
                        errEl.innerText = 'Введите корректный Email адрес (например, user@example.com)!';
                        errEl.style.display = 'block';
                    }
                    return;
                }
                if (pwd !== pwdConfirm) {
                    if (errEl) {
                        errEl.innerText = 'Пароли не совпадают!';
                        errEl.style.display = 'block';
                    }
                    return;
                }
                var agreementCheck = document.getElementById('reg-agreement');
                if (!agreementCheck || !agreementCheck.checked) {
                    if (errEl) {
                        errEl.innerText = 'Вы должны принять пользовательское соглашение!';
                        errEl.style.display = 'block';
                    }
                    return;
                }
                var res2 = await registerUser(log, email, pwd, nickname);
                if (!res2.ok) {
                    if (errEl) {
                        errEl.innerText = res2.msg;
                        errEl.style.display = 'block';
                    } else {
                        showToast(res2.msg);
                    }
                }
                if (res2.ok) {
                    isLoginMode = true;
                    title.innerText = 'Вход';
                    submit.innerText = 'Войти';
                    switcher.innerText = 'Нет аккаунта? Регистрация';
                    loginInp.placeholder = 'Логин или Email';
                    loginInp.value = '';
                    passInp.value = '';
                    if (emailInp) { emailInp.style.display = 'none'; emailInp.value = ''; }
                    if (passConfirmInp) { passConfirmInp.style.display = 'none'; passConfirmInp.value = ''; }
                    if (nicknameInp) { nicknameInp.style.display = 'none'; nicknameInp.value = ''; }
                    if (errEl) errEl.style.display = 'none';
                    showToast(res2.msg);
                }
            }
        };
        loginInp.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); handler(); }
        });
        passInp.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); handler(); }
        });
        if (emailInp) {
            emailInp.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); handler(); }
            });
        }
        if (passConfirmInp) {
            passConfirmInp.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); handler(); }
            });
        }
        if (nicknameInp) {
            nicknameInp.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); handler(); }
            });
        }
        var switchHandler = function() {
            isLoginMode = !isLoginMode;
            if (isLoginMode) {
                title.innerText = 'Вход';
                submit.innerText = 'Войти';
                switcher.innerText = 'Нет аккаунта? Регистрация';
                loginInp.placeholder = 'Логин или Email';
                if (emailInp) emailInp.style.display = 'none';
                if (passConfirmInp) passConfirmInp.style.display = 'none';
                if (nicknameInp) nicknameInp.style.display = 'none';
                var agWrapper = document.getElementById('registration-agreement-wrapper');
                if (agWrapper) agWrapper.classList.add('hidden');
                var agreementCb = document.getElementById('reg-agreement');
                if (agreementCb) agreementCb.checked = false;
            } else {
                title.innerText = 'Регистрация';
                submit.innerText = 'Зарегистрироваться';
                switcher.innerText = 'Уже есть аккаунт? Войти';
                loginInp.placeholder = 'Логин';
                if (emailInp) emailInp.style.display = '';
                if (passConfirmInp) passConfirmInp.style.display = '';
                if (nicknameInp) nicknameInp.style.display = '';
                var agWrapper = document.getElementById('registration-agreement-wrapper');
                if (agWrapper) agWrapper.classList.remove('hidden');
            }
            loginInp.value = '';
            passInp.value = '';
            if (emailInp) emailInp.value = '';
            if (passConfirmInp) passConfirmInp.value = '';
            if (nicknameInp) nicknameInp.value = '';
            if (errEl) errEl.style.display = 'none';
        };
        submit.onclick = handler;
        switcher.onclick = switchHandler;
        document.getElementById('closeAuth').onclick = function() { modal.style.display = 'none'; };
        modal.style.display = 'flex';
        modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };
    }

    function showInfoModal(title, text) {
        var modal = document.getElementById('infoModal');
        if (!modal) return;
        document.getElementById('infoModalTitle').innerText = title;
        document.getElementById('infoModalText').innerHTML = text;
        modal.style.display = 'flex';
        document.getElementById('closeInfoModal').onclick = function() { modal.style.display = 'none'; };
        modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };
    }

    // ===== EVENT DELEGATION =====

    document.addEventListener('click', function(e) {
        var target = e.target;

        // Nav links
        var navLink = target.closest('.nav-links a');
        if (navLink) {
            var page = navLink.dataset.page;
            if (!currentUser && page !== 'home') { openAuthModal(); return; }
            // Дополнительная защита: если кто-то пытается перейти в админку не будучи админом
            if (page === 'admin' && (!currentUser || (currentUser.role !== 'admin' && !window.isAdmin))) {
                if (!currentUser) { openAuthModal(); return; }
                showToast('Доступ запрещён');
                showPage('homePage');
                return;
            }
            showPage({ home: 'homePage', deals: 'dealsPage', reviews: 'reviewsPage', support: 'supportPage', profile: 'profilePage', admin: 'adminPage', settings: 'settingsPage' }[page]);
            return;
        }

        // Logo
        if (target.closest('#logoHome')) {
            showPage('homePage');
            return;
        }

        // Theme toggle
        if (target.closest('#themeToggle')) {
            toggleTheme();
            return;
        }

        // Auth button
        if (target.closest('#authBtn')) {
            if (currentUser) logout();
            else openAuthModal();
            return;
        }

        // Info modals
        if (target.closest('#infoSpoofing')) { showInfoModal('Защита от спуфинга', spoofingText); return; }
        if (target.closest('#infoLegal')) { showInfoModal('Юридическая гарантия', legalText); return; }
        if (target.closest('#infoPhishing')) { showInfoModal('Антифишинг', phishingText); return; }

        // Create deal
        if (target.closest('#createDealBtn')) {
            handleCreateDeal();
            return;
        }

        // Payment
        if (target.closest('#payBalance')) {
            fakePay();
            return;
        }
        if (target.closest('#closePay')) {
            document.getElementById('paymentModal').style.display = 'none';
            return;
        }

        // Single deal page buttons
        if (target.closest('#singlePayBtn')) {
            handleSinglePay();
            return;
        }
        if (target.closest('#singleConfirmBtn')) {
            handleSingleConfirm();
            return;
        }
        if (target.closest('#singleDisputeBtn')) {
            handleSingleDispute();
            return;
        }
        if (target.closest('#backToMainBtn')) {
            hideSingleDeal();
            return;
        }

        // Single deal chat send
        if (target.closest('#singleDealChatSendBtn')) {
            if (currentDealId) {
                var text = document.getElementById('singleDealChatInput').value.trim();
                if (text) {
                    sendSingleDealMessage(currentDealId, text);
                }
                document.getElementById('singleDealChatInput').value = '';
            }
            return;
        }

        // FAQ buttons
        var faqBtn = target.closest('.faq-btn');
        if (faqBtn) {
            var q = faqBtn.dataset.question;
            var chatDiv2 = document.getElementById('chatMessages');
            chatDiv2.innerHTML += '<div class="message message-user">' + q + '</div>';
            setTimeout(function() {
                chatDiv2.innerHTML += '<div class="message message-bot">' + botReply(q) + '</div>';
                chatDiv2.scrollTop = chatDiv2.scrollHeight;
            }, 200);
            return;
        }

        // Contact support — открыть модалку создания тикета
        if (target.closest('#contactSupportBtn')) {
            if (!currentUser) { showToast('Войдите'); return; }
            document.getElementById('ticketSubject').value = '';
            document.getElementById('ticketMessage').value = '';
            document.getElementById('ticketModal').style.display = 'flex';
            return;
        }

        // Ticket modal: submit
        if (target.closest('#ticketSubmitBtn')) {
            handleCreateTicket();
            return;
        }
        if (target.closest('#closeTicketModal')) {
            document.getElementById('ticketModal').style.display = 'none';
            return;
        }

        // Ticket chat: user side
        if (target.closest('#userTicketChatSendBtn')) {
            handleUserTicketSend();
            return;
        }

        // Click ticket in user list
        var ticketItem = target.closest('.ticket-item[data-ticket-id]');
        if (ticketItem) {
            var tid = parseInt(ticketItem.dataset.ticketId);
            userCurrentTicketId = (userCurrentTicketId === tid) ? null : tid;
            renderUserTickets();
            if (userCurrentTicketId) {
                renderUserTicketChat(userCurrentTicketId);
            } else {
                document.getElementById('userTicketChatArea').style.display = 'none';
            }
            return;
        }

        // Recharge
        if (target.closest('#rechargeBalanceBtn')) {
            document.getElementById('rechargeModal').style.display = 'flex';
            document.getElementById('cryptoOptions').style.display = 'none';
            return;
        }
        if (target.closest('#cryptoRechargeBtn')) {
            var opt = document.getElementById('cryptoOptions');
            opt.style.display = opt.style.display === 'none' ? 'flex' : 'none';
            return;
        }
        var bankBtn = target.closest('.bank-btn[data-method]');
        if (bankBtn) {
            var method = bankBtn.dataset.method;
            var name = method === 'sber' ? 'СБЕР' : (method === 'tbank' ? 'Т-Банк' : 'ВТБ');
            handleBankCrypto(name, 1000);
            return;
        }
        var cryptoBtn = target.closest('.crypto-btn');
        if (cryptoBtn) {
            handleBankCrypto(cryptoBtn.dataset.crypto.toUpperCase(), 2000);
            return;
        }
        if (target.closest('#closeRecharge')) {
            document.getElementById('rechargeModal').style.display = 'none';
            return;
        }

        // Withdraw
        if (target.closest('#withdrawBalanceBtn')) {
            document.getElementById('withdrawModal').style.display = 'flex';
            return;
        }
        if (target.closest('#doWithdraw')) {
            handleWithdraw();
            return;
        }
        if (target.closest('#closeWithdraw')) {
            document.getElementById('withdrawModal').style.display = 'none';
            return;
        }

        // Reviews
        if (target.closest('#addReviewBtn')) {
            if (currentUser) document.getElementById('reviewModal').style.display = 'flex';
            else showToast('Войдите');
            return;
        }
        if (target.closest('#submitReview')) {
            handleSubmitReview();
            return;
        }
        if (target.closest('#closeRev')) {
            document.getElementById('reviewModal').style.display = 'none';
            return;
        }

        // Delete review
        var delRev = target.closest('.delRev');
        if (delRev) {
            var revId = parseInt(delRev.dataset.id);
            deleteReview(revId).then(function() {
                renderReviews();
                showToast('Отзыв удалён');
            });
            return;
        }

        // Deal item click — open in same window
        var dealItem = target.closest('.deal-item');
        if (dealItem && !target.closest('button')) {
            var dip = parseInt(dealItem.dataset.id);
            if (!isNaN(dip) && deals.find(function(d) { return d.id == dip; })) {
                if (currentUser && (currentUser.login === dealItem.dataset.seller || currentUser.login === dealItem.dataset.buyer)) {
                    showSingleDeal(dip);
                    return;
                }
            }
        }

        // Delete deal button
        var delDeal = target.closest('.deleteDealBtn');
        if (delDeal) {
            e.stopPropagation();
            var dealId2 = parseInt(delDeal.dataset.id);
            var d2 = deals.find(function(d) { return d.id === dealId2; });
            if (d2 && d2.status === 'completed') {
                deleteDeal(dealId2).then(function() {
                    renderDeals();
                    renderProfile();
                    updateGlobalStats();
                    showToast('Сделка #' + dealId2 + ' удалена.');
                });
            }
            return;
        }

        // Rating modal
        if (target.closest('#submitRating')) {
            handleSubmitRating();
            return;
        }
        if (target.closest('#closeRating')) {
            document.getElementById('ratingModal').style.display = 'none';
            return;
        }

        // Admin (только для администраторов)
        if (currentUser && (currentUser.role === 'admin' || window.isAdmin)) {
            if (target.closest('#setOnline')) { handleSetOnline(); return; }
            if (target.closest('#addTurnover')) { handleAddTurnover(); return; }
            if (target.closest('#setRatingBtn')) { handleSetRating(); return; }
            if (target.closest('#setCompletedBtn')) { handleSetCompleted(); return; }
            if (target.closest('#sendBroadcast')) { handleSendBroadcast(); return; }

            // Inline action buttons in user list (data-action)
            var actionBtn = target.closest('[data-action]');
            if (actionBtn) {
                var action = actionBtn.dataset.action;
                var login = actionBtn.dataset.login;
                var u = users.find(function(x) { return x.login === login; });
                if (!u || !u.id) { showToast('Пользователь не найден'); return; }
                if (action === 'add-balance') {
                    var amount = prompt('Введите сумму начисления для ' + login + ':');
                    if (amount !== null && !isNaN(parseInt(amount)) && parseInt(amount) > 0) {
                        u.balance = (u.balance || 0) + parseInt(amount);
                        upsertUser(u).then(function() {
                            if (currentUser && currentUser.login === login) currentUser.balance = u.balance;
                            updateUI(); renderAdminPanel();
                            showToast('Начислено ' + amount + '₽ ' + login);
                        });
                    }
                } else if (action === 'promote') {
                    if (confirm('Сделать ' + login + ' администратором?')) {
                        u.role = 'admin';
                        upsertUser(u).then(function() {
                            if (currentUser && currentUser.login === login) currentUser.role = 'admin';
                            updateUI(); renderAdminPanel();
                            showToast(login + ' теперь администратор');
                        });
                    }
                } else if (action === 'ban') {
                    u.banned = !u.banned;
                    upsertUser(u).then(function() {
                        if (currentUser && currentUser.login === u.login && u.banned) logout();
                        renderAdminPanel();
                        showToast(u.login + ' ' + (u.banned ? 'забанен' : 'разбанен'));
                    });
                }
                return;
            }

            var adminStatusBtn = target.closest('.adminChangeStatus');
            if (adminStatusBtn) {
                var did = parseInt(adminStatusBtn.dataset.id);
                var dd = deals.find(function(x) { return x.id === did; });
                if (dd) {
                    var ns = prompt('Статус (waiting_payment, escroy, completed, disputed)', dd.status);
                    if (ns && ['waiting_payment', 'escroy', 'completed', 'disputed'].includes(ns)) {
                        updateDeal(did, { status: ns }).then(function() {
                            renderDeals();
                            renderAdminPanel();
                            showToast('Статус #' + did + ' изменён');
                        });
                    }
                }
                return;
            }

            var adminDelBtn = target.closest('.adminDeleteDeal');
            if (adminDelBtn) {
                var delId = parseInt(adminDelBtn.dataset.id);
                deleteDeal(delId).then(function() {
                    renderDeals();
                    renderAdminPanel();
                    showToast('Сделка #' + delId + ' удалена');
                });
                return;
            }

            // Admin pagination for users
            var pageBtn = target.closest('#users-pagination-controls button[data-upage]');
            if (pageBtn) {
                var newPage = parseInt(pageBtn.dataset.upage);
                if (newPage && newPage !== window.adminCurrentUsersPage) {
                    window.adminCurrentUsersPage = newPage;
                    renderAdminPanel();
                    var userListDiv = document.getElementById('userListAdmin');
                    if (userListDiv) userListDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                return;
            }

            // Admin ticket chat: send
            if (target.closest('#adminTicketChatSendBtn')) {
                handleAdminTicketSend();
                return;
            }

            // Admin ticket chat: close
            if (target.closest('#adminCloseTicketBtn')) {
                handleAdminCloseTicket();
                return;
            }

            // Admin fast templates
            var templateBtn = target.closest('#admin-fast-templates .template-btn');
            if (templateBtn) {
                var input = document.getElementById('adminTicketChatInput');
                if (input) {
                    input.value = templateBtn.dataset.text;
                    input.focus();
                }
                return;
            }

            // Click ticket in admin list
            var adminTicketItem = target.closest('.ticket-item[data-admin-ticket-id]');
            if (adminTicketItem) {
                var atid = parseInt(adminTicketItem.dataset.adminTicketId);
                adminCurrentTicketId = (adminCurrentTicketId === atid) ? null : atid;
                renderAdminTickets();
                if (adminCurrentTicketId) {
                    renderAdminTicketChat(adminCurrentTicketId);
                } else {
                    document.getElementById('adminTicketChatArea').style.display = 'none';
                }
                return;
            }
        }

        // Guest register button
        if (target.closest('#guestRegisterBtn')) {
            openAuthModal();
            return;
        }

        // Single deal login button
        if (target.closest('#singleLoginBtn')) {
            openAuthModal();
            return;
        }

    });

    // ===== TICKET HANDLERS =====

    async function handleCreateTicket() {
        if (!currentUser) { showToast('Войдите'); return; }
        var subject = document.getElementById('ticketSubject').value.trim();
        var message = document.getElementById('ticketMessage').value.trim();
        if (!subject || !message) { showToast('Заполните тему и сообщение'); return; }
        var saved = await insertTicket(subject, message);
        if (saved) {
            document.getElementById('ticketModal').style.display = 'none';
            showToast('Обращение #' + saved.id + ' создано');
            renderUserTickets();
            userCurrentTicketId = saved.id;
            renderUserTickets();
            var firstMsg = { ticket_id: saved.id, sender_id: String(currentUser.id), sender_role: 'user', message: message };
            await insertTicketMessage(saved.id, firstMsg);
            var sysMsg = { ticket_id: saved.id, sender_id: 'Система', sender_role: 'system', message: 'Обращение создано. Ожидайте ответа администратора.' };
            await insertTicketMessage(saved.id, sysMsg);
            renderUserTicketChat(saved.id);
        }
    }

    async function handleUserTicketSend() {
        if (!currentUser || !userCurrentTicketId) return;
        var ticket = supportTickets.find(function(t) { return t.id === userCurrentTicketId; });
        if (!ticket || ticket.status === 'closed') { showToast('Обращение закрыто'); return; }
        var text = document.getElementById('userTicketChatInput').value.trim();
        if (!text) return;
        var msg = { ticket_id: userCurrentTicketId, sender_id: String(currentUser.id), sender_role: 'user', message: text };
        await insertTicketMessage(userCurrentTicketId, msg);
        document.getElementById('userTicketChatInput').value = '';
        renderUserTicketChat(userCurrentTicketId);
    }

    async function handleAdminTicketSend() {
        if (!currentUser || !adminCurrentTicketId) return;
        var ticket = supportTickets.find(function(t) { return t.id === adminCurrentTicketId; });
        if (!ticket || ticket.status === 'closed') { showToast('Обращение закрыто'); return; }
        var text = document.getElementById('adminTicketChatInput').value.trim();
        if (!text) return;
        var msg = { ticket_id: adminCurrentTicketId, sender_id: String(currentUser.id), sender_role: 'admin', message: text };
        await insertTicketMessage(adminCurrentTicketId, msg);
        document.getElementById('adminTicketChatInput').value = '';
        renderAdminTicketChat(adminCurrentTicketId);
    }

    async function handleAdminCloseTicket() {
        if (!currentUser || !adminCurrentTicketId) return;
        if (!confirm('Закрыть обращение?')) return;
        var now = new Date().toISOString();
        await updateTicket(adminCurrentTicketId, { status: 'closed', closed_at: now });
        var sysMsg = { ticket_id: adminCurrentTicketId, sender_id: 'Система', sender_role: 'system', message: 'Обращение закрыто администратором.' };
        await insertTicketMessage(adminCurrentTicketId, sysMsg);
        renderAdminTicketChat(adminCurrentTicketId);
        renderAdminTickets();
        renderUserTickets();
        showToast('Обращение #' + adminCurrentTicketId + ' закрыто');
    }

    // ===== HANDLERS =====

    async function handleCreateDeal() {
        if (!currentUser) { showToast('Войдите'); return; }
        var item = document.getElementById('itemName').value.trim();
        var amount = parseFloat(document.getElementById('dealAmount').value);
        var seller = document.getElementById('sellerName').value.trim() || currentUser.login;
        var buyer = document.getElementById('buyerName').value.trim();
        if (!item || isNaN(amount) || amount < 100 || amount > 5000 || !buyer) { showToast('Заполните все поля (сумма от 100 до 5 000 ₽)'); return; }
        if (!users.find(function(u) { return u.login === buyer; })) { showToast('Покупатель "' + buyer + '" не зарегистрирован.'); return; }
        var code = Math.floor(100000 + Math.random() * 900000).toString();
        var newDeal = { item: item, amount: amount, seller: seller, buyer: buyer, code: code, status: 'waiting_payment' };
        var saved = await insertDeal(newDeal);
        if (saved) {
            renderDeals();
            showToast('Сделка #' + saved.id + ' создана! Покупатель должен открыть её и оплатить.');
            document.getElementById('itemName').value = '';
            document.getElementById('dealAmount').value = '';
            document.getElementById('sellerName').value = '';
            document.getElementById('buyerName').value = '';
        } else {
            showToast('Ошибка создания сделки');
        }
    }

    async function handleSinglePay() {
        var dealId = currentDealId;
        if (!dealId) return;
        var deal = deals.find(function(d) { return d.id == dealId; });
        if (!deal || deal.status !== 'waiting_payment' || !currentUser || currentUser.login !== deal.buyer) return;
        if ((currentUser.balance || 0) < deal.amount) {
            showToast('Недостаточно средств. Баланс: ' + (currentUser.balance || 0) + '₽');
            return;
        }
        window.currentPayDealId = deal.id;
        document.getElementById('modalAmount').innerHTML = deal.amount + ' ₽';
        document.getElementById('paymentModal').style.display = 'flex';
    }

    async function handleSingleConfirm() {
        var dealId = currentDealId;
        if (!dealId) return;
        var deal = deals.find(function(d) { return d.id == dealId; });
        if (!deal || deal.status !== 'escroy' || !currentUser || currentUser.login !== deal.buyer) return;

        deal.status = 'completed';
        var seller = users.find(function(u) { return u.login === deal.seller; });
        if (seller) {
            seller.balance = (seller.balance || 0) + deal.amount;
            if (currentUser.login === seller.login) currentUser.balance = seller.balance;
            await upsertUser(seller);
        }
        await updateDeal(deal.id, { status: 'completed', created_at: new Date().toISOString() });

        // Прямое обновление ленты последних сделок (дублирует Realtime для надёжности)
        var feedDiv = document.getElementById('liveDealsFeed');
        if (feedDiv) {
            var entry = { id: deal.id, text: escapeHtml(anonymizeName(deal.seller)) + ' завершил сделку на ' + (deal.amount || 0).toLocaleString() + ' ₽ с ' + escapeHtml(anonymizeName(deal.buyer)) + ' — ' + new Date().toLocaleTimeString() };
            lastDealsFeedArray.unshift(entry);
            if (lastDealsFeedArray.length > 5) lastDealsFeedArray.pop();
            feedDiv.innerHTML = lastDealsFeedArray.map(function(t) {
                return '<div id="deal-card-' + t.id + '"><i class="fas fa-exchange-alt"></i> ' + t.text + '</div>';
            }).join('');
        }

        var sysMsg = { deal_id: deal.id, sender: 'Система', text: 'Покупатель подтвердил получение товара. Деньги переведены продавцу.', timestamp: new Date().toLocaleString(), system: true };
        await insertDealMessage(deal.id, sysMsg);

        showToast('Сделка #' + deal.id + ' завершена!');
        loadSingleDealPage(deal.id);
        renderDeals();

        await updateSystemStats({
            total_deals: (systemStats.total_deals || 0) + 1,
            total_turnover: (systemStats.total_turnover || 0) + deal.amount
        });
        updateGlobalStats();

        // Check achievements for seller
        await checkAndAwardAchievements(deal.seller);

        // Show rating modal for buyer to rate seller
        document.getElementById('ratingDealInfo').innerHTML = 'Оцените продавца <strong>' + escapeHtml(deal.seller) + '</strong> по сделке #' + deal.id + ' (' + escapeHtml(deal.item) + ')';
        document.getElementById('ratingStars').value = '5';
        document.getElementById('ratingText').value = '';
        window.ratingDealId = deal.id;
        document.getElementById('ratingModal').style.display = 'flex';
    }

    async function handleSingleDispute() {
        var dealId = currentDealId;
        if (!dealId) return;
        var deal = deals.find(function(d) { return d.id == dealId; });
        if (!deal || deal.status === 'completed') return;
        await updateDeal(deal.id, { status: 'disputed' });
        var sysMsg = { deal_id: deal.id, sender: 'Система', text: 'Открыт арбитраж. Ожидайте решения.', timestamp: new Date().toLocaleString(), system: true };
        await insertDealMessage(deal.id, sysMsg);
        showToast('Арбитраж открыт.');
        loadSingleDealPage(deal.id);
        renderDeals();
        updateGlobalStats();
    }

    async function fakePay() {
        var deal = deals.find(function(x) { return x.id === window.currentPayDealId; });
        if (deal && deal.status === 'waiting_payment' && currentUser && currentUser.login === deal.buyer) {
            if ((currentUser.balance || 0) < deal.amount) {
                showToast('Недостаточно средств');
                document.getElementById('paymentModal').style.display = 'none';
                return;
            }
            currentUser.balance -= deal.amount;
            await upsertUser(currentUser);
            await updateDeal(deal.id, { status: 'escroy' });
            renderDeals();
            showToast('Сделка #' + deal.id + ' оплачена, средства заморожены.');
            var sysMsg = { deal_id: deal.id, sender: 'Система', text: 'Покупатель оплатил сделку. Теперь подтвердите получение товара.', timestamp: new Date().toLocaleString(), system: true };
            await insertDealMessage(deal.id, sysMsg);
            if (currentDealId === deal.id) loadSingleDealPage(deal.id);
            updateGlobalStats();
            document.getElementById('paymentModal').style.display = 'none';
        } else {
            showToast('Ошибка оплаты');
            document.getElementById('paymentModal').style.display = 'none';
        }
    }

    async function sendSingleDealMessage(dealId, text) {
        if (!currentUser) return showToast('Войдите');
        var deal = deals.find(function(d) { return d.id == dealId; });
        if (!deal || (deal.seller !== currentUser.login && deal.buyer !== currentUser.login)) return;
        if (!text.trim()) return;
        var msg = { deal_id: dealId, sender: currentUser.login, text: text.trim(), timestamp: new Date().toLocaleString(), system: false };
        await insertDealMessage(dealId, msg);
        renderSingleDealChat(dealId);
    }

    async function handleBankCrypto(name, amount) {
        if (!currentUser) return showToast('Войдите');
        currentUser.balance = (currentUser.balance || 0) + amount;
        currentUser.total_deposit = (currentUser.total_deposit || 0) + amount;
        await upsertUser(currentUser);
        updateUI();
        renderProfile();
        showToast('Пополнение на ' + amount + '₽ через ' + name + ' выполнено!');
        document.getElementById('rechargeModal').style.display = 'none';
    }

    async function handleWithdraw() {
        var amt = parseInt(document.getElementById('withdrawSum').value);
        var details = document.getElementById('withdrawDetails').value.trim();
        if (amt > 0 && currentUser && (currentUser.balance || 0) >= amt && details) {
            currentUser.balance -= amt;
            currentUser.total_withdraw = (currentUser.total_withdraw || 0) + amt;
            await upsertUser(currentUser);
            updateUI();
            renderProfile();
            showToast('Заявка на вывод ' + amt + '₽ на ' + details + ' отправлена');
            document.getElementById('withdrawModal').style.display = 'none';
        } else showToast('Ошибка');
    }

    async function handleSubmitReview() {
        var rating = parseInt(document.getElementById('revRating').value);
        var text = document.getElementById('revText').value.trim();
        if (text && currentUser) {
            var rev = { user_login: currentUser.login, rating: rating, text: text, date: new Date().toISOString().split('T')[0] };
            var saved = await insertReview(rev);
            if (saved) {
                renderReviews();
                document.getElementById('reviewModal').style.display = 'none';
                showToast('Спасибо за отзыв');
            }
        }
    }

    async function handleSubmitRating() {
        var rating = parseInt(document.getElementById('ratingStars').value);
        var text = document.getElementById('ratingText').value.trim();
        var dealId = window.ratingDealId;
        if (!dealId || !currentUser) return;
        var deal = deals.find(function(d) { return d.id === dealId; });
        if (!deal) return;
        await insertRating({
            deal_id: dealId,
            from_user: currentUser.login,
            to_user: deal.seller,
            rating: rating,
            text: text || ''
        });
        document.getElementById('ratingModal').style.display = 'none';
        showToast('Спасибо за оценку!');
    }

    async function handleSetOnline() {
        if (!currentUser || currentUser.role !== 'admin') return;
        var val = parseInt(document.getElementById('fakeOnlineVal').value);
        if (!isNaN(val) && val > 0) {
            await sb.from('platform_settings').update({ value: String(val) }).eq('key', 'online_counter');
            await sb.from('platform_settings').upsert({ key: 'online_counter_updated', value: new Date().toISOString() }, { onConflict: 'key' });
            fakeOnline = val;
            onlineBaseValue = val;
            localStorage.setItem('cached_online_counter', String(val));
            updateGlobalStats();
            showToast('Онлайн: ' + fakeOnline);
        }
    }

    async function handleAddTurnover() {
        if (!currentUser || currentUser.role !== 'admin') return;
        var addVal = parseInt(document.getElementById('addTurnoverVal').value);
        if (!isNaN(addVal) && addVal > 0) {
            await updateSystemStats({
                total_turnover: (systemStats.total_turnover || 0) + addVal
            });
            updateGlobalStats();
            showToast('Оборот увеличен на ' + addVal + ' ₽');
        } else showToast('Введите корректную сумму');
    }

    function handleSetRating() {
        if (!currentUser || currentUser.role !== 'admin') return;
        var newRating = parseFloat(document.getElementById('setRatingVal').value);
        if (!isNaN(newRating) && newRating >= 0 && newRating <= 5) {
            var ratingSpan = document.getElementById('ratingValue');
            if (ratingSpan) ratingSpan.innerText = newRating.toFixed(1);
            showToast('Рейтинг изменён на ' + newRating.toFixed(1));
        } else showToast('Введите число от 0 до 5');
    }

    async function handleSetCompleted() {
        if (!currentUser || currentUser.role !== 'admin') return;
        var newCompleted = parseInt(document.getElementById('setCompletedVal').value);
        if (!isNaN(newCompleted) && newCompleted >= 0) {
            await updateSystemStats({ total_deals: newCompleted });
            updateGlobalStats();
            showToast('Количество завершённых сделок: ' + newCompleted);
        } else showToast('Введите число');
    }

    function handleSendBroadcast() {
        if (!currentUser || currentUser.role !== 'admin') return;
        var msg = document.getElementById('broadcastMsg').value.trim();
        if (!msg) return;
        sb.channel('global-broadcast').send({
            type: 'broadcast',
            event: 'broadcast',
            payload: { message: msg }
        });
        showNotification('📢 Рассылка: ' + msg);
        showToast('📢 Рассылка отправлена всем пользователям');
        document.getElementById('broadcastMsg').value = '';
    }

    function botReply(q) {
        q = q.toLowerCase();
        if (q.includes('вывод')) return 'Вывод от 100₽, комиссия 0.3%.';
        if (q.includes('пополнение')) return 'Пополнение через банки или крипту.';
        if (q.includes('создать сделку')) return 'Создаёт продавец, оплачивает и подтверждает покупатель.';
        if (q.includes('статус')) return 'Статус виден в деталях сделки.';
        return 'Задайте вопрос о выводе, пополнении, сделке или статусе.';
    }

    var spoofingText = 'Технология защиты от спуфинга (подмены данных). Мы проверяем цифровые подписи всех участников сделки, блокируем попытки выдать себя за доверенное лицо. Ваши средства никогда не будут переведены на неподтверждённый кошелёк. Система анализирует более 30 параметров соединения: IP-адрес, цифровой отпечаток браузера, историю транзакций и другие метрики.';
    var legalText = 'Юридическая гарантия: все сделки защищены публичным договором оферты. В случае нарушения условий мы предоставляем полный пакет документов для обращения в суд. Юридическая поддержка включена для пользователей с высоким уровнем доверия. Гарантируем возврат средств до 90 дней при доказанном мошенничестве.';
    var phishingText = 'Антифишинговая защита: двухфакторная аутентификация, белые списки адресов кошельков, система предупреждения о подозрительных ссылках. При попытке перехода на фишинговый сайт аккаунт автоматически блокируется до подтверждения личности. Защита от подмены DNS и SSL-сертификатов.';

    // ===== ONLINE FLUCTUATION (DB-synced, every 60s) =====

    async function refreshOnlineCounter() {
        try {
            var [rVal, rTime] = await Promise.all([
                sb.from('platform_settings').select('value').eq('key', 'online_counter'),
                sb.from('platform_settings').select('value').eq('key', 'online_counter_updated')
            ]);

            if (rVal.data && rVal.data.length > 0 && rVal.data[0].value) {
                var lastUpdated = rTime.data && rTime.data.length > 0 && rTime.data[0].value ? new Date(rTime.data[0].value) : null;
                var now = new Date();
                var needsUpdate = !lastUpdated || (now - lastUpdated) >= 60000;

                if (needsUpdate) {
                    var newVal = Math.floor(Math.random() * 301) + 200;
                    await sb.from('platform_settings').update({ value: String(newVal) }).eq('key', 'online_counter');
                    await sb.from('platform_settings').upsert({ key: 'online_counter_updated', value: now.toISOString() }, { onConflict: 'key' });
                    fakeOnline = newVal;
                    onlineBaseValue = newVal;
                } else {
                    var currentVal = parseInt(rVal.data[0].value);
                    if (!isNaN(currentVal) && currentVal > 0) {
                        fakeOnline = currentVal;
                        onlineBaseValue = currentVal;
                    }
                }
                localStorage.setItem('cached_online_counter', String(fakeOnline));
                var onlineSpan = document.getElementById('onlineCount');
                if (onlineSpan) onlineSpan.innerText = fakeOnline;
            }
        } catch (e) {
            console.log("🚨 Ошибка refreshOnlineCounter:", e.message);
        }
    }

    setInterval(refreshOnlineCounter, 60000);

    // ===== БЛОКИРУЮЩАЯ ИНИЦИАЛИЗАЦИЯ =====

    async function initApp() {
        console.log("Точка А: Приложение загружается, проверяем сессию...");

        // Небольшая пауза, чтобы SDK гарантированно прочитал токены из памяти браузера
        console.log("Точка А.1: Ожидаем 200мс перед getSession...");
        await new Promise(function(resolve) { setTimeout(resolve, 200); });

        try {
            // 1. Сначала жестко дожидаемся ответа о сессии
            console.log("Точка Б: Вызываем sb.auth.getSession()...");
            const { data: { session }, error } = await sb.auth.getSession();
            if (error) console.error('[Session] Ошибка getSession:', error);
            console.log("Точка Б.1: getSession() завершён, session =", session ? session.user.id : null);

            // 2. Добавляем колонку is_fake, если её нет (для фильтрации фейковых сделок)
            try {
                await sb.from('deals').select('is_fake').limit(1);
            } catch(e) {
                try {
                    await sb.rpc('exec_sql', { query: 'ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS is_fake BOOLEAN NOT NULL DEFAULT false;' });
                } catch(e2) {
                    console.warn('[Init] Не удалось добавить колонку is_fake:', e2.message);
                }
            }
            // 3. Загружаем все данные из БД
            console.log("Точка В: Загружаем данные из БД...");
            await loadAllData();
            console.log("Точка В.1: Данные загружены, users =", users.length, "deals =", deals.length);

            // Загружаем счётчик онлайна из БД
            await loadOnlineCounter();

            // 3. Восстанавливаем пользователя по сессии
            console.log("Точка Г: Восстанавливаем пользователя...");
            if (session && session.user && session.user.email) {
                var sessionEmail = session.user.email;
                console.log("Сессия успешно восстановлена для:", session.user.id, "email:", sessionEmail);
                var u = users.find(function(x) { return x.email === sessionEmail; });
                if (u && !u.banned) {
                    currentUser = u;
                    currentUser.id = session.user.id;
                    await verifyAdminRole();
                    console.log('[Session] Пользователь восстановлен:', currentUser.login, 'admin:', window.isAdmin);
                } else {
                    console.log("Точка Г-ERROR: Пользователь не найден или забанен, включаем гостевой режим.");
                }
            } else {
                console.log("Точка Г-INFO: Активной сессии не найдено, включаем гостевой режим.");
            }

            // Fallback: если Supabase не дал сессию, пробуем localStorage
            if (!currentUser) {
                var saved = localStorage.getItem('vg_user');
                if (saved) {
                    try {
                        var parsed = JSON.parse(saved);
                        var u = findUserByLogin(parsed.login);
                        if (u && !u.banned) {
                            currentUser = u;
                            await verifyAdminRole();
                            console.log("Точка Г-FALLBACK: Пользователь восстановлен из localStorage:", currentUser.login, 'admin:', window.isAdmin);
                        }
                    } catch(e) {}
                }
            }

            // Нормализация short_id: присваиваем 6-значные ID пользователям без short_id
            for (var i = 0; i < users.length; i++) {
                if (!users[i].short_id) {
                    var newId = String(Math.floor(100000 + Math.random() * 900000));
                    users[i].short_id = newId;
                    sb.from('users').update({ short_id: newId }).eq('id', users[i].id).then();
                }
            }
            // Сбрасываем старый localStorage с ID "1"
            localStorage.removeItem('vg_user');

            // 4. Отрисовываем UI
            console.log("Точка Д: Отрисовываем UI...");
            if (currentUser) {
                await loadUserTickets();
            }
            updateUI();
            updateGlobalStats();
            renderReviews();
            renderDeals();
        } catch (err) {
            console.error("Ошибка при загрузке данных:", err);
        } finally {
            // 5. Загружаем стартовые сделки из БД
            console.log("Точка Е: Загружаем стартовые сделки...");
            await loadInitialDeals();

            // 6. Подключаем Realtime каналы
            console.log('[Realtime] Настройка подписок...');
            setupRealtimeSubscriptions();
            subscribeOnlineCounter();

            // 7.5 Авто-удаление старых закрытых тикетов
            await autoDeleteOldClosedTickets();

            // 8. Показываем страницу (восстанавливаем из URL-хэша при F5)
            console.log("Точка Ж: Показываем страницу...");
            document.getElementById('mainContent').classList.remove('hidden');
            document.getElementById('singleDealPage').classList.add('hidden');
            navigateFromHash();

            setTimeout(function() {
                startLiveFeed();
                initFaq();
            }, 200);

            var preloader = document.getElementById('preloader');
            var appWrapper = document.getElementById('app-wrapper');
            if (preloader && appWrapper) {
                preloader.style.opacity = '0';
                appWrapper.style.opacity = '1';
                setTimeout(function() {
                    preloader.remove();
                }, 500);
            }

            console.log('[Init] Инициализация завершена');
        }
    }

    function navigateFromHash() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#') === 0) {
            hash = hash.substring(1);
        }
        if (hash.indexOf('page-') === 0) {
            hash = hash.substring(5);
        }
        if (hash.indexOf('deal-') === 0) {
            var dealId = parseInt(hash.split('-')[1]);
            var targetDeal = deals.find(function(d) { return d.id == dealId; });
            if (targetDeal) {
                if (!currentUser || (currentUser.login !== targetDeal.seller && currentUser.login !== targetDeal.buyer)) {
                    window.location.hash = '';
                    showPage('homePage');
                    return;
                }
                ['homePage', 'dealsPage', 'reviewsPage', 'supportPage', 'profilePage', 'settingsPage', 'adminPage'].forEach(function(p) {
                    var el = document.getElementById(p);
                    if (el) el.classList.add('hidden-page');
                });
                document.querySelectorAll('.nav-links a').forEach(function(a) { a.classList.remove('active'); });
                var dealLink = document.querySelector('.nav-links a[data-page="deals"]');
                if (dealLink) dealLink.classList.add('active');
                showSingleDeal(dealId);
            } else {
                showPage('homePage');
            }
        } else if (['homePage', 'dealsPage', 'reviewsPage', 'supportPage', 'profilePage', 'settingsPage', 'adminPage'].indexOf(hash) !== -1) {
            if (hash === 'adminPage' && (!currentUser || currentUser.role !== 'admin')) { hash = 'homePage'; }
            if (hash === 'settingsPage' && !currentUser) { hash = 'homePage'; }
            showPage(hash);
        } else {
            showPage('homePage');
        }
    }

    window.addEventListener('hashchange', function() {
        navigateFromHash();
    });

    document.addEventListener('DOMContentLoaded', function() {
        // Enter key для чата сделок (Shift+Enter — перенос строки)
        var dealChatInput = document.getElementById('singleDealChatInput');
        if (dealChatInput) {
            dealChatInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (currentDealId) {
                        var text = this.value.trim();
                        if (text) sendSingleDealMessage(currentDealId, text);
                        this.value = '';
                    }
                }
            });
        }
        // Enter key для чата поддержки (пользователь)
        var userTicketInput = document.getElementById('userTicketChatInput');
        if (userTicketInput) {
            userTicketInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleUserTicketSend();
                }
            });
        }
        // Enter key для чата поддержки (админ)
        var adminTicketInput = document.getElementById('adminTicketChatInput');
        if (adminTicketInput) {
            adminTicketInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAdminTicketSend();
                }
            });
        }
        // Клик по колокольчику — toggle с анимацией
        var bellWrapper = document.getElementById('bell-wrapper');
        if (bellWrapper) {
            bellWrapper.addEventListener('click', function(e) {
                e.stopPropagation();
                var dropdown = document.getElementById('notification-dropdown');
                var profileDrop = document.getElementById('profile-dropdown');
                var badge = document.getElementById('bell-badge');
                if (dropdown) {
                    if (dropdown.classList.contains('active-menu')) {
                        dropdown.classList.remove('active-menu');
                    } else {
                        if (profileDrop) profileDrop.classList.remove('active-menu');
                        renderNotificationsList();
                        dropdown.classList.add('active-menu');
                        if (badge) {
                            badge.innerText = '0';
                            badge.classList.add('hidden');
                        }
                    }
                }
            });
        }
        // Клик по профилю — toggle с анимацией
        var profileWrapper = document.getElementById('profile-wrapper');
        if (profileWrapper) {
            profileWrapper.addEventListener('click', function(e) {
                e.stopPropagation();
                // Если клик по кнопке внутри дропдауна — не трогаем, они закрывают меню сами
                if (e.target.closest('#drop-btn-profile, #drop-btn-settings, #drop-btn-logout')) {
                    return;
                }
                var notificationDrop = document.getElementById('notification-dropdown');
                var drop = document.getElementById('profile-dropdown');
                if (drop) {
                    if (drop.classList.contains('active-menu')) {
                        drop.classList.remove('active-menu');
                    } else {
                        if (notificationDrop) notificationDrop.classList.remove('active-menu');
                        drop.classList.add('active-menu');
                    }
                }
            });
        }
        // Закрытие обоих меню при клике вне
        document.addEventListener('click', function(e) {
            var notifDrop = document.getElementById('notification-dropdown');
            var bellWrap = document.getElementById('bell-wrapper');
            var profDrop = document.getElementById('profile-dropdown');
            var profWrap = document.getElementById('profile-wrapper');
            if (notifDrop && notifDrop.classList.contains('active-menu') && bellWrap && !bellWrap.contains(e.target)) {
                notifDrop.classList.remove('active-menu');
            }
            if (profDrop && profDrop.classList.contains('active-menu') && profWrap && !profWrap.contains(e.target)) {
                profDrop.classList.remove('active-menu');
            }
        });
        // Кнопки меню профиля
        var dropProfile = document.getElementById('drop-btn-profile');
        if (dropProfile) {
            dropProfile.addEventListener('click', function() {
                showPage('profilePage');
                var drop = document.getElementById('profile-dropdown');
                if (drop) drop.classList.remove('active-menu');
            });
        }
        var dropSettings = document.getElementById('drop-btn-settings');
        if (dropSettings) {
            dropSettings.addEventListener('click', function() {
                showPage('settingsPage');
                var drop = document.getElementById('profile-dropdown');
                if (drop) drop.classList.remove('active-menu');
            });
        }
        var dropLogout = document.getElementById('drop-btn-logout');
        if (dropLogout) {
            dropLogout.addEventListener('click', function() {
                logout();
            });
        }
        // Переключение вкладок в настройках
        document.querySelectorAll('.settings-tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.settings-tab-btn').forEach(function(b) {
                    b.style.background = 'none';
                    b.style.border = '1px solid transparent';
                    b.style.color = '#9ca3af';
                });
                this.style.background = 'rgba(139,92,246,0.1)';
                this.style.border = '1px solid #8b5cf6';
                this.style.color = '#fff';
                var target = this.getAttribute('data-target');
                document.querySelectorAll('.settings-pane').forEach(function(pane) {
                    pane.classList.add('hidden');
                });
                var targetPane = document.getElementById(target);
                if (targetPane) targetPane.classList.remove('hidden');
            });
        });
        // Сохранение настроек профиля (ник, био, аватар через Supabase Storage)
        var saveSettingsBtn = document.getElementById('saveProfileSettings');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', async function() {
                if (!currentUser) return;
                var nick = document.getElementById('settings-nickname').value.trim();
                var bio = document.getElementById('settings-bio').value.trim();
                if (!nick) { showToast('Никнейм не может быть пустым'); return; }
                var updateData = { nickname: nick };
                if (bio) updateData.bio = bio;
                // Загрузка аватара через файл
                var fileInput = document.getElementById('settings-avatar-file');
                if (fileInput && fileInput.files && fileInput.files[0]) {
                    var file = fileInput.files[0];
                    var ext = file.name.split('.').pop();
                    var filePath = currentUser.login + '_' + Date.now() + '.' + ext;
                    var { data: uploadData, error: uploadError } = await sb.storage.from('avatars').upload(filePath, file);
                    if (uploadError) {
                        showToast('Ошибка загрузки аватара: ' + uploadError.message);
                        return;
                    }
                    var { data: urlData } = sb.storage.from('avatars').getPublicUrl(filePath);
                    if (urlData) updateData.avatar_url = urlData.publicUrl;
                }
                var r = await sb.from('users').update(updateData).eq('id', currentUser.id).select();
                if (!r.error && r.data && r.data[0]) {
                    var oldLogin = currentUser.login;
                    var idx = users.findIndex(function(u) { return u.login === oldLogin; });
                    if (idx !== -1) users[idx] = r.data[0];
                    currentUser = r.data[0];
                    showToast('Настройки сохранены');
                    updateUI();
                    renderProfile();
                } else {
                    showToast('Ошибка сохранения');
                }
            });
        }
        // Смена пароля
        var updatePwdBtn = document.getElementById('updatePasswordBtn');
        if (updatePwdBtn) {
            updatePwdBtn.addEventListener('click', async function() {
                if (!currentUser) return;
                var curPwd = document.getElementById('settings-current-password').value;
                var newPwd = document.getElementById('settings-new-password').value;
                if (!curPwd || !newPwd) { showToast('Заполните оба поля пароля'); return; }
                if (newPwd.length < 6) { showToast('Новый пароль должен быть минимум 6 символов'); return; }
                // Проверяем текущий пароль
                var { data: checkData, error: checkError } = await sb.from('users').select('password').eq('id', currentUser.id).single();
                if (checkError || !checkData) { showToast('Ошибка проверки пароля'); return; }
                if (checkData.password !== curPwd) { showToast('Текущий пароль неверен'); return; }
                var { error: updateError } = await sb.from('users').update({ password: newPwd }).eq('id', currentUser.id);
                if (updateError) { showToast('Ошибка смены пароля'); return; }
                document.getElementById('settings-current-password').value = '';
                document.getElementById('settings-new-password').value = '';
                showToast('Пароль успешно изменён');
            });
        }

        // Admin tabs switcher
        var adminTabs = document.querySelector('.admin-tabs');
        if (adminTabs) {
            adminTabs.addEventListener('click', function(e) {
                var btn = e.target.closest('.admin-tab-btn');
                if (!btn) return;
                document.querySelectorAll('.admin-tab-btn').forEach(function(b) {
                    b.style.background = 'none';
                    b.style.borderColor = 'transparent';
                    b.style.color = '#9ca3af';
                });
                btn.style.background = 'rgba(139,92,246,0.1)';
                btn.style.borderColor = '#8b5cf6';
                btn.style.color = '#fff';
                document.querySelectorAll('[id^="admin-tab-"]').forEach(function(t) {
                    t.classList.add('hidden');
                });
                var target = document.getElementById(btn.dataset.target);
                if (target) target.classList.remove('hidden');
            });
        }

        // Admin users search
        var adminUsersSearch = document.getElementById('admin-users-search');
        if (adminUsersSearch) {
            adminUsersSearch.addEventListener('input', function() {
                window.adminCurrentUsersPage = 1;
                renderAdminUsersList(this.value);
            });
        }

        initApp();
    });

    window._sb = sb;
    window.addNewDealToFeedUI = addNewDealToFeedUI;
})();

/* ===== Глобальный канал deals (вне IIFE) ===== */
try {
    if (!window._dealsRealtimeGlobalInitialized) {
        window._dealsRealtimeGlobalInitialized = true;

        if (typeof window._sb !== 'undefined' && window._sb && typeof window._sb.channel === 'function') {
            window.myDealsChannel = window._sb
                .channel('global-deals-channel')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, function(payload) {
                    var isDuplicate = document.getElementById('deal-card-' + payload.new.id);
                    if (!isDuplicate) {
                        window.addNewDealToFeedUI(payload.new);
                    }
                })
                .subscribe(function(status) {
                    console.log('[Realtime] Глобальный канал статус:', status);
                });
        }
    }
} catch (e) {
    console.log("Ошибка инициализации каналов:", e);
}
