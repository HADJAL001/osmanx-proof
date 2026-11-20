# OSMANX PROOF R7 — закрытый пилот, пошаговый запуск

**Статус:** проверенная ветка `feature/pilot-launch-readiness`, основана на R7. **НЕ** объединённый релиз R8–R13. Настоящая коммерция, эквайринг, вывод средств и публичный доступ заблокированы. Все персональные данные тестовые до отдельной проверки конфиденциальности.

## 1. Перед запуском

- Node.js **22.13+** (проверен 22.16.0), Git не нужен для запуска из ZIP.
- Исходники должны совпадать с `OSMANX_PROOF_R7_PRIVATE_PILOT_SOURCE.zip` и контрольной суммой в `SHA256SUMS.txt`.
- **Не переносить** `node_modules`, `.env`, существующие БД, токены и файлы секретов в исходный архив.
- Для обычного Node/SQLite интерфейса npm-зависимости не требуются. Для отдельного интерфейса Next.js нужен `web-next/package-lock.json` и `npm ci` на машине с доступом к npm.

Из корня проекта:

```sh
node --version
npm run check
npm run acceptance:r5
npm run drill:encrypted
npm run pilot:private:test
```

## 2. Самый безопасный запуск (компьютер или VPS)

```sh
npm run pilot:private
```

Команда `pilot:private`:

1. Принудительно слушает **только `127.0.0.1`**.
2. Принудительно выставляет `PAYMENT_MODE=disabled`, `PAYOUTS_ENABLED=0` и отключает платёжные/email-провайдеры.
3. Не принимает опасную внешнюю конфигурацию, `HOST=0.0.0.0`, `PAYMENT_MODE=sandbox`, `NODE_ENV=production` и попытку включить реальные переводы.
4. Создаёт базу отдельно от исходного кода (`~/.local/share/osmanx-proof-private/pilot.sqlite`), директорию с правами 0700 и закрытые локальные секреты 0600.
5. Не отправляет данные в облако и не открывает порт для интернета.

Откройте **http://127.0.0.1:3100** на том же компьютере.

Для другого порта укажите `PILOT_PORT=3110` (PowerShell: `$env:PILOT_PORT='3110'`), затем снова `npm run pilot:private`.

## 3. Доступ с Windows к закрытой версии на VPS

Передача ZIP через PowerShell с пользовательской учётной записью сервера (без публикации порта 3100):

```powershell
scp .\OSMANX_PROOF_R7_PRIVATE_PILOT_SOURCE.zip user@VPS_IP:~/
ssh user@VPS_IP
```

На сервере:

```sh
mkdir -p ~/osmanx-proof-pilot
unzip -q ~/OSMANX_PROOF_R7_PRIVATE_PILOT_SOURCE.zip -d ~/osmanx-proof-pilot
cd ~/osmanx-proof-pilot
npm run check
npm run pilot:private
```

Оставьте процесс запущенным. На Windows откройте **отдельное окно PowerShell**:

```powershell
ssh -N -L 3100:127.0.0.1:3100 user@VPS_IP
```

Теперь можно открыть http://127.0.0.1:3100 на Windows. Остановить туннель — `Ctrl+C`. **Не** добавляйте открытые правила firewall на 3100 и не публикуйте этот режим через Cloudflare/Nginx: у него пока нет прошедшей независимой production-проверки.

## 4. Резервная копия перед обновлением

Никогда не копируйте работающий `.sqlite` простым `cp` без гарантированной остановки: используйте SQLite online backup API:

```sh
DATABASE_PATH="$HOME/.local/share/osmanx-proof-private/pilot.sqlite" npm run backup -- "$HOME/osmanx-private-backup.sqlite"
npm run backup:verify -- "$HOME/osmanx-private-backup.sqlite"
```

**Внимание: CLI `backup` создаёт незашифрованную SQLite-копию.** Не выгружайте её в GitHub, публичные облачные ссылки или общий чат. Шифруйте перед переносом за пределы сервера; `npm run drill:encrypted` тестирует шифрованный механизм, но **не** загружает копии в offsite сам. Для реального запуска необходимо автоматизировать шифрованные копии и независимое восстановление.

### Откат

1. Остановите сервер `Ctrl+C` и SSH-туннель.
2. Сохраните текущую базу отдельно от исходников.
3. Верните предыдущий ZIP в другую папку, **не поверх** работающей версии.
4. Если структура БД менялась, восстанавливайте **копию базы до обновления**. Использование новой БД со старым кодом без теста миграции не поддерживается.
5. `npm run check`, `npm run pilot:private`, проверить `/health` и `/ready` через туннель.

## 5. Проверка готовности и честный статус

```sh
node scripts/pilot-inventory.mjs --repo . --claim R7
node scripts/pilot-verify.mjs --repo . --output .pilot-qa
node scripts/pilot-gate.mjs --repo . --stage beta --claim R7 --evidence .pilot-qa/evidence.json --expect-blocked
```

Последняя команда должна вернуть `NO_GO` для **публичной** беты: локальные тесты не заменяют HTTPS staging, юридические документы, проверку приватности и независимый аудит. Прежние архивы R8–R13 не обнаружены, поэтому не утверждайте, что R7 содержит их функции.

## 6. Программа первых клиентов

Начните с демонстрационных сценариев без реальных платежей и без приглашения новых партнёров. Используйте обезличенную воронку `examples/pilot-20.csv` и методику в `docs/FIRST_20_CLIENTS_RU.md`. Реальные продажи возможны лишь после отдельного коммерческого разрешения, проверенных договоров, себестоимости, возвратов и эквайринга.
