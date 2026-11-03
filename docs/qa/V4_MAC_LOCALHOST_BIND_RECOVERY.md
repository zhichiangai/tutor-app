# V4 P0｜Mac Docker Desktop 本機 Supabase LAN 暴露修復與無資料遺失複驗

狀態：**環境安全 BLOCKED；尚未在使用者 Mac 修改。** 2026-10-29。

## 現場證據

- 本機專案 `tutor_v4_isolated`，URL `127.0.0.1:54321`／DB `:54322`，但 Docker 的 publish 綁定是 `0.0.0.0`，Mac LAN IP 實測可連兩個 port。網址是 localhost **不等於** 只監聽 localhost。
- 原有 Migration history 36 筆，待套用只有 `20261029024000_v4_payment_date_taipei.sql`。Auth 原有 21 個合成使用者。既有業務資料需保留。
- Codex 已在**儲存庫外**建立 681,412 bytes、權限 600、未加密的 custom PG dump；SHA-256：`0ec60cf1a65eead87f37f4b846bce9b1475445b6ad18e5c7f08513f6226a728c`。不得複製到 Git、對話或雲端；亦不可將只存在未驗證檔名的備份視為已驗證可還原。

## 重要 Mac 專屬坑

官方 Supabase Local Development 指引建議建立帶有 `com.docker.network.bridge.host_binding_ipv4=127.0.0.1` 的網路，然後 `supabase start --network-id ...`：
https://supabase.com/docs/guides/local-development

但 2026/09/29 已有 macOS Docker Desktop 使用者回報：即使使用此方式，LAN 仍可直接連到 Studio，可能與 Docker Desktop VM 的 port forwarding 有關：
https://github.com/supabase/supabase/issues/51027

Docker Desktop 的「Port binding behavior」可設 `Localhost by default` 或 `Localhost only`（UI 位置依版本），官方說明：
https://docs.docker.com/desktop/features/networking/
https://docs.docker.com/desktop/enterprise/hardened-desktop/settings-management/settings-reference/

**只接受實際驗證**，不接受「CLI 列出 127.0.0.1」、「Docker Network 有 loopback option」或「設定已儲存」作為安全證據。

## Codex 執行順序

1. **暫停所有付款／Migration 寫入**；在修復前讓 Mac 遠離不受信任的 LAN，或僅以隔離／可信網路操作，且不得將更多 Auth 憑證暴露。確認當前 Git worktree、Docker context、Supabase CLI 版本、`supabase stop --help`／`supabase start --help` 和本次服務是否屬 `tutor_v4_isolated`。
2. **讀取並驗證備份**：找出 Codex 前次建立的既有 custom dump（不得猜路徑），檢查 mode 600、檔案大小、SHA-256；使用 `pg_restore --list` 檢查格式／目錄可讀。保存一份 schema/user aggregate 資料量與 Migration history 的非個資報表。記錄本機所有 Supabase 容器名、port/NetworkSettings.Ports、Mounts/Volumes 與 docker volume inspect 以確認 PG data mount；**不輸出密鑰**。
3. **先評估 Docker Desktop 既有設定與其他容器影響**：如 UI 支援 Port binding behavior，優先評估 `Localhost only`，或 `Localhost by default` 加嚴格 LAN 驗證。這是可能影響其他新容器的全域設定；如其他服務依靠 LAN 暴露，必須停下來徵詢使用者，不得默默改。不要直接改 `settings-store.json`、daemon.json 或 pf/防火牆全域規則。
4. **只有備份及 volume 身分均確認後**，才考慮使用 `supabase stop`（**絕不能**帶 `--no-backup` 或 `--all`）暫停**此專案**服務並以相同 project ID、同一套既存資料 volume 重新啟動。Supabase 官方文件說明一般 `supabase stop` 保留本機資料；但 Codex 仍須比對前後 volume、Migration history、Auth 人數，不能只依賴文件承諾。若 CLI 支援 project-id，可加明確目標。若有容器重建、volume 異動、不能確定來源或改動會影響其他專案，就停止，不強行繼續。
5. 如 UI 不支援所需 setting，可在備份與 scope 確認後評估官方 custom Docker Network + `supabase start --network-id`，但**在 Mac 上不可視為安全保證**，必須驗證 LAN 不可達。禁止自行 `docker rm -v`、`docker volume rm`、`docker system prune`、`supabase db reset`、`supabase stop --no-backup`。
6. **重啟後在任何 SQL 寫入之前先驗證**：`docker inspect` published HostIp/HostPort、`lsof` 或等效 listening sockets，`127.0.0.1:54321`／`:54322` 應可連；對 Mac LAN IPv4/IPv6 相同 ports（並檢查 Supabase Studio :54323、Mailpit :54324 等其它公開 port）必須被拒絕。最好從**同 LAN 第二台設備**再測一次，不能只看 Docker output。若仍能連到 LAN，**保持 BLOCKED，不套 Migration**。Docker Engine 28 以下的 loopback/L2 已知風險需另外核對。
7. 驗證成功且完整保留 21 個 Auth 合成帳號、36 筆歷史 Migration、既有 QA 業務資料。再使用 Mac Codex 的單一 isolated local migration 前進套用程序將 36→37（已在 GitHub 一次性 CI PASS），不能重播/重設既有 DB；不要動正式 Supabase。
8. 日期驗收：`V4_PAYMENT_TAIPEI_LOCAL_TEST=1 node tests/local/v4-payment-date-taipei-rest.mjs`，此測試**會新增兩個合成帳號及付款**，只可在已驗證的 localhost 隔離環境執行。之後在本機瀏覽器以既有合成老師／家長執行一次有效 NT$600 部分付款及確認，驗證 pending→confirmed；若失敗保留 Network code/message/details/hint（隱去 token/key/完整 UUID），不要連續重送。
9. 完整回報 PASS／FAIL／BLOCKED：綁定地址、localhost 可連、LAN 不可連、Docker volumes 前後是否一致、Auth 原始 21 筆是否保留、Migration 36→37、日期自動測試、家長／老師瀏覽器 E2E，並單獨標出 QA backend allocation consistency 尚未修復。

## 安全門檻

正式 Supabase、Production、其他 RAPID 資料庫與 main **完全不動**。PR #43 保持 Draft；若仍能由 LAN 存取本機 API/DB，立刻停止後續寫入。不要把 unencrypted dump 放入 Git、網路共用或對話。備份驗證只讀，不要做破壞性還原覆寫。

參考來源：
- Supabase local stack and isolated network: https://supabase.com/docs/guides/local-development
- Supabase stop keeps data: https://supabase.com/docs/guides/local-development/cli-workflows
- macOS warning: https://github.com/supabase/supabase/issues/51027
- Docker Desktop port binding behavior: https://docs.docker.com/desktop/enterprise/hardened-desktop/settings-management/settings-reference/
