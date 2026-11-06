const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 判定是否啟用雲端 Supabase 資料庫
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const isCloudMode = Boolean(SUPABASE_URL && SUPABASE_KEY);

let supabase = null;
if (isCloudMode) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[Database] 啟用雲端 Supabase 資料庫連線:', SUPABASE_URL);
  } catch (err) {
    console.error('[Database] Supabase 初始化失敗，降級為本地儲存模式:', err.message);
  }
}

// -------------------------------------------------------------
// 本地檔案 / 記憶體儲存 (無 Supabase 時零設定使用)
// -------------------------------------------------------------
const localDataDir = path.join(__dirname, 'data');
const localDbPath = path.join(localDataDir, 'local_db.json');

let memoryDb = {
  groups: {},
  group_members: {}, // key: `${groupId}_${userId}`
  check_ins: []
};

function loadLocalDb() {
  try {
    if (fs.existsSync(localDbPath)) {
      const raw = fs.readFileSync(localDbPath, 'utf-8');
      memoryDb = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('[Database] 本地資料庫檔案讀取失敗，使用記憶體模式:', e.message);
  }
}

function saveLocalDb() {
  try {
    if (!fs.existsSync(localDataDir)) {
      fs.mkdirSync(localDataDir, { recursive: true });
    }
    fs.writeFileSync(localDbPath, JSON.stringify(memoryDb, null, 2), 'utf-8');
  } catch (e) {
    // 唯讀環境 (如 Serverless) 忽略寫入檔案錯誤
  }
}

loadLocalDb();

// -------------------------------------------------------------
// 時間與日期輔助工具 (統一採用 台灣時區 Asia/Taipei)
// -------------------------------------------------------------
function getTaipeiDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date); // 'YYYY-MM-DD'
}

function getTaipeiTimeString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return formatter.format(date); // 'HH:mm'
}

function getYesterdayTaipeiDateString(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return getTaipeiDateString(dt);
}

/**
 * 比較當前時間是否已超過截止時間 (格式 'HH:mm')
 */
function isTimePastCutoff(cutoffTime = '23:59', nowTimeString = getTaipeiTimeString()) {
  if (!cutoffTime) return false;
  const [cutH, cutM] = cutoffTime.split(':').map(Number);
  const [nowH, nowM] = nowTimeString.split(':').map(Number);
  if (nowH > cutH) return true;
  if (nowH === cutH && nowM >= cutM) return true;
  return false;
}

// -------------------------------------------------------------
// 測試模式假資料初始化 (提供零設定即開即測)
// -------------------------------------------------------------
function seedMockData(groupId = 'mock-group') {
  if (!memoryDb.groups[groupId]) {
    memoryDb.groups[groupId] = {
      group_id: groupId,
      target_lat: 25.033964,
      target_lng: 121.564468,
      target_name: '台北 101 打卡點 (測試)',
      member_quota: 3,
      cutoff_time: '23:59',
      current_streak: 1,
      last_streak_date: getYesterdayTaipeiDateString(getTaipeiDateString()),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  const defaultMembers = [
    { user_id: 'mock-user-me', display_name: '我 (測試者)', picture_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=me', is_team_member: true },
    { user_id: 'mock-user-2', display_name: '隊友 小明', picture_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=ming', is_team_member: true },
    { user_id: 'mock-user-3', display_name: '隊友 小華', picture_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=hua', is_team_member: true }
  ];

  defaultMembers.forEach((m) => {
    const key = `${groupId}_${m.user_id}`;
    if (!memoryDb.group_members[key]) {
      memoryDb.group_members[key] = {
        group_id: groupId,
        user_id: m.user_id,
        display_name: m.display_name,
        picture_url: m.picture_url,
        is_team_member: m.is_team_member,
        is_active: true,
        joined_at: new Date().toISOString()
      };
    }
  });

  saveLocalDb();
}

// -------------------------------------------------------------
// 資料庫操作 API (同時支援 Local 與 Supabase)
// -------------------------------------------------------------

async function getGroup(groupId) {
  if (isCloudMode && supabase) {
    const { data, error } = await supabase
      .from('groups')
      .select('*')
      .eq('group_id', groupId)
      .maybeSingle();

    if (error) {
      console.error('[Supabase getGroup Error]', error);
      throw error;
    }
    return data;
  } else {
    if (groupId.startsWith('mock-') && !memoryDb.groups[groupId]) {
      seedMockData(groupId);
    }
    return memoryDb.groups[groupId] || null;
  }
}

/**
 * 設定群組 (打卡地點、名稱、小隊固定名額、每日截止時間)
 */
async function setupGroup(groupId, { targetLat, targetLng, targetName, memberQuota, cutoffTime }) {
  const updatedName = targetName || '打卡基準點';
  const quota = memberQuota ? Math.max(1, parseInt(memberQuota, 10)) : 3;
  const cutoff = cutoffTime || '23:59';
  const now = new Date().toISOString();

  if (isCloudMode && supabase) {
    const { data, error } = await supabase
      .from('groups')
      .upsert({
        group_id: groupId,
        target_lat: Number(targetLat),
        target_lng: Number(targetLng),
        target_name: updatedName,
        member_quota: quota,
        cutoff_time: cutoff,
        updated_at: now
      }, { onConflict: 'group_id' })
      .select()
      .single();

    if (error) {
      console.error('[Supabase setupGroup Error]', error);
      throw error;
    }
    return data;
  } else {
    if (!memoryDb.groups[groupId]) {
      memoryDb.groups[groupId] = {
        group_id: groupId,
        current_streak: 0,
        last_streak_date: null,
        created_at: now
      };
    }
    memoryDb.groups[groupId].target_lat = Number(targetLat);
    memoryDb.groups[groupId].target_lng = Number(targetLng);
    memoryDb.groups[groupId].target_name = updatedName;
    memoryDb.groups[groupId].member_quota = quota;
    memoryDb.groups[groupId].cutoff_time = cutoff;
    memoryDb.groups[groupId].updated_at = now;
    saveLocalDb();
    return memoryDb.groups[groupId];
  }
}

/**
 * 註冊或更新使用者資料
 */
async function upsertMember(groupId, { userId, displayName, pictureUrl, isTeamMember = null }) {
  if (!groupId || !userId) return null;
  const now = new Date().toISOString();

  if (isCloudMode && supabase) {
    const payload = {
      group_id: groupId,
      user_id: userId,
      display_name: displayName || '成員',
      picture_url: pictureUrl || null,
      is_active: true
    };
    if (isTeamMember !== null) {
      payload.is_team_member = Boolean(isTeamMember);
    }
    const { data, error } = await supabase
      .from('group_members')
      .upsert(payload, { onConflict: 'group_id,user_id' })
      .select()
      .single();

    if (error) console.error('[Supabase upsertMember Error]', error);
    return data;
  } else {
    const key = `${groupId}_${userId}`;
    const existing = memoryDb.group_members[key] || {};
    memoryDb.group_members[key] = {
      group_id: groupId,
      user_id: userId,
      display_name: displayName || existing.display_name || '成員',
      picture_url: pictureUrl || existing.picture_url || null,
      is_team_member: isTeamMember !== null ? Boolean(isTeamMember) : (existing.is_team_member ?? false),
      is_active: true,
      joined_at: existing.joined_at || now
    };
    saveLocalDb();
    return memoryDb.group_members[key];
  }
}

/**
 * 加入打卡小隊名額 (固定人數名額制)
 */
async function joinTeam(groupId, { userId, displayName, pictureUrl }) {
  const group = await getGroup(groupId);
  const quota = group ? (group.member_quota || 3) : 3;

  const currentTeam = await getTeamMembers(groupId);
  const alreadyIn = currentTeam.some((m) => m.user_id === userId);

  if (alreadyIn) {
    return { success: true, message: '您已經在打卡小隊名單中！', member: alreadyIn };
  }

  if (currentTeam.length >= quota) {
    return { success: false, message: `小隊名額已滿 (${currentTeam.length}/${quota} 人)！若需加入請先調整名額上限。` };
  }

  const member = await upsertMember(groupId, { userId, displayName, pictureUrl, isTeamMember: true });
  return { success: true, message: `成功加入打卡小隊！(目前 ${currentTeam.length + 1}/${quota} 人)`, member };
}

/**
 * 退出打卡小隊
 */
async function leaveTeam(groupId, userId) {
  if (isCloudMode && supabase) {
    const { data, error } = await supabase
      .from('group_members')
      .update({ is_team_member: false })
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (error) console.error('[Supabase leaveTeam Error]', error);
    return data;
  } else {
    const key = `${groupId}_${userId}`;
    if (memoryDb.group_members[key]) {
      memoryDb.group_members[key].is_team_member = false;
      saveLocalDb();
    }
    return memoryDb.group_members[key];
  }
}

/**
 * 取得群組中所有已加入小隊的成員
 */
async function getTeamMembers(groupId) {
  if (isCloudMode && supabase) {
    const { data, error } = await supabase
      .from('group_members')
      .select('*')
      .eq('group_id', groupId)
      .eq('is_team_member', true)
      .eq('is_active', true)
      .order('joined_at', { ascending: true });

    if (error) {
      console.error('[Supabase getTeamMembers Error]', error);
      return [];
    }
    return data || [];
  } else {
    if (groupId.startsWith('mock-') && Object.keys(memoryDb.group_members).length === 0) {
      seedMockData(groupId);
    }
    return Object.values(memoryDb.group_members).filter(
      (m) => m.group_id === groupId && m.is_team_member && m.is_active
    );
  }
}

/**
 * 取得特定日期之打卡紀錄
 */
async function getTodayCheckIns(groupId, dateStr) {
  if (isCloudMode && supabase) {
    const { data, error } = await supabase
      .from('check_ins')
      .select('*')
      .eq('group_id', groupId)
      .eq('check_in_date', dateStr);

    if (error) {
      console.error('[Supabase getTodayCheckIns Error]', error);
      return [];
    }
    return data || [];
  } else {
    return memoryDb.check_ins.filter(
      (c) => c.group_id === groupId && c.check_in_date === dateStr
    );
  }
}

/**
 * 記錄打卡並重新運算連勝 (兼顧固定名額與截止時間)
 */
async function recordCheckIn({ groupId, userId, displayName, pictureUrl, dateStr, lat, lng, distance }) {
  const now = new Date().toISOString();
  const group = await getGroup(groupId) || {};
  const cutoff = group.cutoff_time || '23:59';
  const nowTimeStr = getTaipeiTimeString();
  const isOnTime = !isTimePastCutoff(cutoff, nowTimeStr);

  // 1. 確保該成員存在群組中，若小隊未滿則自動登記為小隊成員
  const teamMembers = await getTeamMembers(groupId);
  const isInTeam = teamMembers.some((m) => m.user_id === userId);
  const quota = group.member_quota || 3;
  if (!isInTeam && teamMembers.length < quota) {
    await upsertMember(groupId, { userId, displayName, pictureUrl, isTeamMember: true });
  } else {
    await upsertMember(groupId, { userId, displayName, pictureUrl });
  }

  // 2. 儲存打卡紀錄
  let checkInRecord = null;
  if (isCloudMode && supabase) {
    const { data, error } = await supabase
      .from('check_ins')
      .upsert({
        group_id: groupId,
        user_id: userId,
        check_in_date: dateStr,
        check_in_time: now,
        lat: Number(lat),
        lng: Number(lng),
        distance: Number(distance),
        is_on_time: isOnTime
      }, { onConflict: 'group_id,user_id,check_in_date' })
      .select()
      .single();

    if (error) {
      console.error('[Supabase recordCheckIn Error]', error);
      throw error;
    }
    checkInRecord = data;
  } else {
    const existingIdx = memoryDb.check_ins.findIndex(
      (c) => c.group_id === groupId && c.user_id === userId && c.check_in_date === dateStr
    );
    const newRecord = {
      id: Date.now() + Math.random(),
      group_id: groupId,
      user_id: userId,
      check_in_date: dateStr,
      check_in_time: now,
      lat: Number(lat),
      lng: Number(lng),
      distance: Number(distance),
      is_on_time: isOnTime
    };
    if (existingIdx >= 0) {
      memoryDb.check_ins[existingIdx] = newRecord;
    } else {
      memoryDb.check_ins.push(newRecord);
    }
    saveLocalDb();
    checkInRecord = newRecord;
  }

  // 3. 重新計算連勝狀態
  const evaluation = await evaluateAndUpdateStreak(groupId, dateStr);

  return {
    checkIn: checkInRecord,
    isOnTime,
    ...evaluation
  };
}

/**
 * 連勝判定運算核心
 * 規則：
 * 1. 打卡小隊名單人數必須已達 member_quota (滿員才生效)
 * 2. 名額內所有成員皆打卡
 * 3. 需在截止時間前打卡
 */
async function evaluateAndUpdateStreak(groupId, dateStr) {
  const group = await getGroup(groupId) || {
    group_id: groupId,
    current_streak: 0,
    last_streak_date: null,
    member_quota: 3,
    cutoff_time: '23:59'
  };

  const teamMembers = await getTeamMembers(groupId);
  const checkIns = await getTodayCheckIns(groupId, dateStr);
  const checkedUserIds = new Set(checkIns.map((c) => c.user_id));

  const quota = group.member_quota || 3;
  const isTeamFull = teamMembers.length >= quota;

  // 今日名額內成員打卡人數
  const checkedTeamMembers = teamMembers.filter((m) => checkedUserIds.has(m.user_id));
  const checkedInCount = checkedTeamMembers.length;
  const missingMembers = teamMembers.filter((m) => !checkedUserIds.has(m.user_id));

  // 是否全部名額內成員皆已打卡
  const isAllCheckedIn = isTeamFull && (checkedInCount >= quota);

  const yesterdayStr = getYesterdayTaipeiDateString(dateStr);
  const isOverdue = isTimePastCutoff(group.cutoff_time) && !isAllCheckedIn;

  let newStreak = group.current_streak || 0;
  let streakUpdatedToday = false;

  if (isAllCheckedIn) {
    if (group.last_streak_date === dateStr) {
      newStreak = group.current_streak;
    } else if (group.last_streak_date === yesterdayStr) {
      newStreak = (group.current_streak || 0) + 1;
      streakUpdatedToday = true;
    } else {
      newStreak = 1;
      streakUpdatedToday = true;
    }

    if (streakUpdatedToday) {
      await updateGroupStreak(groupId, newStreak, dateStr);
    }
  }

  // 連勝顯示判定
  let displayStreak = newStreak;
  if (!isAllCheckedIn) {
    if (isOverdue) {
      // 逾時且未完成，連勝中斷
      displayStreak = 0;
    } else if (group.last_streak_date === yesterdayStr || group.last_streak_date === dateStr) {
      displayStreak = group.current_streak || 0;
    } else {
      displayStreak = 0;
    }
  }

  return {
    quota,
    isTeamFull,
    teamSize: teamMembers.length,
    checkedInCount,
    isAllCheckedIn,
    isOverdue,
    missingMembers,
    streak: displayStreak,
    streakAchievedToday: isAllCheckedIn && (group.last_streak_date === dateStr || streakUpdatedToday),
    newStreakAwarded: streakUpdatedToday
  };
}

async function updateGroupStreak(groupId, streak, streakDate) {
  const now = new Date().toISOString();
  if (isCloudMode && supabase) {
    await supabase
      .from('groups')
      .upsert({
        group_id: groupId,
        current_streak: streak,
        last_streak_date: streakDate,
        updated_at: now
      }, { onConflict: 'group_id' });
  } else {
    if (!memoryDb.groups[groupId]) memoryDb.groups[groupId] = { group_id: groupId };
    memoryDb.groups[groupId].current_streak = streak;
    memoryDb.groups[groupId].last_streak_date = streakDate;
    memoryDb.groups[groupId].updated_at = now;
    saveLocalDb();
  }
}

/**
 * 取得完整群組狀態 (供 LIFF 前端顯示)
 */
async function getGroupStatus(groupId, dateStr = getTaipeiDateString(), currentUserId = null) {
  let group = await getGroup(groupId);
  if (!group && groupId.startsWith('mock-')) {
    seedMockData(groupId);
    group = await getGroup(groupId);
  }

  const quota = group ? (group.member_quota || 3) : 3;
  const cutoffTime = group ? (group.cutoff_time || '23:59') : '23:59';
  const teamMembers = await getTeamMembers(groupId);
  const checkIns = await getTodayCheckIns(groupId, dateStr);
  const checkInMap = new Map();
  checkIns.forEach((c) => checkInMap.set(c.user_id, c));

  const checkedInCount = teamMembers.filter((m) => checkInMap.has(m.user_id)).length;
  const isTeamFull = teamMembers.length >= quota;
  const isAllCheckedIn = isTeamFull && (checkedInCount >= quota);
  const isOverdue = isTimePastCutoff(cutoffTime) && !isAllCheckedIn;

  const yesterdayStr = getYesterdayTaipeiDateString(dateStr);
  let effectiveStreak = group ? (group.current_streak || 0) : 0;
  if (!isAllCheckedIn) {
    if (isOverdue || (group && group.last_streak_date !== yesterdayStr && group.last_streak_date !== dateStr)) {
      effectiveStreak = 0;
    }
  }

  const membersWithStatus = teamMembers.map((m) => {
    const c = checkInMap.get(m.user_id);
    return {
      userId: m.user_id,
      displayName: m.display_name,
      pictureUrl: m.picture_url,
      hasCheckedIn: Boolean(c),
      checkInTime: c ? c.check_in_time : null,
      distance: c ? c.distance : null,
      isOnTime: c ? c.is_on_time : true,
      isCurrentUser: currentUserId ? m.user_id === currentUserId : false
    };
  });

  const currentUserInTeam = currentUserId ? teamMembers.some((m) => m.user_id === currentUserId) : false;
  const currentUserCheckedIn = currentUserId ? checkInMap.has(currentUserId) : false;
  const missingMembers = teamMembers.filter((m) => !checkInMap.has(m.user_id));

  return {
    groupId,
    target: group && group.target_lat != null && group.target_lng != null ? {
      lat: group.target_lat,
      lng: group.target_lng,
      name: group.target_name || '打卡基準點'
    } : null,
    quota,
    cutoffTime,
    isOverdue,
    streak: effectiveStreak,
    isTeamFull,
    isAllCheckedIn,
    streakAchievedToday: group && group.last_streak_date === dateStr,
    totalMembers: quota,
    teamSize: teamMembers.length,
    checkedInCount,
    today: dateStr,
    nowTime: getTaipeiTimeString(),
    currentUserInTeam,
    currentUserCheckedIn,
    members: membersWithStatus,
    missingMembers: missingMembers.map((m) => m.display_name),
    isCloudMode
  };
}

/**
 * 尋找使用者所屬的真實 LINE 群組 (group_id 以 'C' 開頭)
 */
async function getUserRealGroup(userId) {
  if (!userId) return null;
  if (isCloudMode && supabase) {
    const { data, error } = await supabase
      .from('group_members')
      .select('group_id, joined_at')
      .eq('user_id', userId)
      .like('group_id', 'C%')
      .order('joined_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return null;
    return data[0];
  } else {
    const memberships = Object.values(memoryDb.group_members).filter(
      (m) => m.user_id === userId && m.group_id.startsWith('C')
    );
    if (memberships.length > 0) {
      return memberships[memberships.length - 1];
    }
    return null;
  }
}

/**
 * 取得最近的打卡歷史紀錄
 */
async function getRecentCheckIns(groupId, limit = 10) {
  if (isCloudMode && supabase) {
    const { data, error } = await supabase
      .from('check_ins')
      .select('*')
      .eq('group_id', groupId)
      .order('check_in_time', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Supabase getRecentCheckIns Error]', error);
      return [];
    }
    return data || [];
  } else {
    return memoryDb.check_ins
      .filter((c) => c.group_id === groupId)
      .sort((a, b) => new Date(b.check_in_time) - new Date(a.check_in_time))
      .slice(0, limit);
  }
}

async function resetMockGroup(groupId = 'mock-group') {
  if (isCloudMode && supabase) {
    await supabase.from('check_ins').delete().eq('group_id', groupId);
  }
  delete memoryDb.groups[groupId];
  Object.keys(memoryDb.group_members).forEach((k) => {
    if (k.startsWith(`${groupId}_`)) delete memoryDb.group_members[k];
  });
  memoryDb.check_ins = memoryDb.check_ins.filter((c) => c.group_id !== groupId);
  seedMockData(groupId);
  saveLocalDb();
}

module.exports = {
  isCloudMode: () => Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)),
  isCloud: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)),
  getTaipeiDateString,
  getTaipeiTimeString,
  getYesterdayTaipeiDateString,
  isTimePastCutoff,
  getGroup,
  setupGroup,
  upsertMember,
  joinTeam,
  leaveTeam,
  getTeamMembers,
  getTodayCheckIns,
  recordCheckIn,
  evaluateAndUpdateStreak,
  getGroupStatus,
  resetMockGroup,
  seedMockData,
  getUserRealGroup,
  getRecentCheckIns
};
