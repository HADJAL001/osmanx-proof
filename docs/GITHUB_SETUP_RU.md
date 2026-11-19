# OSMANX PROOF — как опубликовать Git-репозиторий

## Что включено

Основная ветка `main` содержит стабильный локально проверенный R5; теги `r1`, `r2`, `r3`, `r4`, `r5` хранят восстановленные снимки прежних ZIP-релизов. **Это реконструкция истории из архивов**, а не исходные коммиты разработки. Ветка `feature/r6-evidence-vault` содержит частично реализованный R6, ещё не прошедший самостоятельную приёмку. Реальные платежи и production деплой не включены.

## Публикация с Windows (GitHub CLI)

1. Установите Git и GitHub CLI, выполните `gh auth login` (если ещё не вошли).
2. Распакуйте `OSMANX_PROOF_GITHUB_READY.zip`, включая скрытую папку `.git`.
3. Откройте PowerShell в папке `OSMANX_PROOF_GITHUB_READY`.
4. Выполните `powershell -ExecutionPolicy Bypass -File .\scripts\publish-github.ps1 -Owner HADJAL001` (для другого аккаунта укажите его имя).
5. Дождитесь публикации и проверьте вкладку **Actions** на GitHub. Не включайте production, пока CI и независимые проверки не будут зелёными.

Скрипт создаёт **приватный** репозиторий `osmanx-proof` через `gh repo create`, затем отправляет `main`, все пять тегов и ветку `feature/r6-evidence-vault`. Если репозиторий уже существует, скрипт не перезаписывает историю с `--force`.

## Вариант без GitHub CLI

Создайте приватный пустой репозиторий `osmanx-proof` на GitHub **без README и .gitignore**, затем выполните:

```powershell
git remote add origin https://github.com/HADJAL001/osmanx-proof.git
git push -u origin main
git push origin --tags
git push -u origin feature/r6-evidence-vault
```

## Безопасность

Никогда не отправляйте в репозиторий `.env`, `*.sqlite`, `*.db`, API-ключи, пароль, секреты подписи, реальные пользовательские файлы или резервные копии. Файлы `.env.example` содержат только примеры, а не рабочие секреты. Проверьте историю перед первым push. Если подозреваете утечку — отзовите ключи, а не просто удалите файл новым коммитом.

## Запуск локальной версии

```powershell
npm run check
npm run acceptance:r5
npm start
```

`web-next/` и `db/postgres/` в R5 содержат неиспытанные в данном окружении направления миграции, а не готовый production.
