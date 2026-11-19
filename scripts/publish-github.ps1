param(
  [string]$Owner = 'HADJAL001',
  [string]$Repo = 'osmanx-proof'
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
foreach ($exe in @('git','gh')) {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { throw "Required executable missing: $exe" }
}
& node scripts/github-preflight.mjs
if ($LASTEXITCODE -ne 0) { throw 'Security preflight failed' }
& gh auth status
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI authentication required: gh auth login' }
if (git status --porcelain) { throw 'Worktree has uncommitted files; aborting publication.' }
$target = "$Owner/$Repo"
& gh repo view $target --json nameWithOwner 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating PRIVATE GitHub repository $target"
  & gh repo create $target --private --source . --remote origin --push
  if ($LASTEXITCODE -ne 0) { throw 'Repository creation failed' }
} else {
  Write-Host "Repository $target exists; checking remote."
  & git remote get-url origin 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { & git remote add origin "https://github.com/$target.git" }
  & git push -u origin main
  if ($LASTEXITCODE -ne 0) { throw 'Failed to push main branch' }
}
& git push origin --tags
if ($LASTEXITCODE -ne 0) { throw 'Failed to push release tags' }
& git push -u origin feature/r6-evidence-vault
if ($LASTEXITCODE -ne 0) { throw 'Failed to push R6 work-in-progress branch' }
Write-Host "Published: https://github.com/$target"
