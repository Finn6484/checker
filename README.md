# LINE 團隊定位打卡連勝系統 (LIFF + Express + Supabase / Vercel Serverless)

專為 LINE 聊天室/群組打造的高互動定位打卡應用。具備 GPS 半徑 100 公尺 (直徑 200 公尺) 距離驗證、固定人數小隊名額制、自訂每日打卡截止時間、聊天室即時進度與逾期警告推播，並支援全員打卡累積團隊連勝。

---

## 🌟 核心特色

1. **🗺️ 即時小地圖與動態虛線指引**：
   - 內建 Leaflet 輕量小地圖，即時標記「打卡基準點 📍」與「你的位置 👤」。
   - 地圖上以綠色半透明圓框繪製**「半徑 100 公尺 (直徑 200 公尺) 打卡邊界」**。
   - 以**動態虛線**直覺指引使用者走向打卡點：範圍內為翠綠色虛線，超出範圍為紅色虛線。
2. **📍 半徑 100 公尺 (直徑 200 公尺) 定位打卡**：
   - 採用標準 **Haversine 球面距離演算法**，前後端雙重校驗。
   - 僅當成員與設定之基準點直線距離 $\le 100$ 公尺 (即直徑 200 公尺範圍內) 時才解鎖打卡。
2. **👥 固定人數小隊名額制**：
   - 群組初次設定時指定小隊人數上限（如 3 人、5 人）。
   - 成員點擊「加入打卡小隊」登記名額，滿員後鎖定打卡小隊名單。
3. **⏰ 自訂每日截止時間 (Cutoff Time)**：
   - 可自訂每日截止時限（如 `09:30`、`18:00` 或 `23:59`）。
   - 全員在截止時間前完成打卡才計入連勝；逾期則連勝中斷並列出缺席名單。
4. **🔥 全員連勝累積與彩帶慶祝**：
   - 僅在小隊全員達成時累積連勝天數。
   - 前端整合 Canvas Confetti 五彩彩帶慶祝特效。
5. **📢 LINE 聊天室即時推播與警告**：
   - **單人打卡**：即時廣播成員進度（例：`小明已完成打卡！進度 2/3 人`）。
   - **全員達成**：即時廣播大慶祝通知與連勝加成。
   - **逾期警告**：超過截止時間有人缺席時，推播警告並通報缺席名單。
6. **📋 截止後 5 分鐘自動推播打卡即時資料**：
   - 每次過群組設定之截止時間 **5 分鐘後**，自動向 LINE 聊天室發送精美 **「今日打卡即時資料」Flex 卡片**。
   - 詳細呈現成員打卡時間、打卡距離、缺席名單與小隊達成率。
   - 內建伺服器長駐背景排程、`/api/cron/check-cutoff` 端點及 GitHub Actions 24/7 監控，跨日跨午夜不遺漏且自動防重複推播。
7. **⚡ Vercel Serverless 架構**：
   - 修正 Raw Body 中間件掛載順序，確保 LINE Signature 驗證百分之百通過。
   - 符合 Vercel Serverless 規範，提供 `vercel.json` 與 `module.exports = app;`。
8. **💾 資料庫雙模式 (本地零設定儲存 / 雲端 Supabase)**：
   - 本地開發時自動降級為本地檔案/記憶體儲存，開箱即測 `?mock=true`。
   - 設定 `SUPABASE_URL` 與 `SUPABASE_KEY` 即無縫切換為 Supabase PostgreSQL。

---

## 🚀 快速開始 (本地開發與零設定測試)

### 1. 安裝相依套件
```bash
npm install
```

### 2. 本地啟動
```bash
npm start
```
伺服器將在 `http://localhost:3000` 啟動。

### 3. 開啟零設定測試模式 (Mock Mode)
在瀏覽器直接開啟：
👉 **`http://localhost:3000?mock=true`**

- **🎯 模擬在範圍內 (30m)**：一鍵設定 GPS 座標至台北 101 打卡點 30 公尺處，按鈕解鎖變綠！
- **🚫 模擬在範圍外 (250m)**：一鍵設定 GPS 座標至 250 公尺處，按鈕鎖定提示超出範圍！
- **👥 模擬隊友打卡**：一鍵讓隊友完成打卡，體驗 1/3 -> 2/3 -> 3/3 進度累積！
- **🎉 全員連勝噴花**：當名單全數完成，觸發全螢幕彩帶特效與連勝天數累加！
- **⏰ 模擬逾期**：一鍵模擬截止時間已過，觀察連勝中斷與警告樣式。

---

## ☁️ 部署到 Vercel 步驟說明

### 步驟 1：建立 Supabase 資料庫 (若使用雲端模式)
1. 前往 [Supabase](https://supabase.com/) 建立免費專案。
2. 點擊左側選單的 **SQL Editor**。
3. 複製專案根目錄下的 [`schema.sql`](schema.sql) 完整內容，貼上並點擊 **Run** 執行。
4. 在 Supabase **Project Settings -> API** 中複製：
   - `Project URL`
   - `anon` 或 `service_role` key

### 步驟 2：部署至 Vercel
1. 將本專案程式碼推送到 GitHub。
2. 登入 [Vercel](https://vercel.com/)，點擊 **Add New Project** 並匯入該 Repository。
3. 在 **Environment Variables** (環境變數) 中新增以下變數：

| 變數名稱 | 範例值 / 說明 |
| :--- | :--- |
| `LINE_CHANNEL_SECRET` | `6befbf2a1c5c83099c87a12641c5171a` |
| `LINE_CHANNEL_ACCESS_TOKEN` | 您的 Long-lived Channel Access Token |
| `LINE_LIFF_ID` | `2012424428-3Vg4egq5` |
| `SUPABASE_URL` | `https://your-project.supabase.co` |
| `SUPABASE_KEY` | 您的 Supabase API Key |

4. 點擊 **Deploy** 完成部署。部署完成後，Vercel 會產生一組 Production 網址（例如 `https://your-app.vercel.app`）。

---

## 📱 LINE Developers 後台設定指南

### 1. 設定 Webhook URL
1. 進入 [LINE Developers Console](https://developers.line.biz/) -> Messaging API。
2. 將 **Webhook URL** 填入您的 Vercel 網址加上 `/webhook`：
   ```
   https://your-app.vercel.app/webhook
   ```
3. 開啟 **Use Webhook**（設為 Enabled）。
4. 點擊 **Verify** 確認回傳 HTTP 200。
5. 在 **LINE Official Account features** 中：
   - **Auto-reply messages**：停用 (Disabled)
   - **Greeting messages**：停用 (Disabled)
   - **Allow bot to join group chats**：啟用 (Enabled，允許加入群組)

### 2. 設定 LIFF Endpoint URL
1. 進入 LINE Developers Console -> **LIFF** 分頁。
2. 點擊您的 LIFF ID（`2012424428-3Vg4egq5`）：
   - **Endpoint URL** 填入 Vercel 網址根目錄：
     ```
     https://your-app.vercel.app/
     ```
   - **Scope**：勾選 `profile`、`openid`、`chat_message.write`
   - **Bot link feature**：Normal (或 On)

---

## 🧪 自動化測試

本專案內建完整的單元測試與 Express API 整合測試套件：
```bash
npm test
```
包含：
- ✔️ Haversine 距離公式精準度驗證
- ✔️ 群組打卡地點、小隊人數上限與截止時間設定
- ✔️ 小隊固定名額防溢出鎖定判定
- ✔️ 半徑 100 公尺 (直徑 200 公尺) 限制判定 (範圍內放行，範圍外 400 攔截)
- ✔️ 全員打卡達成與連勝 +1 累加判定
- ✔️ 每日截止時間逾時狀態判定
