# 家教計時器

這是一個給家教老師與家長共同使用的課程月曆與對帳工具。

目前定位是 MVP：先用最少的架構完成「可上線、可同步、可測試真實使用者」。

## 目前功能

- 月曆總覽：查看每一天的上課、請假與付款狀態。
- 老師模式：新增上課紀錄、預排固定課程、標記請假、確認收款。
- 家長模式：查看上課紀錄、標記請假、確認付款。
- 預排課程：支援不重複、每週、每兩週、每月與重複到日期。
- 雲端同步：透過 Google Apps Script 寫入 Google Sheet。
- GitHub Pages：前端可公開存取，不需要開發電腦開機。

## 線上網址

```text
https://zhichiangai.github.io/tutor-app/
```

## 專案結構

```text
frontend/
  index.html
  app.js
  style.css

backend/
  apps-script/
    Code.js
    appsscript.json

index.html
README.md
```

## 架構

```text
GitHub Pages 前端
-> Google Apps Script Web App
-> Google Sheet
```

## 部署方式

前端：

1. 修改 `frontend/`。
2. Commit 並 push 到 GitHub。
3. GitHub Pages 會從 `main` branch 的 `/root` 自動更新。

後端：

1. 修改 `backend/apps-script/`。
2. 使用 clasp 推送到 Google Apps Script。
3. 建立新版本並部署 Web App。

## 不公開的本機資料

以下資料只留在本機，不推到公開 GitHub repo：

- `note/`
- `策略MD合集/`
- `.clasp.json`
- `.DS_Store`

## 目前開發原則

- 先完成 MVP 的穩定操作，不急著重構成大型系統。
- 不導入複雜框架。
- LINE 先當入口與通知工具，不做聊天型 Bot。
- 真實使用者測試優先於新增大型功能。
