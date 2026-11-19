# Денежная политика R1: без обещаний заработка

**Ограничение:** цифры — гипотезы продукта, не подтверждённые тарифы для публикации в РФ. Настоящие налоговые расчёты потребуют бухгалтерской проверки.

## Тариф и алгоритм

- Pro: 1 290 ₽ / 1 месяц = `129000` копеек.
- Free: 3 новых предложения на аккаунт за календарный UTC-месяц.
- Первый счёт пользователя по валидной реферальной регистрации: однократная скидка 10% = 129 ₽; платёж 1 161 ₽.
- Плата за саму регистрацию и за право рекомендовать продукт: **0 ₽**.
- Партнёру за первую подтверждённую оплату начисляется максимум 10% реально оплаченной суммы, но не более 250 ₽ и не более 30% оценённого остаточного вклада покупки.
- Оценка вклада: `paid_amount * (1 - 0.12 налоговый резерв) - 290 ₽ переменная себестоимость`.
- Текущая примерная выплата в учёте: `1161 * 10% = 116.10 ₽`. Она не выдается немедленно и может быть аннулирована при возврате/фроде.
- Вторая и последующие покупки того же покупателя не создают повторного вознаграждения.
- Никаких многоуровневых комиссий, двоичных деревьев, возврата собственных взносов или зависящих от приглашений условий основного тарифа.

## Состояния

```
confirmed payment -> pending (14 days) -> payable -> request -> approved
                    |                      |          |
                  refund               refund       provider not configured
                    v                      v          |
                  void/adjustment       adjustment  no real transfer
```

`reviewed/approved` в R1 — учетный статус, **не банковский перевод**. Нет активного payout provider. Финансовый движок не может создавать реальные выплаты без дополнительной интеграции и юридической проверки.

Полные и частичные возвраты создают отдельные записи с уникальными ID, корректируют стоимость покупки, бонус и сбалансированные внутренние проводки. Если баланс для уже оформленной заявки стал недостаточен, такая заявка отклоняется и требует повторной проверки.

Для финального продукта нужны также независимая проверка комиссии эквайринга, НДС/УСН, правил вознаграждений физлицам, резервов на chargeback, KYC, refund windows и лагов оплаты/расчётов.

---

## R2 changes

- Subscriber can stop future **manual** purchases. This invalidates outstanding unpaid invoices but does not remove previously purchased time. The application has never implemented automatic billing.
- Only signed payment events (under local generic bridge contract) or explicitly marked sandbox test events update the ledger. A manually entered reconciliation report is read-only and is never a transfer or financial confirmation.
- Risk holds can demote a previously payable commission into pending and revoke unsupported payout reservations. A confirmed-risk referral cannot generate another reward.
- Current R2 has no real-money acquiring or payout provider and makes no guaranteed earnings representations. Real commercial deployment remains legally and operationally blocked.
