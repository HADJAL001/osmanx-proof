# R1: ограничения безопасности и запуск в Интернет

**Этот релиз не разрешено считать production-ready.** Ниже указан текущий контроль и блокеры перед любым публичным запуском.

## Что реализовано

- Пароли хэшируются с индивидуальной солью (`scrypt`); сырой пароль не хранится.
- Токен сессии хранится в БД только в SHA-256 виде. Cookie `HttpOnly`, `SameSite=Lax` и `Secure` в production.
- На изменяющих действиях проверяется CSRF-токен и заголовок Origin; у HTML-форм обязателен JSON content type.
- Организационная изоляция: роли owner/editor/viewer, запрет чтения и записи без membership.
- Prepared statements для SQL и HTML-escaping для выведенных пользовательских строк.
- Webhook принимает только валидный HMAC с временем подписи в окне 5 минут; event ID имеет уникальное ограничение и сверку digest.
- Операции оплаты/возврата/партнерских начислений атомарны и фиксируются в журнале.
- Возврат сверх фактически полученного платежа отклоняется.
- Предупреждение о совпадении сети регистрации сохраняется как сигнал ручной проверки — само по себе не доказывает мошенничество.
- Режим sandbox запрещён при `NODE_ENV=production`; интерфейс явно показывает тестовый характер операций.

## Блокеры к production

1. Сменить экспериментальный `node:sqlite` на PostgreSQL с миграциями, резервными копиями, проверкой восстановления и tenant isolation.
2. Ввести подтверждение почты, восстановление аккаунта и парольной политики, обязательную MFA для администраторов.
3. Перенести rate limiting на Redis/edge WAF и добавить защиту от подбора паролей и массовых фейковых аккаунтов.
4. Настроить TLS, HSTS, `APP_ORIGIN`, безопасную конфигурацию proxy, секреты в secret manager и отдельные ключи среды.
5. Подключить реальный эквайринг: проверять нативные провайдерские подписи, сверять состояния settlement с выписками, обрабатывать retries и clock skew.
6. Подключить разрешённый payout provider только после юридической и налоговой проверки вознаграждений. Никогда не обещать моментальную выплату.
7. Добавить мониторинг, alerting, SLA, аудит доступа, tamper-evident snapshots вне БД.
8. Довести privacy: сроки хранения IP-хэшей, законное основание их обработки, deletion/export requests, consent logging и применимые требования GDPR/152-ФЗ.
9. Разработать оферту и пользовательскую процедуру отказа от подписки/возвратов. Уточнить налоговый режим и допустимую образовательную деятельность.
10. Пройти настоящий браузерный E2E с real backend в десктопном и мобильном браузерах, нагрузочные тесты и независимый пентест.

## Неочевидные ограничения

- Подписанный внутренний webhook — не доказательство оплаты, пока внешний адаптер не подтвердил событие у поставщика платежа.
- Hash-chain внутри той же БД не делает её юридически неизменяемой.
- Совпадение IP может означать семью, офис или мобильного провайдера; нельзя автоматически признавать его доказательством мошенничества.
- PDF создаётся через системную печать браузера; сервер не генерирует подписанный юридический документ.
- Нет настоящего email delivery. Приглашения вручную передаются пользователем по одноразовому токену.

---

# R2 security additions

- A quote approval link is a bearer credential, valid for 14 days until consumed, superseded or invalidated. Sharing a link is not proof of customer identity or valid electronic signing. Explicit name/consent and event metadata are recorded; independent signature, identity proof and legal review are mandatory where required.
- Proposal snapshot hashes bind customer approval to commercial terms and specific revision. Data withheld publicly: unit costs, estimated profit/margin, customer email, private organization identifier and internal review events.
- No automatic renewal; unspent invoices are made void on stop and signed delayed payment events cannot settle them. Existing paid access is not cancelled retroactively.
- Settlement comparisons are authenticated by the app's **admin session** but operator-supplied external data are unverified. Treat mismatches as investigation flags; never convert them to financial events automatically.
- Proxy network origin: by default only socket address is trusted. Set `TRUSTED_PROXY_IPS` to exact, externally controlled reverse proxy addresses, and configure the proxy to sanitize `X-Forwarded-For`. Incorrect proxy configuration can create false-positive shared-network fraud signals.
- Online backup writes a raw plaintext SQLite file. Encrypt stored snapshots, restrict access and secure off-site archives in real environments; SHA-256 manifest protects accidental corruption, not malicious substitution (manifest is unsigned).
- `NODE_ENV=production` rejects HTTP origin, short IP secret and sandbox payment mode. This is a safeguard, not a statement of production readiness. CSP, CSRF protection and rate limits need independent external penetration and load validation.
