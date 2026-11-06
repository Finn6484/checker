const express = require('express');
const cors = require('cors');
const path = require('path');
const line = require('@line/bot-sdk');
require('dotenv').config();

const db = require('./db');

const app = express();

// LINE 設定
const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET || '6befbf2a1c5c83099c87a12641c5171a',
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'jZC5VhvX8gOhiXwRGMWe2YW7FvLfDgcgzev8d6MU7L2fgjUWeqYWh+dz05f58oQaj+xPlb9Khcos4TtN5VxhtOZynLWoOaHSSxDTnEJ6DdQbbWpNtaF4abaUQ+JyFSudFAC7Qnoyz+BtZoRijxazVwdB04t89/1O/w1cDnyilFU='
};

const LIFF_ID = process.env.LINE_LIFF_ID || '2012424428-3Vg4egq5';
const LIFF_URL = `https://liff.line.me/${LIFF_ID}`;

// 初始化 LINE Messaging API Client
let lineClient = null;
try {
  lineClient = new line.messagingApi.MessagingApiClient({
    channelAccessToken: lineConfig.channelAccessToken
  });
} catch (e) {
  console.warn('[LINE Client] 初始化警告:', e.message);
}

// -------------------------------------------------------------
// 1. 重要：在 express.json() 之前掛載 LINE Webhook
// line.middleware 需使用 raw body 進行 x-line-signature 簽章驗證
// 避免因 express.json() 提前消耗 body stream 而造成 400/500 錯誤
// -------------------------------------------------------------
app.use(cors());

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events || [];
    const results = await Promise.all(events.map(handleLineEvent));
    res.json(results);
  } catch (err) {
    console.error('[LINE Webhook Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 2. 後續 REST API 路由解析 JSON
// -------------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 靜態檔案服務 (LIFF 前端介面)
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// 距離計算輔助函式 (Haversine Formula) - 單位：公尺
// -------------------------------------------------------------
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // 地球半徑 (公尺)
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 安全推播輔助函式
 */
async function sendGroupPush(groupId, messagePayload) {
  if (!lineClient || !groupId || groupId.startsWith('mock-') || groupId === 'direct-chat') {
    console.log(`[Push Simulated (${groupId})]`, JSON.stringify(messagePayload));
    return;
  }
  try {
    await lineClient.pushMessage({
      to: groupId,
      messages: Array.isArray(messagePayload) ? messagePayload : [messagePayload]
    });
  } catch (err) {
    console.warn(`[LINE Push Message Failed to ${groupId}]:`, err.message);
  }
}

// -------------------------------------------------------------
// LINE Bot 事件處理器
// -------------------------------------------------------------
async function handleLineEvent(event) {
  const source = event.source || {};
  const groupId = source.groupId || source.roomId || source.userId || 'direct-chat';
  const userId = source.userId;

  // 嘗試自動記錄群組成員
  if (source.groupId && userId && lineClient) {
    try {
      const profile = await lineClient.getGroupMemberProfile(groupId, userId);
      if (profile) {
        await db.upsertMember(groupId, {
          userId: profile.userId,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl
        });
      }
    } catch (e) {
      await db.upsertMember(groupId, { userId, displayName: '群組成員' });
    }
  }

  // 處理文字訊息
  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();

    if (text === '打卡' || text === '簽到' || text === '狀態' || text === '進度' || text === '連勝') {
      const todayStr = db.getTaipeiDateString();
      const status = await db.getGroupStatus(groupId, todayStr, userId);

      const targetDesc = status.target ? status.target.name : '⚠️ 尚未設定打卡基準點';
      const streakDesc = status.streak > 0 ? `🔥 累積連勝：${status.streak} 天` : '🔥 尚無連勝紀錄 (全員打卡即可開始！)';
      const progressDesc = `👥 今日打卡：${status.checkedInCount} / ${status.quota} 人 (小隊已登記 ${status.teamSize}/${status.quota} 人)`;
      const cutoffDesc = `⏰ 每日截止時間：${status.cutoffTime}`;

      let allStatus = '⏳ 等待小隊全員打卡累積連勝中...';
      if (status.isAllCheckedIn) {
        allStatus = '🎉 今日小隊全員已全數完成打卡！連勝累積成功！';
      } else if (status.isOverdue) {
        allStatus = `⚠️ 今日已超過截止時間 (${status.cutoffTime})！未打卡成員：${status.missingMembers.join('、') || '無'}`;
      }

      return lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [
          {
            type: 'flex',
            altText: '📍 團隊定位打卡系統',
            contents: {
              type: 'bubble',
              header: {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#00B900',
                contents: [
                  {
                    type: 'text',
                    text: '📍 定位打卡連勝系統',
                    weight: 'bold',
                    size: 'lg',
                    color: '#FFFFFF'
                  }
                ]
              },
              body: {
                type: 'box',
                layout: 'vertical',
                spacing: 'md',
                contents: [
                  {
                    type: 'text',
                    text: `📍 地點：${targetDesc}`,
                    weight: 'bold',
                    size: 'sm'
                  },
                  {
                    type: 'text',
                    text: cutoffDesc,
                    weight: 'bold',
                    size: 'xs',
                    color: '#4B5563'
                  },
                  {
                    type: 'text',
                    text: streakDesc,
                    weight: 'bold',
                    size: 'sm',
                    color: '#FF6B00'
                  },
                  {
                    type: 'text',
                    text: progressDesc,
                    size: 'sm',
                    color: '#1F2937'
                  },
                  {
                    type: 'text',
                    text: allStatus,
                    size: 'xs',
                    wrap: true,
                    color: status.isAllCheckedIn ? '#00B900' : (status.isOverdue ? '#DC2626' : '#6B7280')
                  },
                  {
                    type: 'separator',
                    margin: 'md'
                  },
                  {
                    type: 'text',
                    text: '※ 需在打卡點半徑 100 公尺內且於截止時間前打卡有效。',
                    size: 'xxs',
                    color: '#9CA3AF'
                  }
                ]
              },
              footer: {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'button',
                    action: {
                      type: 'uri',
                      label: '📍 開啟打卡頁面 (LIFF)',
                      uri: `${LIFF_URL}?groupId=${encodeURIComponent(groupId)}`
                    },
                    style: 'primary',
                    color: '#00B900'
                  }
                ]
              }
            }
          }
        ]
      });
    }

    if (text === '設定' || text === '設定地點' || text === '小隊' || text === '重設') {
      return lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [
          {
            type: 'text',
            text: `📍 請點擊下方連結開啟 LIFF 打卡頁面，任何人皆可自由設定打卡地點、調整小隊名額上限與截止時間：\n${LIFF_URL}?groupId=${encodeURIComponent(groupId)}`
          }
        ]
      });
    }
  }

  // 機器人加入群組事件
  if (event.type === 'join' || event.type === 'memberJoined') {
    return lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: 'text',
          text: `👋 大家好！歡迎使用【定位打卡連勝系統】！\n\n📌 規則說明：\n1. 初次使用請點擊打卡頁面設定打卡地點、小隊人數上限與每日截止時間。\n2. 打卡需在打卡地點半徑 100 公尺內方可成功。\n3. 小隊成員每天在截止時間前全員完成打卡，才能累積團隊連勝天數！🔥\n\n輸入「打卡」或點擊下方連結開始：\n${LIFF_URL}?groupId=${encodeURIComponent(groupId)}`
        }
      ]
    });
  }

  return Promise.resolve(null);
}

// -------------------------------------------------------------
// REST API 介面 (供 LIFF 前端使用)
// -------------------------------------------------------------

/**
 * 查詢使用者預設/所屬的真實 LINE 群組 (避免 1 對 1 聊天室 ID 隔離)
 */
app.get('/api/user/default-group', async (req, res) => {
  try {
    const userId = req.query.userId;
    const requestedGroupId = req.query.groupId;

    // 1. 若 requestedGroupId 本身即是真實 LINE 群組 (C 開頭)，直接採用
    if (requestedGroupId && requestedGroupId.startsWith('C')) {
      return res.json({ success: true, groupId: requestedGroupId });
    }

    // 2. 否則從資料庫查詢該使用者在聊天室中參與的真實 LINE 群組
    if (userId) {
      const realGroup = await db.getUserRealGroup(userId);
      if (realGroup && realGroup.group_id) {
        return res.json({ success: true, groupId: realGroup.group_id });
      }
    }

    res.json({ success: true, groupId: requestedGroupId || 'mock-group' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 取得群組完整狀態
 */
app.get('/api/status', async (req, res) => {
  try {
    const groupId = req.query.groupId || 'mock-group';
    const userId = req.query.userId || null;
    const todayStr = db.getTaipeiDateString();

    const status = await db.getGroupStatus(groupId, todayStr, userId);
    res.json({ success: true, data: status });
  } catch (err) {
    console.error('[API status error]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 設定群組 (打卡地點、小隊人數上限、每日截止時間)
 */
app.post('/api/group/setup', async (req, res) => {
  try {
    const { groupId, targetLat, targetLng, targetName, memberQuota, cutoffTime } = req.body;
    if (!groupId || targetLat == null || targetLng == null) {
      return res.status(400).json({ success: false, message: '缺少座標或群組資訊' });
    }

    const group = await db.setupGroup(groupId, {
      targetLat: Number(targetLat),
      targetLng: Number(targetLng),
      targetName: targetName || '打卡基準點',
      memberQuota: memberQuota ? parseInt(memberQuota, 10) : 3,
      cutoffTime: cutoffTime || '23:59'
    });

    res.json({
      success: true,
      message: '群組設定更新成功！',
      data: group
    });
  } catch (err) {
    console.error('[API group setup error]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 加入打卡小隊 (固定名額制)
 */
app.post('/api/member/join', async (req, res) => {
  try {
    const { groupId, userId, displayName, pictureUrl } = req.body;
    if (!groupId || !userId) {
      return res.status(400).json({ success: false, message: '缺少 groupId 或 userId' });
    }

    const result = await db.joinTeam(groupId, { userId, displayName, pictureUrl });
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 退出打卡小隊
 */
app.post('/api/member/leave', async (req, res) => {
  try {
    const { groupId, userId } = req.body;
    if (!groupId || !userId) {
      return res.status(400).json({ success: false, message: '缺少 groupId 或 userId' });
    }
    await db.leaveTeam(groupId, userId);
    res.json({ success: true, message: '已退出打卡小隊' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 執行打卡 (核心：驗證 100m 距離、截止時間、即時推播進度與連勝)
 */
app.post('/api/checkin', async (req, res) => {
  try {
    const { groupId, userId, displayName, pictureUrl, lat, lng } = req.body;
    if (!groupId || !userId || lat == null || lng == null) {
      return res.status(400).json({ success: false, message: '打卡參數不完整' });
    }

    // 1. 取得打卡目標地點
    const group = await db.getGroup(groupId);
    if (!group || group.target_lat == null || group.target_lng == null) {
      return res.status(400).json({
        success: false,
        message: '群組尚未設定打卡地點，請先設定打卡基準點！'
      });
    }

    // 2. 距離計算 (Haversine 公式)
    const distanceMeters = calculateDistanceMeters(
      Number(lat),
      Number(lng),
      group.target_lat,
      group.target_lng
    );
    const roundedDistance = Math.round(distanceMeters);

    // 3. 100 公尺半徑判定
    if (distanceMeters > 100) {
      return res.status(400).json({
        success: false,
        inRange: false,
        distance: roundedDistance,
        maxAllowedDistance: 100,
        message: `距離打卡點約 ${roundedDistance} 公尺，超出 100 公尺限制！請靠近打卡點後再試。`
      });
    }

    // 4. 截止時間判定
    const cutoffTime = group.cutoff_time || '23:59';
    const isPastCutoff = db.isTimePastCutoff(cutoffTime);
    if (isPastCutoff) {
      return res.status(400).json({
        success: false,
        isOverdue: true,
        message: `今日打卡截止時間 (${cutoffTime}) 已過！已無法計入今日連勝。`
      });
    }

    // 5. 寫入打卡紀錄並判定連勝
    const todayStr = db.getTaipeiDateString();
    const result = await db.recordCheckIn({
      groupId,
      userId,
      displayName: displayName || '小隊成員',
      pictureUrl,
      dateStr: todayStr,
      lat: Number(lat),
      lng: Number(lng),
      distance: roundedDistance
    });

    const quota = result.quota || 3;
    const checkedCount = result.checkedInCount;

    // 6. 即時推播進度至 LINE 聊天室
    if (result.isAllCheckedIn && result.newStreakAwarded) {
      // 全員達成連勝大推播
      await sendGroupPush(groupId, {
        type: 'text',
        text: `🎉【全體連勝達成！】\n聊天室內小隊全體成員已全數在截止時間 (${cutoffTime}) 前完成打卡！\n🔥 連勝天數再 +1！目前累積連勝：${result.streak} 天！\n大家明天請繼續保持！💪`
      });
    } else {
      // 單人打卡即時進度推播
      await sendGroupPush(groupId, {
        type: 'text',
        text: `📍【打卡通知】${displayName || '成員'} 已完成打卡 (距離基準點 ${roundedDistance} 公尺)！\n👥 今日打卡進度：${checkedCount} / ${quota} 人\n⏰ 每日截止時間：${cutoffTime}\n${result.isAllCheckedIn ? '🎉 全員打卡達成！' : `⏳ 還差 ${quota - checkedCount} 人即可達成今日連勝！`}`
      });
    }

    res.json({
      success: true,
      inRange: true,
      distance: roundedDistance,
      streak: result.streak,
      isAllCheckedIn: result.isAllCheckedIn,
      streakAchievedToday: result.streakAchievedToday,
      newStreakAwarded: result.newStreakAwarded,
      totalMembers: quota,
      checkedInCount: checkedCount,
      message: result.isAllCheckedIn
        ? `🎉 打卡成功！小隊全員皆已打卡，連勝達到 ${result.streak} 天！🔥`
        : `✅ 打卡成功！(距離基準點 ${roundedDistance} 公尺)。今日進度：${checkedCount}/${quota} 人。`
    });
  } catch (err) {
    console.error('[API checkin error]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 檢查並觸發逾時警告推播
 */
app.post('/api/group/check-overdue', async (req, res) => {
  try {
    const groupId = req.body.groupId || 'mock-group';
    const todayStr = db.getTaipeiDateString();
    const status = await db.getGroupStatus(groupId, todayStr);

    if (status.isOverdue && status.missingMembers.length > 0) {
      await sendGroupPush(groupId, {
        type: 'text',
        text: `⚠️【打卡截止警告】\n今日打卡截止時間 (${status.cutoffTime}) 已過！\n❌ 尚未打卡小隊成員：${status.missingMembers.join('、')}\n💔 今日連勝中斷，明日請全員準時完成！`
      });
      return res.json({ success: true, warned: true, missing: status.missingMembers });
    }

    res.json({ success: true, warned: false, message: '尚未超過截止時間或全員已打卡' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 測試模式：模擬隊友打卡
 */
app.post('/api/mock/checkin-other', async (req, res) => {
  try {
    const groupId = req.body.groupId || 'mock-group';
    const todayStr = db.getTaipeiDateString();

    const team = await db.getTeamMembers(groupId);
    const checkIns = await db.getTodayCheckIns(groupId, todayStr);
    const checkedUserIds = new Set(checkIns.map((c) => c.user_id));

    const pendingMember = team.find((m) => !checkedUserIds.has(m.user_id));
    if (!pendingMember) {
      return res.json({ success: false, message: '小隊所有成員今日都已經完成打卡囉！' });
    }

    const group = await db.getGroup(groupId);
    const result = await db.recordCheckIn({
      groupId,
      userId: pendingMember.user_id,
      displayName: pendingMember.display_name,
      pictureUrl: pendingMember.picture_url,
      dateStr: todayStr,
      lat: group ? group.target_lat : 25.033964,
      lng: group ? group.target_lng : 121.564468,
      distance: Math.floor(Math.random() * 35) + 10
    });

    res.json({
      success: true,
      message: `已成功模擬隊友 ${pendingMember.display_name} 打卡！`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 測試模式：模擬截止時間過期
 */
app.post('/api/mock/simulate-overdue', async (req, res) => {
  try {
    const groupId = req.body.groupId || 'mock-group';
    // 將截止時間設為 00:01 (確保必定逾期)
    await db.setupGroup(groupId, {
      targetLat: 25.033964,
      targetLng: 121.564468,
      cutoffTime: '00:01'
    });
    res.json({ success: true, message: '已將截止時間模擬設為 00:01 (逾期狀態)' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 測試模式：重設測試資料
 */
app.post('/api/mock/reset', async (req, res) => {
  try {
    const groupId = req.body.groupId || 'mock-group';
    await db.resetMockGroup(groupId);
    res.json({ success: true, message: '測試資料已重設為預設小隊 (3人)' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 系統健康狀態
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    isCloudMode: db.isCloudMode(),
    liffId: LIFF_ID
  });
});

// -------------------------------------------------------------
// Vercel Serverless / 本地環境啟動判斷
// -------------------------------------------------------------
if (require.main === module && (!process.env.VERCEL || process.env.NODE_ENV !== 'production')) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 LINE 打卡連勝系統伺服器已在本地啟動！`);
    console.log(`📡 本地網址: http://localhost:${PORT}`);
    console.log(`🧪 測試模式: http://localhost:${PORT}?mock=true`);
    console.log(`📱 LIFF 網址: ${LIFF_URL}`);
    console.log(`💾 資料庫模式: ${db.isCloudMode() ? '雲端 Supabase' : '本地零設定儲存'}`);
    console.log(`===============================================`);
  });
}

// 供 Vercel Serverless Function 呼叫
module.exports = app;
