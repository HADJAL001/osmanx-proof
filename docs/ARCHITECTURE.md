# Архитектура R1 и целевая архитектура R2+

## R1: проверяемое функциональное ядро

```
Browser (RU/EN responsive SPA)
              |
      Node HTTP server
              |
  Auth/RBAC  |  Offers  |  Billing  |  Referrals  |  Admin
              |
    Atomic service transactions
              |
   SQLite (node:sqlite, local WAL)
```

Сервисные правила независимы от HTML: HTTP-слой вызывает `src/services.mjs`. Таблицы и индексы заданы в `db/schema.sql`. Вся стоимость хранится в целых **копейках**, а не float. Бизнес-операции выполняются в `BEGIN IMMEDIATE` транзакции, что защищает локальную реализацию от двойного начисления при конкурентных запросах внутри одного процесса.

### Источники истины

- Пользователь: `users` + `sessions`.
- Права организаций: `memberships`.
- Исходные цены: строки `quote_items`; суммы пересчитываются сервером.
- Платёж: `payments`, связанный с однозначным счётом.
- Возврат: `refunds`, amount не может превысить остаток по платежу.
- Партнёрское начисление: `referral_rewards` с UNIQUE `payment_id`.
- Журнал: `audit_events`, SHA-256 хэши записи и предыдущей записи.
- Сверка: `ledger_transactions` + `ledger_entries`, каждая проводка сбалансирована.

## R2+: целевая система

```
Next.js + TypeScript  /  Expo React Native
                    |
             BFF / NestJS API
                    |
          RBAC + tenant isolation
                    |
  PostgreSQL (migrations, backups, read replicas later)
             /                   \
           Redis             Object storage
       workers/locks          signed exports
                    |
     Auth provider + Payment adapter + Payout provider
                    |
         Monitoring, alerts, immutable audit snapshots
```

**Не выполнено сейчас:** указанные компоненты R2+ — целевые, но не собранные в этот релиз. В переносе на PostgreSQL использовать UUID, numeric-safe money INTEGER/BIGINT, отдельные транзакции и блокировки строк (`SELECT ... FOR UPDATE`), tenant RLS с проверками контекста, миграции вперёд/назад, очереди исходящих уведомлений и outbox pattern для событий оплат.

Для платёжного адаптера обеспечить проверку **нативной подписи провайдера**, фиксацию факта settlement и преобразование в строго определённый подписанный внутренний event. Нельзя доверять событиям от браузера или одной записи `payment.success` без подтверждения провайдера.

Для учётного журнала нужна внешняя фиксация периодических корневых hash, иначе администратор с прямым доступом к БД может перезаписать всю цепочку и пересчитать значения. Текущая цепочка выявляет случайную или локальную подмену, но не гарантирует неизменность перед владельцем БД.

## План перехода без потери логики

1. Зафиксировать OpenAPI/тест-кейсы текущих эндпоинтов.
2. Перенести схемы в PostgreSQL с миграционными тестами и полной проверкой уникальных ограничений.
3. Выделить domain services в TypeScript; бизнес-формулы сравнивать golden tests против R1.
4. Разделить web (Next.js) и backend (NestJS) по контрактам, убрать прямую зависимость интерфейса от реализации SQLite.
5. Подключить реальные provider adapters, независимые reconciliations, мониторинг и отработку аварийного отказа.
6. Провести браузерный E2E, секьюрити-аудит, legal review и staging rollout с тестовыми аккаунтами.