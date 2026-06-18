-- VioletGuard Database Schema
-- Выполните этот SQL-скрипт в SQL Editor панели Supabase

-- ========== ТАБЛИЦЫ ==========

-- Пользователи
CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    login TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    balance NUMERIC NOT NULL DEFAULT 0,
    banned BOOLEAN NOT NULL DEFAULT false,
    reg_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    total_deposit NUMERIC NOT NULL DEFAULT 0,
    total_withdraw NUMERIC NOT NULL DEFAULT 0,
    short_id TEXT UNIQUE,
    nickname TEXT,
    avatar_url TEXT,
    bio TEXT
);

-- Индекс для быстрого поиска по short_id
CREATE INDEX IF NOT EXISTS idx_users_short_id ON public.users(short_id);

-- Сделки
CREATE TABLE IF NOT EXISTS public.deals (
    id BIGSERIAL PRIMARY KEY,
    item TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    seller TEXT NOT NULL,
    buyer TEXT NOT NULL,
    code TEXT,
    status TEXT NOT NULL DEFAULT 'waiting_payment',
    is_fake BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Отзывы о сервисе (общие)
CREATE TABLE IF NOT EXISTS public.reviews (
    id BIGSERIAL PRIMARY KEY,
    user_login TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    text TEXT,
    date DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Рейтинги пользователей (после сделки — продавец/покупатель)
CREATE TABLE IF NOT EXISTS public.ratings (
    id BIGSERIAL PRIMARY KEY,
    deal_id BIGINT REFERENCES public.deals(id) ON DELETE CASCADE,
    from_user TEXT NOT NULL,
    to_user TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ачивки / достижения
CREATE TABLE IF NOT EXISTS public.achievements (
    id BIGSERIAL PRIMARY KEY,
    user_login TEXT NOT NULL,
    achievement_name TEXT NOT NULL,
    earned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Системная статистика (общее количество сделок и оборот)
CREATE TABLE IF NOT EXISTS public.system_stats (
    id INTEGER PRIMARY KEY DEFAULT 1,
    total_deals INTEGER NOT NULL DEFAULT 0,
    total_turnover NUMERIC NOT NULL DEFAULT 0,
    CONSTRAINT single_row CHECK (id = 1)
);

-- Сообщения чата сделки
CREATE TABLE IF NOT EXISTS public.deal_messages (
    id BIGSERIAL PRIMARY KEY,
    deal_id BIGINT NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp TEXT,
    system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Последние сделки (единая лента для всех пользователей)
CREATE TABLE IF NOT EXISTS public.recent_deals (
    id BIGSERIAL PRIMARY KEY,
    seller TEXT NOT NULL,
    buyer TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    item TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Тикеты поддержки
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id BIGSERIAL PRIMARY KEY,
    user_login TEXT NOT NULL,
    user_short_id TEXT,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);

-- Сообщения внутри тикетов поддержки
CREATE TABLE IF NOT EXISTS public.ticket_messages (
    id BIGSERIAL PRIMARY KEY,
    ticket_id BIGINT NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== ТАБЛИЦА НАСТРОЕК ПЛАТФОРМЫ (онлайн, etc) ==========
CREATE TABLE IF NOT EXISTS public.platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT INTO public.platform_settings (key, value) VALUES ('online_counter', '300') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value) VALUES ('online_counter_updated', NOW()::text) ON CONFLICT DO NOTHING;

-- ========== ВКЛЮЧЕНИЕ REALTIME ДЛЯ ТАБЛИЦ ==========
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.deal_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_settings;

-- ========== ОТКЛЮЧЕНИЕ RLS (управление доступом на стороне приложения) ==========
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_stats DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages DISABLE ROW LEVEL SECURITY;

-- ========== НАЧАЛЬНЫЕ ДАННЫЕ (SEED) ==========

-- Мастер-админ
INSERT INTO public.users (login, password, role) VALUES
('violet_admin', 'admin2025', 'admin')
ON CONFLICT (login) DO NOTHING;

-- Системная статистика (изначально 0)
INSERT INTO public.system_stats (id, total_deals, total_turnover) VALUES (1, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Демо-сделка
INSERT INTO public.deals (item, amount, seller, buyer, code, status) VALUES
('CS2 Knife', 24500, 'Demo', 'User', '441289', 'completed');

-- Демо-отзывы (10 штук)
INSERT INTO public.reviews (user_login, rating, text, date) VALUES
('Алексей_Трейдер', 5, 'Лучший сервис!', CURRENT_DATE - INTERVAL '10 months'),
('Elena_Crypto', 5, 'Надёжно, пользуюсь год', CURRENT_DATE - INTERVAL '9 months'),
('SkinMaster77', 5, 'Отлично, рекомендую', CURRENT_DATE - INTERVAL '8 months'),
('GoldTrader2024', 5, 'Профессионально', CURRENT_DATE - INTERVAL '7 months'),
('DiamondHands', 5, 'Безопасно', CURRENT_DATE - INTERVAL '6 months'),
('VioletAddict', 5, 'Красивый интерфейс', CURRENT_DATE - INTERVAL '5 months'),
('CryptoGuru', 5, 'Быстро', CURRENT_DATE - INTERVAL '4 months'),
('KingOfDeals', 5, 'Чётко', CURRENT_DATE - INTERVAL '3 months'),
('VioletLover', 5, 'Лучший', CURRENT_DATE - INTERVAL '2 months'),
('VioletGuardian', 5, 'Топ', CURRENT_DATE - INTERVAL '1 month'),
-- 6 именных отзывов авторитетных трейдеров
('zeiten', 4, 'Сделка прошла успешно, но продавец долго не выходил на связь. К гаранту претензий нет, холдирование работает четко. 4 звезды.', CURRENT_DATE - INTERVAL '14 days'),
('Monter', 5, 'Лучший гарант в СНГ сегменте, комиссии минимальные.', CURRENT_DATE - INTERVAL '13 days'),
('milawka38', 4, 'Сначала залагало пополнение через СБП, испугалась. Но поддержка ответила за 30 секунд и всё зачислила вручную! Сервис надёжный, но за лаг ставлю 4 звезды.', CURRENT_DATE - INTERVAL '12 days'),
('777', 5, 'Работаю тут на постоянной основе, холдирование работает честно.', CURRENT_DATE - INTERVAL '11 days'),
('Imprezza', 4, 'Дизайн топ, сделки безопасные. Была задержка на выводе крупных средств, пришлось пообщаться с арбитром. В итоге всё вывели. 4 звезды за ожидание, к безопасности вопросов нет.', CURRENT_DATE - INTERVAL '10 days'),
('HeDViN', 3, 'Долго не мог пройти верификацию почты, выдавало ошибку. Оператор в тикетах помог решить проблему. Сами сделки проходят отлично, ставлю 3 звезды чисто из-за багов с регистрацией.', CURRENT_DATE - INTERVAL '9 days'),
('User#834195', 4, 'Ошибся в реквизитах при выводе, транзакция зависла. Пришлось писать в поддержку. Ответили минут через 10, деньги вернули на баланс. Ставлю 4 звезды за долгий ответ.', CURRENT_DATE - INTERVAL '8 days'),
('User#294105', 3, 'Интерфейс красивый, но на мобилке кнопка создания сделки сначала не нажималась. Перезагрузил страницу — заработало. 3 звезды за баги, но саппорт пообещал исправить.', CURRENT_DATE - INTERVAL '7 days'),
('User#573921', 4, 'Проводил обмен крипты. Курс немного скаканул пока сделка висела в эскроу. В итоге все завершили, но осадочек остался. 4 звезды.', CURRENT_DATE - INTERVAL '6 days');
