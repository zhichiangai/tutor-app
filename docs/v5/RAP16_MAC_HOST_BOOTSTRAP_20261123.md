# RAP-16｜Mac 主機備份工具準備（2026-11-23）

> 狀態：**HOST TOOLING BLOCKED / NO PRODUCTION DATABASE ACCESS**。  
> 本文件只解除 Codex 2026-11-23 回報的執行環境阻礙；不是正式資料庫匯出、還原、Migration 63/64 或正式部署授權。

## 背景與不可重做的部分

- GitHub Draft [PR #83](https://github.com/zhichiangai/tutor-app/pull/83) Head `336a06e8a70cb38a2927812d102b6c17ed00b983` 已有 `scripts/release/v58-pg17-credential-guard.mjs`、`scripts/release/v58-private-backup.sh` 和還原操作手冊。**這些尚未合併到 main**，因此不能只在 main 工作樹用 `ls` 找工具。
- [PR #97](https://github.com/zhichiangai/tutor-app/pull/97) 已在 GitHub disposable PG17 透過真實 migration history 驗證 62→63→64 升級 PASS；不要用 Codex 再重跑這一輪。
- Codex 2026-11-23 受限環境：未見 PG17 CLI、無 Docker daemon、無可核實 age 私鑰、FileVault 狀態未知；正式 Drive folder 空白。**所有正式 dump / 還原仍 NOT TESTED**。

## A. 先確定正在操作真正的 macOS Host，而非 Codex sandbox

1. 只做唯讀盤點：`uname -s`、`command -v brew`、`brew --prefix`（若有）、`command -v docker`、`docker info`、`command -v age`、`command -v age-keygen`、`df -h`。列出所有工具路徑與**版本**，但不印環境變數中的密碼。若 Codex 仍無法存取 Mac 主機，**停止**，改由使用者在 Mac Terminal／系統設定中操作。
2. 優先檢查是否僅因 Homebrew keg-only 未進 PATH 而找不到既有 PG17：`brew --prefix libpq@17` 或 `brew --prefix postgresql@17`，再直接檢查 `<prefix>/bin/pg_dump --version`、`pg_restore`、`pg_dumpall`、`psql`。
3. 若確實未安裝，**先取得使用者對新增本機套件的明確同意**，從官方 Homebrew 安裝 `libpq@17` 作為客戶端（`brew install libpq@17`），不要升級任何既存服務或強制 `brew link --force`。以目前這個 Terminal 工作階段的局部 PATH 選用 PG17；不要修改系統全域 PATH，也不要啟動資料庫伺服器。
4. 若要真正隔離 Supabase Restore，先確認原本是否安裝 Docker Desktop，若僅是 Daemon 沒啟動，請由使用者透過 Mac GUI 開啟現有 Docker Desktop、完成必要條款/權限同意，再只做 `docker info` 驗證。不能擅自重建/清除既有容器、Volume 或修改 Docker 全域設定。若未安裝 Docker，標記完整 Supabase Restore BLOCKED；在非公開本機另行評估建立**全新** PostgreSQL17 scratch 僅作部分還原（不能據此宣稱 Supabase managed Auth/Storage 完整 PASS）。

官方來源：
- <https://formulae.brew.sh/formula/libpq@17>
- <https://formulae.brew.sh/formula/postgresql@17>
- <https://docs.docker.com/desktop/setup/install/mac-install/>

## B. 資料加密與金鑰門檻

1. FileVault 優先由 Mac「系統設定 → 隱私權與安全性 → FileVault」本人核對；受限環境的 `fdesetup` 失敗不代表 FileVault 已關閉或已開啟。只回報 On/Off/Unknown，不擅自啟動加密或重開機。
2. 準備在 Git repo 之外的**新建** 0700 私人資料夾。若確認沒有可用 age 身分，先讓使用者批准產生全新 age X25519 identity，確保檔案權限 0600，並由使用者**獨立保存一份可恢復的私鑰副本**（例如安全的離線位置），再用 `age-keygen -y <identity_file>` 導出公鑰 recipient。公鑰可回報；私鑰、密碼及未加密備份不可出現在聊天、CI、Drive、GitHub 或 Linear。
3. **不能先把正式資料備份到非加密磁碟，再決定要不要加密**。若 FileVault 無法證實或沒有可靠的加密儲存路徑，保持 BLOCKED。
4. 確認 Google Drive 正式私人目標資料夾權限與可用空間，但**尚不讀取或上傳真實資料**。

## C. 正確取得 PR #83 工具（不要覆寫既有工作樹）

- 首先查看既有 PR #83 專用 worktree `/Users/fengfeng/.codex/worktrees/v58-backup-safety/家教小網站` 是否存在及其 Git 狀態／實際 Head，**不要假定乾淨或覆寫**。
- 若不存在，於目前 Repo 執行安全的 `git fetch origin pull/83/head`，先核實 `FETCH_HEAD` 的 commit 是 `336a06e8a70cb38a2927812d102b6c17ed00b983`，再在**新的、不存在的私密目錄** `git worktree add --detach <new_dir> FETCH_HEAD`。只讀取備份工具，不做 `git reset --hard`、`git clean`、Main merge、rebase 或推送。
- 在 **PR #83 worktree** 執行 `bash -n scripts/release/v58-private-backup.sh`、`node --check scripts/release/v58-pg17-credential-guard.mjs`、`node --test tests/v58-pg17-credential-guard.test.mjs`（若該測試檔存在）。只驗證工具語法與離線合約，**不執行正式備份**。
- 本地 `PGPASSFILE` 必須位於 Git repo 外、regular 0600；任何正式連線資訊應由使用者在本機安全輸入。未經備份授權，不執行 `pg_dump`、`supabase db dump` 或讀取 Production secrets。

## D. 本任務結束標準

僅回報：Host／Sandbox 是否可區分、PG17 client 路徑/版本、FileVault On/Off/Unknown、Docker daemon Yes/No、age identity 已安全就緒 Yes/No、PR83 worktree 精確 SHA、離線工具語法測試結果、是否需要使用者親自批准安裝／金鑰／外部憑證。

**預期 Production writes=0、Production reads=0、正式備份與還原均 NOT TESTED。** 備妥環境後，再獨立依現有 Runbook 執行經授權的 Production read-only dump → age 加密 → Drive 密文回讀校驗 → 隔離 Supabase 真實資料還原；此文件不構成那一步的授權。
