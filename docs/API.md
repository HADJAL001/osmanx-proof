# API R1

База: `/api`. Все ответы JSON с `ok:true/false`. Адреса `/`, `/app`, `/s/<token>` возвращают HTML; `/s/<token>` доступен без сессии до истечения TTL и не раскрывает внутреннюю себестоимость.

### Auth / organizations

| Метод | URL | Назначение |
|---|---|---|
| POST | `/auth/register` | Регистрация `{name,email,password,referralCode?}`, выдача сессии |
| POST | `/auth/login` | Вход `{email,password}` |
| GET | `/me` | Пользователь, организации, CSRF, режим платежей |
| PATCH | `/me/locale` | Язык `{locale:'ru'|'en'}` |
| POST | `/auth/logout` | Завершение сессии |
| POST | `/orgs` | Создать организацию `{name}` |
| POST | `/orgs/<orgId>/invite` | Owner: `{email,role:'editor'|'viewer'}` |
| POST | `/invitations/accept` | `{token}` (адрес email должен совпадать) |

### Offers

| Метод | URL | Назначение |
|---|---|---|
| GET | `/quotes?orgId=<id>` | Список предложений организации |
| POST | `/quotes` | Создать предложение |
| GET | `/quotes/<id>` | Детали/расчёт |
| PATCH | `/quotes/<id>` | Изменить предложение до финального статуса |
| POST | `/quotes/<id>/status` | `{status:'sent'|'accepted'|'cancelled'}` |
| POST | `/quotes/<id>/share` | Истекающая публичная ссылка |
| GET | `/quotes/<id>/print` | Защищённая print-ready HTML версия |

Пример JSON для POST `/quotes`:

```json
{
  "orgId":"<uuid>",
  "title":"Разработка сайта",
  "clientName":"Компания",
  "clientEmail":"client@example.org",
  "discountCents":50000,
  "taxBps":0,
  "items":[{"description":"Дизайн и разработка","qty":1,"unitPriceCents":1200000,"unitCostCents":400000}]
}
```

### Billing / referrals / support

| Метод | URL | Назначение |
|---|---|---|
| GET | `/invoices?orgId=<id>` | Счета |
| POST | `/invoices` | Выдать очередной Pro-счёт `{orgId}` |
| POST | `/sandbox/pay` | Только dev: симулировать оплату `{orgId,invoiceId}` |
| POST | `/sandbox/refund` | Только dev+admin: симулировать возврат |
| POST | `/webhooks/payments` | Подписанное событие от доверенного адаптера |
| GET | `/referrals/me` | Реферальная ссылка и состояние бонусов |
| POST | `/referrals/payouts` | Заявка `{amountCents}`, не перевод |
| GET | `/referrals/payouts` | Мои заявки |
| GET | `/disputes?orgId=<id>` | Обращения организации |
| POST | `/disputes` | `{orgId,subject,detail}` |

### Admin

`GET /admin`, `GET /admin/audit`, `POST /admin/referrals/settle`, `POST /admin/fraud/<id>/review`, `POST /admin/disputes/<id>/review`, `POST /admin/payouts/<id>/review`.

### CSRF

Для изменяющих запросов авторизованных пользователей отправляется `X-CSRF-Token`, взятый из `GET /api/me`. Session-cookie отправляется браузером, секрет токена сессии недоступен JavaScript. Header `Origin` при наличии должен совпадать с `APP_ORIGIN`.

### Подпись внутреннего webhook

`X-OSX-Timestamp`: Unix seconds.

`X-OSX-Signature`: HMAC SHA-256 hex по строке `timestamp + '.' + rawBody`, ключ `WEBHOOK_SECRET`. Время допускается в окне ±300 секунд. ID события уникальный. События: `payment.succeeded`, `payment.refunded`. **НЕ ПОСЫЛАЙТЕ реальные провайдерские webhook напрямую на этот endpoint**, пока не создан адаптер, проверяющий подпись и расчёт провайдера.

---

# R2 additions — versioned customer response and finance controls

| Method | Endpoint | Permission | Important behaviour |
|---|---|---|---|
| GET | `/s/:token` | Time-limited bearer URL | Displays *public* proposal terms + customer response form; old/version-mismatched URLs rejected. |
| POST | `/api/public/quotes/:token/respond` | Bearer token + explicit consent | `{name:string,decision:'accepted'\|'changes_requested',message?:string,consent:true}`; one-time, logged. |
| GET | `/api/subscriptions?orgId=...` | Workspace member | Current plan, term, renewal state, no automatic charging. |
| POST | `/api/subscriptions/:orgId/cancel` | Workspace owner + session/CSRF | Void open invoices, keep existing paid term. |
| POST | `/api/subscriptions/:orgId/resume` | Workspace owner + session/CSRF | Allow new manual invoices; never automatically charges. |
| POST | `/api/admin/settlements` | Admin + session/CSRF | `{provider,reportId,rows:[{externalId,amountCents,refundedCents}],complete?:boolean}`; comparison only. |
| GET | `/api/admin/settlements` | Admin | Saved report metadata. |
| POST | `/api/admin/referrals/:buyerId/recheck` | Admin + session/CSRF | Re-evaluate buyer risk with immutable audit trail. |
| GET | `/ready` | Public operational probe | Returns 503 if SQLite/integrity/audit/ledger validation fails; no personal data. |

**Restrictions:** customer response through a token is not verified legal electronic signing; no actual transaction settlement is triggered by importing an operator report. `complete=true` must only be set when the report includes the provider's entire historical set in that namespace. Request body for report capped at 256 KB, 2,000 rows per request.

## R5 delivery work endpoints

Refer to `docs/R5_IMPLEMENTATION.md` for full request/response and security notes. Added: `POST /api/projects` (launch only from client-accepted latest quote), `GET /api/projects?orgId=`, `GET /api/projects/:id`, `POST /api/projects/:id/milestones`, `PATCH /api/projects/:id/milestones/:mid` (expectedVersion), `POST /api/projects/:id/milestones/:mid/submit`, `POST /api/projects/:id/share`, `POST /api/projects/:id/shares/:sid/revoke`, `GET /api/projects/metrics?orgId=`, `GET /api/projects/export.csv?orgId=`, `GET /c/:token`, `GET /api/public/projects/:token`, `POST /api/public/projects/:token/milestones/:mid/respond`. Public response requires `name`, `decision`, `consent:true`, `submissionRevision` and optionally `message`; `changes_requested` requires substantive message. Public token links are not identity proof or qualified e-signatures.
