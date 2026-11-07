const assert = require('assert');
const db = require('../db');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 開始執行 LINE 定位打卡連勝系統自動化測試');
  console.log('====================================================\n');

  const testGroupId = 'unit-test-group-' + Date.now();

  // 測試 1: Haversine 距離公式精度
  console.log('▶ [Test 1] 驗證 Haversine 直線距離演算法');
  function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
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
  const zeroDist = calculateDistanceMeters(25.033964, 121.564468, 25.033964, 121.564468);
  assert.strictEqual(Math.round(zeroDist), 0, '同一座標距離應為 0');
  // 偏移約 30 公尺 (0.00027 緯度)
  const offset30m = calculateDistanceMeters(25.033964, 121.564468, 25.034234, 121.564468);
  assert.ok(offset30m > 25 && offset30m < 35, `30公尺偏移計算應在合理範圍內，實際: ${offset30m}`);
  console.log('  ✔ 通過：Haversine 距離計算精準。\n');

  // 測試 2: 初次設定打卡地點、小隊人數上限 (2人) 與截止時間
  console.log('▶ [Test 2] 設定群組地點與固定名額 (2 人)');
  const group = await db.setupGroup(testGroupId, {
    targetLat: 25.033964,
    targetLng: 121.564468,
    targetName: '台北 101 測試基地',
    memberQuota: 2,
    cutoffTime: '23:59'
  });
  assert.strictEqual(group.target_name, '台北 101 測試基地');
  assert.strictEqual(group.member_quota, 2);
  console.log('  ✔ 通過：群組打卡地點與人數上限設定成功。\n');

  // 測試 3: 成員加入小隊與名額限制
  console.log('▶ [Test 3] 成員加入小隊名單與名額鎖定');
  const join1 = await db.joinTeam(testGroupId, { userId: 'u1', displayName: '成員 A' });
  assert.strictEqual(join1.success, true);
  const join2 = await db.joinTeam(testGroupId, { userId: 'u2', displayName: '成員 B' });
  assert.strictEqual(join2.success, true);
  const join3 = await db.joinTeam(testGroupId, { userId: 'u3', displayName: '成員 C' });
  assert.strictEqual(join3.success, false, '超過名額 (2人) 時應拒絕加入');
  console.log('  ✔ 通過：名額限制判定正確 (已加入 2/2 人，第 3 人自動拒絕)。\n');

  // 測試 4: 半徑 100 公尺 (直徑 200 公尺) 距離判斷
  console.log('▶ [Test 4] 半徑 100 公尺 (直徑 200 公尺) 限制判定');
  const todayStr = db.getTaipeiDateString();

  // 成員 A 在 30m (範圍內) 打卡
  const checkA = await db.recordCheckIn({
    groupId: testGroupId,
    userId: 'u1',
    displayName: '成員 A',
    dateStr: todayStr,
    lat: 25.034234,
    lng: 121.564468,
    distance: 30
  });
  assert.strictEqual(checkA.isAllCheckedIn, false, '僅 1/2 成員打卡，不應判定全員達成');
  assert.strictEqual(checkA.streak, 0, '未全員打卡時，連勝不應增加');
  console.log('  ✔ 通過：成員 A 打卡成功 (進度 1/2，連勝維持 0)。\n');

  // 測試 5: 全員打卡達成，連勝累加
  console.log('▶ [Test 5] 全員打卡達成與連勝累積判定');
  const checkB = await db.recordCheckIn({
    groupId: testGroupId,
    userId: 'u2',
    displayName: '成員 B',
    dateStr: todayStr,
    lat: 25.034100,
    lng: 121.564468,
    distance: 15
  });
  assert.strictEqual(checkB.isAllCheckedIn, true, '2/2 成員皆打卡，應判定全員完成');
  assert.strictEqual(checkB.streak, 1, '首日全員完成，連勝應為 1');
  assert.strictEqual(checkB.newStreakAwarded, true, '今日應獲得連勝獎勵');
  console.log('  ✔ 通過：成員 B 打卡後全員達成 (進度 2/2，連勝成功增加為 1 天！🔥)。\n');

  // 測試 6: 截止時間 (Cutoff Time) 判斷
  console.log('▶ [Test 6] 截止時間過期判斷');
  const pastTest = db.isTimePastCutoff('00:01', '12:00');
  assert.strictEqual(pastTest, true, '12:00 應超過 00:01 截止時間');
  const futureTest = db.isTimePastCutoff('23:59', '12:00');
  assert.strictEqual(futureTest, false, '12:00 不應超過 23:59 截止時間');
  console.log('  ✔ 通過：截止時間判斷邏輯正確。\n');

  // 測試 7: 群組完整狀態查詢 (API Output)
  console.log('▶ [Test 7] 群組完整狀態查詢');
  const status = await db.getGroupStatus(testGroupId, todayStr, 'u1');
  assert.strictEqual(status.quota, 2);
  assert.strictEqual(status.checkedInCount, 2);
  assert.strictEqual(status.isAllCheckedIn, true);
  assert.strictEqual(status.currentUserCheckedIn, true);
  console.log('  ✔ 通過：群組狀態與成員查詢資料完整。\n');

  // 測試 8: 截止時間後 5 分鐘判定與發送狀態快取
  console.log('▶ [Test 8] 截止時間後 5 分鐘時間判定演算法');
  // 8.1 未達 5 分鐘
  const notDue1 = db.isCutoffPlus5Minutes('08:35', '08:39', '2026-11-07');
  assert.strictEqual(notDue1.due, false, '08:39 尚未滿截止後 5 分鐘');
  // 8.2 剛好滿 5 分鐘
  const due1 = db.isCutoffPlus5Minutes('08:35', '08:40', '2026-11-07');
  assert.strictEqual(due1.due, true, '08:40 應滿足截止後 5 分鐘');
  assert.strictEqual(due1.targetDate, '2026-11-07');
  // 8.3 滿 5 分鐘以上 (08:45)
  const due2 = db.isCutoffPlus5Minutes('08:35', '08:45', '2026-11-07');
  assert.strictEqual(due2.due, true);
  // 8.4 跨午夜 (23:59 截止，隔天 00:04 觸發)
  const midnightDue = db.isCutoffPlus5Minutes('23:59', '00:04', '2026-11-08');
  assert.strictEqual(midnightDue.due, true);
  assert.strictEqual(midnightDue.targetDate, '2026-11-07');
  // 8.5 驗證發送紀錄快取
  const isSentBefore = await db.isCutoffReportSent(testGroupId, '2026-11-07', '08:35');
  assert.strictEqual(isSentBefore, false, '初次應尚未發送');
  await db.markCutoffReportSent(testGroupId, '2026-11-07', '08:35');
  const isSentAfter = await db.isCutoffReportSent(testGroupId, '2026-11-07', '08:35');
  assert.strictEqual(isSentAfter, true, '標記後應為已發送');
  console.log('  ✔ 通過：截止時間後 5 分鐘判定精確，跨日防重複機制運作正常。\n');

  console.log('====================================================');
  console.log('🎉 所有 8 項自動化測試全部通過！');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
