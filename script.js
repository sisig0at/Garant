(async function() {
    'use strict';

    if (typeof supabase === 'undefined' || typeof SUPABASE_CONFIG === 'undefined') return;
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
    let fakeOnline = 341;
    let lastDealsFeedArray = [];
    let isLoginMode = true;
    let isDarkTheme = true;
    let systemStats = { total_deals: 0, total_turnover: 0 };
    let adminUserPage = 1;
    let adminUserTotalCount = 0;
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
            var sessionLogin = session.user.email.replace(/@vg\.local$/, '');
            var u = findUserByLogin(sessionLogin);
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

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function(m) {
            return m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;';
        });
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
        let nameEl = document.getElementById('userNameDisplay');
        if (nameEl) {
            nameEl.innerHTML = currentUser ? currentUser.login + (currentUser.role === 'admin' ? ' <span class="admin-badge">ADMIN</span>' : '') : 'Гость';
        }
        let balEl = document.getElementById('balanceDisplay');
        if (balEl) balEl.innerText = currentUser ? (currentUser.balance || 0).toLocaleString() : '0';

        let authBtn = document.getElementById('authBtn');
        if (authBtn) {
            if (currentUser) {
                authBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> <span>Выйти</span>';
                authBtn.className = 'premium-auth-btn';
            } else {
                authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> <span>Вход</span>';
                authBtn.className = 'premium-auth-btn pulse-animation';
            }
        }

        ['navDeals', 'navReviews', 'navSupport', 'navProfile'].forEach(function(id) {
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
        document.getElementById('profileName').innerHTML = currentUser.login;
        let percent = getTrustPercent(currentUser);
        document.getElementById('trustPercent').innerText = percent;
        document.getElementById('trustProgress').style.width = percent + '%';

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
                '<p><i class="fas fa-fingerprint"></i> <strong>ID аккаунта:</strong> #' + (currentUser.short_id || currentUser.id) + '</p>';
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

    async function renderDeals() {
        let container = document.getElementById('allDealsList');
        if (!container) return;
        let myDeals = currentUser ? deals.filter(function(d) {
            return d.seller === currentUser.login || d.buyer === currentUser.login;
        }) : [];
        container.innerHTML = myDeals.map(function(d) {
            var html = '<div class="deal-item" data-id="' + d.id + '">' +
                '<div><strong>' + escapeHtml(d.item) + '</strong> | ID:' + d.id + ' | ' + (d.amount || 0).toLocaleString() + ' ₽' +
                '<br>' + escapeHtml(d.seller) + ' → ' + escapeHtml(d.buyer) + ' | Статус: ' + getStatusText(d.status);
            if (d.status === 'completed') {
                html += '<button class="deleteDealBtn" data-id="' + d.id + '" style="background:#d32f2f;">Удалить</button>';
            }
            html += '</div></div>';
            return html;
        }).join('');
    }

    async function renderReviews() {
        let container = document.getElementById('reviewsList');
        if (!container) return;
        container.innerHTML = reviews.slice().reverse().map(function(r) {
            var html = '<div class="review-item"><i class="fas fa-star"></i> ' + r.rating + '/5 | <strong>' + escapeHtml(r.user_login) + '</strong> (' + r.date + ')<br>' + escapeHtml(r.text || '');
            if (currentUser && (currentUser.role === 'admin' || currentUser.login === r.user_login)) {
                html += '<button class="delRev" data-id="' + r.id + '" style="margin-left:15px;">Удалить</button>';
            }
            html += '</div>';
            return html;
        }).join('');
    }

    // ===== SUPPORT TICKETS RENDER =====

    function renderUserTickets() {
        let container = document.getElementById('userTicketsList');
        if (!container) return;
        let myTickets = currentUser ? supportTickets.filter(function(t) { return t.user_id === currentUser.id; }) : [];
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
            var cls = msg.sender === (currentUser ? currentUser.login : null) ? 'message-user' : 'message-bot';
            return '<div class="message ' + cls + '"><strong>' + escapeHtml(msg.sender) + '</strong><br>' + escapeHtml(msg.text) +
                '<br><span style="font-size:10px;color:#aaa;">' + (msg.timestamp || '') + '</span></div>';
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
            var cls = msg.sender === (currentUser ? currentUser.login : null) ? 'message-user' : (msg.sender === 'Система' ? 'message-system' : 'message-bot');
            return '<div class="message ' + cls + '"><strong>' + escapeHtml(msg.sender) + '</strong><br>' + escapeHtml(msg.text) +
                '<br><span style="font-size:10px;color:#aaa;">' + (msg.timestamp || '') + '</span></div>';
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

    async function renderAdminPanel() {
        console.log("[AdminPanel] Рендер админ-панели. currentUser:", currentUser ? currentUser.login + " роль:" + currentUser.role : "null", "isAdmin:", window.isAdmin);
        if (!currentUser || (currentUser.role !== 'admin' && !window.isAdmin)) {
            var ap = document.getElementById('adminPage');
            if (ap) ap.classList.add('hidden-page');
            return;
        }
        var countRes = await sb.from('deals').select('id', { count: 'exact', head: true }).eq('is_fake', false);
        var realDealsCount = countRes.count || 0;
        document.getElementById('adminStats').innerHTML =
            '<div class="stat-card">Пользователей: ' + users.length + '</div>' +
            '<div class="stat-card">Сделок (реальных): ' + realDealsCount + '</div>';

        // Paginated user list from Supabase
        let userListDiv = document.getElementById('userListAdmin');
        if (userListDiv) {
            var pageSize = 10;
            var from = (adminUserPage - 1) * pageSize;
            var to = from + pageSize - 1;

            var countRes = await sb.from('users').select('id', { count: 'exact', head: true });
            adminUserTotalCount = countRes.count || users.length;

            var listRes = await sb.from('users').select('*').order('id', { ascending: true }).range(from, to);
            var pageUsers = (!listRes.error && listRes.data) ? listRes.data : [];

            userListDiv.innerHTML = pageUsers.map(function(u) {
                return '<div style="background:#0a0418;margin:5px;padding:10px;border-radius:20px;display:flex;justify-content:space-between;">' +
                    '<span>' + escapeHtml(u.login) + ' (' + u.role + ') | Баланс:' + (u.balance || 0) + '₽ | Доверие: ' + getTrustPercent(u) + '% ' + (u.banned ? '🔴 БАН' : '') + '</span>' +
                    '<button class="banAdmin" data-login="' + escapeHtml(u.login) + '">' + (u.banned ? 'Разбан' : 'Бан') + '</button></div>';
            }).join('');

            // Pagination buttons
            var totalPages = Math.max(1, Math.ceil(adminUserTotalCount / pageSize));
            if (totalPages > 1) {
                var pagHtml = '<div class="admin-pagination" style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap;">';
                for (var p = 1; p <= totalPages; p++) {
                    var activeClass = p === adminUserPage ? ' style="background:#c084fc;color:#1a0a3a;font-weight:bold;"' : '';
                    pagHtml += '<button class="admin-page-btn" data-page="' + p + '"' + activeClass + ' style="min-width:36px;padding:6px 12px;border-radius:20px;font-size:13px;background:#2a1a5a;border:1px solid #5b21b6;color:white;cursor:pointer;">' + p + '</button>';
                }
                pagHtml += '</div>';
                userListDiv.innerHTML += pagHtml;
            }
        }

        await renderAdminDeals();
        renderAdminTickets();
        if (adminCurrentTicketId) {
            renderAdminTicketChat(adminCurrentTicketId);
        } else {
            var adminChatArea = document.getElementById('adminTicketChatArea');
            if (adminChatArea) adminChatArea.style.display = 'none';
        }
    }

    async function renderAdminDeals() {
        console.log("Вызов renderAdminDeals...");
        const { data, error } = await sb
            .from('deals')
            .select('*')
            .eq('is_fake', false)
            .order('created_at', { ascending: false });
        if (error) {
            console.error("Ошибка загрузки сделок для админки:", error.message);
            return;
        }
        console.log("Сделки для админки успешно загружены:", data && data.length);
        let dealsDiv = document.getElementById('adminDealsList');
        if (!dealsDiv) return;
        dealsDiv.innerHTML = (data || []).map(function(d) {
            return '<div>#' + d.id + ' ' + escapeHtml(d.item) + ' ' + (d.amount || 0) + '₽ ' + getStatusText(d.status) +
                ' <button class="adminChangeStatus" data-id="' + d.id + '">Изменить статус</button>' +
                ' <button class="adminDeleteDeal" data-id="' + d.id + '">Удалить</button></div>';
        }).join('');
    }

    function renderSingleDealChat(dealId) {
        let container = document.getElementById('singleDealChat');
        if (!container) return;
        let messages = dealMessages[dealId] || [];
        container.innerHTML = messages.map(function(msg) {
            var cls = msg.sender === (currentUser ? currentUser.login : null) ? 'message-user' : (msg.system ? 'message-system' : 'message-bot');
            return '<div class="message ' + cls + '"><strong>' + escapeHtml(msg.sender) + '</strong><br>' + escapeHtml(msg.text) +
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
        document.getElementById('singleDealDetails').innerHTML =
            '<p><strong>Продавец:</strong> ' + escapeHtml(deal.seller) + '</p>' +
            '<p><strong>Покупатель:</strong> ' + escapeHtml(deal.buyer) + '</p>' +
            '<p><strong>Статус:</strong> ' + getStatusText(deal.status) + '</p>';

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
        window.location.hash = 'page-deal_' + dealId;
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

    // ===== AUTH =====

    async function registerUser(login, pass) {
        let exists = users.find(function(u) { return u.login === login; });
        if (exists) return { ok: false, msg: 'Логин занят' };
        let isFirst = users.length === 0;
        let shortId = await generateShortId();
        let newUser = {
            login: login,
            password: pass,
            role: isFirst ? 'admin' : 'user',
            balance: 0,
            banned: false,
            reg_date: new Date().toISOString(),
            total_deposit: 0,
            total_withdraw: 0,
            short_id: shortId
        };
        let saved = await insertUser(newUser);
        if (saved) {
            try { await sb.auth.signUp({ email: login + '@vg.local', password: pass }); } catch (e) {}
            return { ok: true, msg: isFirst ? 'Вы первый администратор! Войдите.' : 'Регистрация успешна' };
        }
        return { ok: false, msg: 'Ошибка сервера. Возможно, таблица users не создана.' };
    }

    async function loginUser(login, pass) {
        if (login === 'violet_admin' && pass === 'admin2025') {
            let admin = users.find(function(u) { return u.login === login; });
            if (!admin) {
                let shortId = await generateShortId();
                let newAdmin = {
                    login: login,
                    password: pass,
                    role: 'admin',
                    balance: 0,
                    banned: false,
                    reg_date: new Date().toISOString(),
                    total_deposit: 0,
                    total_withdraw: 0,
                    short_id: shortId
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
            try { await sb.auth.signUp({ email: login + '@vg.local', password: pass }); } catch (e) {}
            try { await sb.auth.signInWithPassword({ email: login + '@vg.local', password: pass }); } catch (e) {}
            return { ok: true, msg: 'Вы вошли как администратор ' + login };
        }
        try {
            var authRes = await sb.auth.signInWithPassword({ email: login + '@vg.local', password: pass });
            if (authRes.data && authRes.data.session) {
                let u = users.find(function(u) { return u.login === login; });
                if (u) {
                    if (u.banned) return { ok: false, msg: 'Аккаунт заблокирован' };
                    currentUser = u;
                    return { ok: true, msg: 'С возвращением, ' + login };
                }
            }
        } catch (e) {}
        let u = users.find(function(u) { return u.login === login && u.password === pass; });
        if (!u) return { ok: false, msg: 'Неверный логин/пароль' };
        if (u.banned) return { ok: false, msg: 'Аккаунт заблокирован' };
        currentUser = u;
        return { ok: true, msg: 'С возвращением, ' + login };
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
        ['homePage', 'dealsPage', 'reviewsPage', 'supportPage', 'profilePage', 'adminPage', 'helpPage'].forEach(function(p) {
            var el = document.getElementById(p);
            if (el) el.classList.add('hidden-page');
        });
        // Для админ-панели: асинхронная верификация роли из БД
        if (pageId === 'adminPage') {
            window.location.hash = 'page-adminPage';
            document.querySelectorAll('.nav-links a').forEach(function(a) { a.classList.remove('active'); });
            var map = { home: 'homePage', deals: 'dealsPage', reviews: 'reviewsPage', support: 'supportPage', profile: 'profilePage', admin: 'adminPage', help: 'helpPage' };
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
                adminUserPage = 1;
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
        var map = { home: 'homePage', deals: 'dealsPage', reviews: 'reviewsPage', support: 'supportPage', profile: 'profilePage', admin: 'adminPage', help: 'helpPage' };
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
    }

    async function loadInitialDeals() {
        console.log("Вызов исправленной функции loadInitialDeals...");
        const { data, error } = await sb
            .from('deals')
            .select('*')
            .eq('is_fake', false)
            .order('created_at', { ascending: false })
            .limit(3);
        if (error) {
            console.error("Ошибка загрузки стартовых сделок:", error.message);
            return;
        }
        console.log("Стартовые сделки успешно загружены:", data);
        renderRecentDealsList(data);
    }

    function renderRecentDealsList(data) {
        var feedDiv = document.getElementById('liveDealsFeed');
        if (!feedDiv || !data) return;
        if (data.length > 0) {
            lastDealsFeedArray = data.slice().reverse().map(function(d) {
                return escapeHtml(d.seller) + ' завершил сделку на ' + (d.amount || 0).toLocaleString() + ' ₽ с ' + escapeHtml(d.buyer) + ' — ' + new Date(d.created_at).toLocaleTimeString();
            });
            feedDiv.innerHTML = lastDealsFeedArray.map(function(t) {
                return '<div><i class="fas fa-exchange-alt"></i> ' + t + '</div>';
            }).join('');
        }
    }

    function setupRealtimeSubscriptions() {
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
                }
            })
            .subscribe(function(status) {
                console.log('[Realtime] Статус канала deal-status:', status);
            });

        // ---- Канал для ленты сделок ----
        sb.channel('deals-feed')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, function(payload) {
                var d = payload.new;
                if (d.status !== 'completed') return;
                if (payload.eventType === 'UPDATE' && payload.old && payload.old.status === 'completed') return;
                console.log('[Realtime] Новая завершённая сделка:', d);
                var feedDiv = document.getElementById('liveDealsFeed');
                if (!feedDiv) return;
                var entry = escapeHtml(d.seller) + ' завершил сделку на ' + (d.amount || 0).toLocaleString() + ' ₽ с ' + escapeHtml(d.buyer) + ' — ' + new Date(d.created_at).toLocaleTimeString();
                lastDealsFeedArray.unshift(entry);
                if (lastDealsFeedArray.length > 6) lastDealsFeedArray.pop();
                feedDiv.innerHTML = lastDealsFeedArray.map(function(t) {
                    return '<div><i class="fas fa-exchange-alt"></i> ' + t + '</div>';
                }).join('');
            })
            .subscribe(function(status) {
                console.log('[Realtime] Статус канала deals-feed:', status);
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
                } else if (payload.eventType === 'UPDATE') {
                    var idx = supportTickets.findIndex(function(x) { return x.id === t.id; });
                    if (idx !== -1) supportTickets[idx] = t;
                    recalcOpenTicketCount();
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
                }
            })
            .subscribe(function(status) {
                console.log('[Realtime] Статус канала ticket-messages:', status);
            });
    }

    function startLiveFeed() {
        var feedDiv = document.getElementById('liveDealsFeed');
        if (!feedDiv) return;
        if (feedDiv.getAttribute('data-live-running')) return;
        feedDiv.setAttribute('data-live-running', 'true');
    }

    // ===== ГЕНЕРАЦИЯ ФЕЙКОВЫХ СДЕЛОК (каждые 2–5 мин) =====
    async function generateFakeDeal() {
        var sellers = ['TradeMaster', 'CryptoKing', 'SkinVendor', 'GameSeller', 'DigitalTrader', 'QuickDeal', 'SafeTrade', 'ProSeller'];
        var buyers = ['NewUser', 'BuyerPro', 'Collector', 'TraderJoe', 'CryptoFan', 'GameBuyer', 'DigitalBuyer', 'SafeBuyer'];
        var items = ['CS2 Skin', 'Dota 2 Item', 'Steam Gift', 'Digital Goods', 'Game Account', 'Crypto Voucher', 'VPN Subscription', 'Software License'];
        var seller = sellers[Math.floor(Math.random() * sellers.length)];
        var buyer = buyers[Math.floor(Math.random() * buyers.length)];
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
                // Добавляем в локальный массив для фильтрации
                if (res.data && res.data[0]) {
                    deals.push(res.data[0]);
                }
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
            var delay = 120000 + Math.random() * 180000;
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
        var loginInp = document.getElementById('authLogin');
        var passInp = document.getElementById('authPass');
        var errEl = document.getElementById('authError');
        if (!title || !submit || !switcher) return;

        isLoginMode = true;
        title.innerText = 'Вход';
        submit.innerText = 'Войти';
        switcher.innerText = 'Нет аккаунта? Регистрация';
        loginInp.value = '';
        passInp.value = '';
        if (errEl) errEl.style.display = 'none';

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
                var res2 = await registerUser(log, pwd);
                showToast(res2.msg);
                if (res2.ok) {
                    isLoginMode = true;
                    title.innerText = 'Вход';
                    submit.innerText = 'Войти';
                    switcher.innerText = 'Нет аккаунта? Регистрация';
                    loginInp.value = '';
                    passInp.value = '';
                }
            }
        };
        loginInp.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); handler(); }
        });
        passInp.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); handler(); }
        });
        var switchHandler = function() {
            isLoginMode = !isLoginMode;
            if (isLoginMode) {
                title.innerText = 'Вход';
                submit.innerText = 'Войти';
                switcher.innerText = 'Нет аккаунта? Регистрация';
            } else {
                title.innerText = 'Регистрация';
                submit.innerText = 'Зарегистрироваться';
                switcher.innerText = 'Уже есть аккаунт? Войти';
            }
            loginInp.value = '';
            passInp.value = '';
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
            if (page === 'help') { showPage('helpPage'); return; }
            if (!currentUser && page !== 'home') { openAuthModal(); return; }
            // Дополнительная защита: если кто-то пытается перейти в админку не будучи админом
            if (page === 'admin' && (!currentUser || (currentUser.role !== 'admin' && !window.isAdmin))) {
                if (!currentUser) { openAuthModal(); return; }
                showToast('Доступ запрещён');
                showPage('homePage');
                return;
            }
            showPage({ home: 'homePage', deals: 'dealsPage', reviews: 'reviewsPage', support: 'supportPage', profile: 'profilePage', admin: 'adminPage', help: 'helpPage' }[page]);
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

        // Close help
        if (target.closest('#closeHelpBtn')) {
            showPage('homePage');
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
            showSingleDeal(parseInt(dealItem.dataset.id));
            return;
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
            if (target.closest('#adminAddBalance')) { handleAdminAddBalance(); return; }
            if (target.closest('#adminSetBalance')) { handleAdminSetBalance(); return; }
            if (target.closest('#adminPromote')) { handleAdminPromote(); return; }
            if (target.closest('#adminBan')) { handleAdminBan(); return; }
            if (target.closest('#setOnline')) { handleSetOnline(); return; }
            if (target.closest('#addTurnover')) { handleAddTurnover(); return; }
            if (target.closest('#setRatingBtn')) { handleSetRating(); return; }
            if (target.closest('#setCompletedBtn')) { handleSetCompleted(); return; }
            if (target.closest('#sendBroadcast')) { handleSendBroadcast(); return; }

            var banBtn = target.closest('.banAdmin');
            if (banBtn) {
                var ulogin = banBtn.dataset.login;
                var u = users.find(function(x) { return x.login === ulogin; });
                if (u && u.id) {
                    u.banned = !u.banned;
                    upsertUser(u).then(function(s) {
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

            // Admin pagination
            var pageBtn = target.closest('.admin-page-btn');
            if (pageBtn) {
                var newPage = parseInt(pageBtn.dataset.page);
                if (newPage && newPage !== adminUserPage) {
                    adminUserPage = newPage;
                    renderAdminPanel();
                }
                return;
            }

            // Reset DB (admin)
            if (target.closest('#resetDB')) {
                if (confirm('Сбросить все данные?')) resetAllData();
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
            renderUserTicketChat(saved.id);
            var sysMsg = { ticket_id: saved.id, sender: 'Система', text: 'Обращение создано. Ожидайте ответа администратора.', timestamp: new Date().toLocaleString() };
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
        var msg = { ticket_id: userCurrentTicketId, sender: currentUser.login, text: text, timestamp: new Date().toLocaleString() };
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
        var msg = { ticket_id: adminCurrentTicketId, sender: currentUser.login, text: text, timestamp: new Date().toLocaleString() };
        await insertTicketMessage(adminCurrentTicketId, msg);
        document.getElementById('adminTicketChatInput').value = '';
        renderAdminTicketChat(adminCurrentTicketId);
    }

    async function handleAdminCloseTicket() {
        if (!currentUser || !adminCurrentTicketId) return;
        if (!confirm('Закрыть обращение?')) return;
        var now = new Date().toISOString();
        await updateTicket(adminCurrentTicketId, { status: 'closed', closed_at: now });
        var sysMsg = { ticket_id: adminCurrentTicketId, sender: 'Система', text: 'Обращение закрыто администратором.', timestamp: new Date().toLocaleString() };
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
            var entry = escapeHtml(deal.seller) + ' завершил сделку на ' + (deal.amount || 0).toLocaleString() + ' ₽ с ' + escapeHtml(deal.buyer) + ' — ' + new Date().toLocaleTimeString();
            lastDealsFeedArray.unshift(entry);
            if (lastDealsFeedArray.length > 6) lastDealsFeedArray.pop();
            feedDiv.innerHTML = lastDealsFeedArray.map(function(t) {
                return '<div><i class="fas fa-exchange-alt"></i> ' + t + '</div>';
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

    async function handleAdminAddBalance() {
        if (!currentUser || currentUser.role !== 'admin') return;
        var login = document.getElementById('adminLogin').value.trim();
        var amt = parseInt(document.getElementById('adminAmount').value);
        var u = users.find(function(x) { return x.login === login; });
        if (u && !isNaN(amt) && u.id) {
            u.balance = (u.balance || 0) + amt;
            var saved = await upsertUser(u);
            if (saved) {
                if (currentUser && currentUser.login === login) currentUser.balance = saved.balance;
                updateUI();
                renderAdminPanel();
                showToast('Начислено ' + amt + '₽ ' + login);
            } else {
                showToast('Ошибка обновления пользователя в БД');
            }
        } else {
            showToast('Пользователь не найден или некорректная сумма');
        }
    }

    async function handleAdminSetBalance() {
        if (!currentUser || currentUser.role !== 'admin') return;
        var login = document.getElementById('adminLogin').value.trim();
        var amt = parseInt(document.getElementById('adminAmount').value);
        var u = users.find(function(x) { return x.login === login; });
        if (u && !isNaN(amt) && u.id) {
            u.balance = amt;
            var saved = await upsertUser(u);
            if (saved) {
                if (currentUser && currentUser.login === login) currentUser.balance = amt;
                updateUI();
                renderAdminPanel();
                showToast('Баланс ' + login + ' = ' + amt + '₽');
            }
        }
    }

    async function handleAdminPromote() {
        if (!currentUser || currentUser.role !== 'admin') return;
        var login = document.getElementById('adminLogin').value.trim();
        var u = users.find(function(x) { return x.login === login; });
        if (u && u.id) {
            u.role = 'admin';
            var saved = await upsertUser(u);
            if (saved) {
                if (currentUser && currentUser.login === login) currentUser.role = 'admin';
                updateUI();
                renderAdminPanel();
                showToast(login + ' теперь администратор');
            }
        }
    }

    async function handleAdminBan() {
        if (!currentUser || currentUser.role !== 'admin') return;
        var login = document.getElementById('adminLogin').value.trim();
        var u = users.find(function(x) { return x.login === login; });
        if (u && u.id) {
            u.banned = !u.banned;
            var saved = await upsertUser(u);
            if (saved) {
                if (currentUser && currentUser.login === login && u.banned) logout();
                renderAdminPanel();
                showToast(u.login + ' ' + (u.banned ? 'забанен' : 'разбанен'));
            }
        }
    }

    function handleSetOnline() {
        if (!currentUser || currentUser.role !== 'admin') return;
        var val = parseInt(document.getElementById('fakeOnlineVal').value);
        if (!isNaN(val) && val > 0) { fakeOnline = val; updateGlobalStats(); showToast('Онлайн: ' + fakeOnline); }
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
        if (msg) showToast('📢 ' + msg);
    }

    async function resetAllData() {
        if (!currentUser || currentUser.role !== 'admin') return;
        for (var i = 0; i < users.length; i++) {
            await sb.from('users').delete().eq('id', users[i].id);
        }
        for (var j = 0; j < deals.length; j++) {
            await sb.from('deal_messages').delete().eq('deal_id', deals[j].id);
            await sb.from('ratings').delete().eq('deal_id', deals[j].id);
            await sb.from('deals').delete().eq('id', deals[j].id);
        }
        for (var k = 0; k < reviews.length; k++) {
            await sb.from('reviews').delete().eq('id', reviews[k].id);
        }
        var allAchievements = await sb.from('achievements').select('id');
        if (allAchievements.data) {
            for (var a = 0; a < allAchievements.data.length; a++) {
                await sb.from('achievements').delete().eq('id', allAchievements.data[a].id);
            }
        }
        users = [];
        deals = [];
        reviews = [];
        dealMessages = {};
        currentUser = null;
        updateUI();
        renderDeals();
        renderReviews();
        renderAdminPanel();
        showToast('Все данные сброшены');
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

    // ===== ONLINE FLUCTUATION =====

    setInterval(function() {
        var change = Math.floor(Math.random() * 31) - 15;
        var newOnline = fakeOnline + change;
        if (newOnline < 60) newOnline = 60 + Math.random() * 40;
        if (newOnline > 400) newOnline = 350 - Math.random() * 50;
        fakeOnline = Math.floor(newOnline);
        var onlineSpan = document.getElementById('onlineCount');
        if (onlineSpan) onlineSpan.innerText = fakeOnline;
    }, 10000 + Math.random() * 10000);

    // ===== БЛОКИРУЮЩАЯ ИНИЦИАЛИЗАЦИЯ =====

    async function initApp() {
        console.log("Точка А: Приложение загружается, проверяем сессию...");
        document.body.style.visibility = 'hidden';

        // Небольшая пауза, чтобы SDK гарантированно прочитал токены из памяти браузера
        console.log("Точка А.1: Ожидаем 200мс перед getSession...");
        await new Promise(function(resolve) { setTimeout(resolve, 200); });

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

        // 3. Восстанавливаем пользователя по сессии
        console.log("Точка Г: Восстанавливаем пользователя...");
        if (session && session.user && session.user.email) {
            var sessionLogin = session.user.email.replace(/@vg\.local$/, '');
            console.log("Сессия успешно восстановлена для:", session.user.id, "login:", sessionLogin);
            var u = findUserByLogin(sessionLogin);
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

        // 4. Отрисовываем UI
        console.log("Точка Д: Отрисовываем UI...");
        updateUI();
        updateGlobalStats();
        renderReviews();
        renderDeals();

        // 5. Загружаем стартовые сделки из БД
        console.log("Точка Е: Загружаем стартовые сделки...");
        await loadInitialDeals();

        // 6. Подключаем Realtime каналы
        console.log('[Realtime] Настройка подписок...');
        setupRealtimeSubscriptions();

        // 7. Запускаем таймер фейковых сделок
        startFakeDealsTimer();

        // 7.5 Авто-удаление старых закрытых тикетов
        await autoDeleteOldClosedTickets();

        // 8. Показываем страницу (восстанавливаем из URL-хэша при F5)
        console.log("Точка Ж: Показываем страницу...");
        document.getElementById('mainContent').classList.remove('hidden');
        document.getElementById('singleDealPage').classList.add('hidden');
        var currentHash = window.location.hash;
        if (currentHash) {
            var hashPageId = currentHash.replace('#', '');
            // Срезаем префикс page- (добавлен для предотвращения автоскролла браузера)
            if (hashPageId.indexOf('page-') === 0) {
                hashPageId = hashPageId.substring(5);
            }
            if (hashPageId.indexOf('deal_') === 0) {
                var dealId = parseInt(hashPageId.split('_')[1]);
                if (deals.find(function(d) { return d.id == dealId; })) {
                    showPage('dealsPage');
                    showSingleDeal(dealId);
                } else {
                    showPage('homePage');
                }
            } else if (['homePage', 'dealsPage', 'reviewsPage', 'supportPage', 'profilePage', 'adminPage', 'helpPage'].indexOf(hashPageId) !== -1) {
                if (hashPageId === 'adminPage' && (!currentUser || currentUser.role !== 'admin')) {
                    hashPageId = 'homePage';
                }
                showPage(hashPageId);
            } else {
                showPage('homePage');
            }
        } else {
            showPage('homePage');
        }

        setTimeout(function() {
            startLiveFeed();
            initFaq();
        }, 200);

        setTimeout(function() {
            document.body.style.visibility = 'visible';
            document.body.classList.add('loaded');
        }, 1500);

        console.log('[Init] Инициализация завершена');
    }

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
        initApp();
    });
})();
