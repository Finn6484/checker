// ========================================================
// LINE 定位打卡連勝系統前端應用 (LIFF + GPS 100m 距離演算法)
// ========================================================

const LIFF_ID = '2012424428-3Vg4egq5';

let state = {
  isMockMode: false,
  groupId: 'mock-group',
  user: {
    userId: 'mock-user-me',
    displayName: '我 (測試者)',
    pictureUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=me'
  },
  currentGPS: null,
  groupStatus: null,
  isTrackingGPS: false
};

// Leaflet 地圖實例與圖層
let map = null;
let targetMarker = null;
let targetCircle = null;
let userMarker = null;
let guidanceLine = null;

// -------------------------------------------------------------
// 1. 初始化進入點
// -------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const mockParam = urlParams.get('mock');
  const groupParam = urlParams.get('groupId');

  if (groupParam) state.groupId = groupParam;

  if (mockParam === 'true' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    enableMockMode();
  }

  try {
    await initLiff();
  } catch (err) {
    console.warn('[LIFF Init Warning] LIFF 初始化未在 LINE 內完成，切換至測試模式:', err.message);
    enableMockMode();
  }

  // 取得真實 GPS 定位
  startGPSWatcher();

  // 載入群組打卡狀態
  await fetchStatus();

  // 每一分鐘自動更新時間倒數與狀態
  setInterval(fetchStatus, 60000);
});

// -------------------------------------------------------------
// 2. LIFF SDK 初始化
// -------------------------------------------------------------
async function initLiff() {
  if (typeof liff === 'undefined') {
    enableMockMode();
    return;
  }

  await liff.init({ liffId: LIFF_ID });

  if (liff.isLoggedIn()) {
    const profile = await liff.getProfile();
    state.user.userId = profile.userId;
    state.user.displayName = profile.displayName;
    state.user.pictureUrl = profile.pictureUrl;

    const context = liff.getContext();
    if (context && (context.groupId || context.roomId)) {
      state.groupId = context.groupId || context.roomId;
    }

    renderUserHeader();
  } else if (!state.isMockMode && liff.isInClient()) {
    liff.login();
  } else {
    enableMockMode();
  }
}

function enableMockMode() {
  state.isMockMode = true;
  document.getElementById('mockBanner').classList.remove('hidden');
  renderUserHeader();
}

function renderUserHeader() {
  document.getElementById('userName').innerText = state.user.displayName || '訪客';
  if (state.user.pictureUrl) {
    document.getElementById('userAvatar').src = state.user.pictureUrl;
  }
  document.getElementById('groupSubtitle').innerText = `群組 ID: ${state.groupId.substring(0, 10)}...`;
}

// -------------------------------------------------------------
// 3. GPS 定位與距離計算 (Haversine Formula)
// -------------------------------------------------------------
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

function startGPSWatcher() {
  if (!navigator.geolocation) {
    showToast('❌ 瀏覽器不支援 GPS 定位功能', 'error');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    onGPSSuccess,
    (err) => {
      console.warn('GPS 讀取失敗，使用預設測試位置:', err.message);
      // 若失敗或測試中，提供台北 101 近距離預設
      if (state.isMockMode && !state.currentGPS) {
        mockSetLocation(true);
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function refreshGPS(manual = false) {
  const icon = document.getElementById('refreshIcon');
  if (icon) icon.classList.add('animate-spin');

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onGPSSuccess(pos);
        if (icon) icon.classList.remove('animate-spin');
        if (manual) showToast('📍 GPS 定位已更新', 'success');
      },
      (err) => {
        if (icon) icon.classList.remove('animate-spin');
        if (manual) showToast('⚠️ GPS 更新失敗: ' + err.message, 'warning');
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }
}

function onGPSSuccess(position) {
  state.currentGPS = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: Math.round(position.coords.accuracy)
  };

  document.getElementById('currentCoords').innerText = `${state.currentGPS.lat.toFixed(5)}, ${state.currentGPS.lng.toFixed(5)}`;
  document.getElementById('gpsAccuracy').innerText = `精確度: ±${state.currentGPS.accuracy}m`;

  updateDistanceAndUI();
}

// -------------------------------------------------------------
// 4. API 狀態獲取與畫面渲染
// -------------------------------------------------------------
async function fetchStatus() {
  try {
    const res = await fetch(`/api/status?groupId=${encodeURIComponent(state.groupId)}&userId=${encodeURIComponent(state.user.userId)}`);
    const json = await res.json();
    if (json.success) {
      state.groupStatus = json.data;
      renderStatus();
    }
  } catch (e) {
    console.error('[fetchStatus error]', e);
  }
}

function renderStatus() {
  const s = state.groupStatus;
  if (!s) return;

  // 1. 連勝天數與狀態
  document.getElementById('streakCount').innerText = s.streak || 0;
  const streakBadge = document.getElementById('streakStatusText');
  if (s.isAllCheckedIn) {
    streakBadge.innerText = '🎉 今日全員達成！';
    streakBadge.className = 'text-xs font-bold bg-emerald-800 text-emerald-100 px-2.5 py-0.5 rounded-full';
  } else if (s.isOverdue) {
    streakBadge.innerText = '⚠️ 今日已逾期中斷';
    streakBadge.className = 'text-xs font-bold bg-rose-900 text-rose-100 px-2.5 py-0.5 rounded-full';
  } else {
    streakBadge.innerText = `進行中 (${s.checkedInCount}/${s.quota}人)`;
    streakBadge.className = 'text-xs font-semibold bg-black/20 px-2 py-0.5 rounded-full';
  }

  // 截止時間
  document.getElementById('cutoffDisplay').innerText = s.cutoffTime || '23:59';
  const cutoffBadge = document.getElementById('cutoffStatusBadge');
  if (s.isOverdue) {
    cutoffBadge.innerText = '已逾期 (連勝中斷)';
    cutoffBadge.className = 'font-bold text-rose-200';
  } else if (s.isAllCheckedIn) {
    cutoffBadge.innerText = '全體已準時完成';
    cutoffBadge.className = 'font-bold text-emerald-200';
  } else {
    cutoffBadge.innerText = `進行中 (剩餘待打卡: ${Math.max(0, s.quota - s.checkedInCount)}人)`;
    cutoffBadge.className = 'font-bold text-amber-200';
  }

  // 進度條
  const percent = s.quota > 0 ? Math.min(100, Math.round((s.checkedInCount / s.quota) * 100)) : 0;
  document.getElementById('progressBar').style.width = `${percent}%`;
  document.getElementById('progressRatio').innerText = `${s.checkedInCount} / ${s.quota} 人 (${percent}%)`;

  // 2. 打卡小隊名額與成員列表
  document.getElementById('teamQuotaSubtitle').innerText = `固定名額：${s.quota} 人 (目前已登記 ${s.teamSize}/${s.quota} 人)`;
  const joinBtn = document.getElementById('joinTeamBtn');
  const leaveBtn = document.getElementById('leaveTeamBtn');

  if (s.currentUserInTeam) {
    joinBtn.classList.add('hidden');
    leaveBtn.classList.remove('hidden');
  } else {
    leaveBtn.classList.add('hidden');
    if (s.teamSize >= s.quota) {
      joinBtn.classList.remove('hidden');
      joinBtn.innerText = '名額已滿';
      joinBtn.disabled = true;
      joinBtn.className = 'text-xs bg-slate-400 text-white font-bold px-2.5 py-1.5 rounded-xl cursor-not-allowed';
    } else {
      joinBtn.classList.remove('hidden');
      joinBtn.innerText = '➕ 加入小隊';
      joinBtn.disabled = false;
      joinBtn.className = 'text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2.5 py-1.5 rounded-xl shadow-sm transition';
    }
  }

  // 成員名單
  const membersListEl = document.getElementById('membersList');
  if (!s.members || s.members.length === 0) {
    membersListEl.innerHTML = `<div class="py-4 text-center text-xs text-slate-400">目前尚無成員加入小隊，點擊右上角「加入小隊」登記名額！</div>`;
  } else {
    membersListEl.innerHTML = s.members.map((m) => {
      const isMe = m.userId === state.user.userId;
      const avatar = m.pictureUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(m.userId)}`;
      const timeStr = m.checkInTime ? new Date(m.checkInTime).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '';

      return `
        <div class="py-2.5 flex items-center justify-between">
          <div class="flex items-center space-x-2.5">
            <img src="${avatar}" class="w-8 h-8 rounded-full border border-slate-200">
            <div>
              <div class="text-xs font-bold text-slate-800 flex items-center space-x-1">
                <span>${escapeHtml(m.displayName)}</span>
                ${isMe ? '<span class="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded">你</span>' : ''}
              </div>
              <div class="text-[10px] text-slate-400">
                ${m.hasCheckedIn ? `於 ${timeStr} 打卡 (距離基準點 ${m.distance || 0}m)` : (s.isOverdue ? '<span class="text-rose-500 font-bold">逾期未打卡</span>' : '尚未打卡')}
              </div>
            </div>
          </div>
          <div>
            ${m.hasCheckedIn
              ? '<span class="text-xs bg-emerald-100 text-emerald-700 font-bold px-2.5 py-1 rounded-full flex items-center space-x-1"><span>✅</span><span>已打卡</span></span>'
              : (s.isOverdue
                ? '<span class="text-xs bg-rose-100 text-rose-700 font-bold px-2 py-0.5 rounded-full">未打卡</span>'
                : '<span class="text-xs bg-slate-100 text-slate-500 font-medium px-2 py-0.5 rounded-full">等待中</span>')
            }
          </div>
        </div>
      `;
    }).join('');
  }

  // 3. 地點卡片
  if (s.target) {
    document.getElementById('targetSetView').classList.remove('hidden');
    document.getElementById('targetNotSetView').classList.add('hidden');
    document.getElementById('targetLocationName').innerText = s.target.name || '打卡基準點';
    document.getElementById('targetCoordinates').innerText = `緯度: ${Number(s.target.lat).toFixed(6)}, 經度: ${Number(s.target.lng).toFixed(6)}`;
  } else {
    document.getElementById('targetSetView').classList.add('hidden');
    document.getElementById('targetNotSetView').classList.remove('hidden');
  }

  updateDistanceAndUI();
}

function updateDistanceAndUI() {
  const s = state.groupStatus;
  const gps = state.currentGPS;

  const btn = document.getElementById('checkInBtn');
  const btnText = document.getElementById('checkInBtnText');
  const btnIcon = document.getElementById('checkInBtnIcon');
  const distEl = document.getElementById('currentDistance');
  const badgeEl = document.getElementById('distanceBadge');

  if (!s || !s.target) {
    distEl.innerText = '--';
    badgeEl.innerText = '⚠️ 尚未設定打卡基準地點';
    badgeEl.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 mt-1';
    btn.disabled = true;
    btn.className = 'w-full py-4 rounded-2xl font-bold text-base shadow transition bg-slate-300 text-slate-500 cursor-not-allowed';
    btnText.innerText = '請先設定打卡地點';
    btnIcon.innerText = '⚙️';
    return;
  }

  if (!gps) {
    distEl.innerText = '--';
    badgeEl.innerText = '📡 等待 GPS 衛星定位中...';
    badgeEl.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-slate-200 text-slate-700 mt-1';
    btn.disabled = true;
    btn.className = 'w-full py-4 rounded-2xl font-bold text-base shadow transition bg-slate-300 text-slate-500 cursor-not-allowed';
    btnText.innerText = '正在獲取定位...';
    btnIcon.innerText = '📡';
    return;
  }

  // 計算距離
  const distMeters = calculateDistanceMeters(gps.lat, gps.lng, s.target.lat, s.target.lng);
  const rounded = Math.round(distMeters);
  distEl.innerText = rounded;

  const inRange = rounded <= 100;

  if (inRange) {
    badgeEl.innerText = `🎯 距離 ${rounded} 公尺 (在 100m 範圍內，允許打卡)`;
    badgeEl.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 mt-1';
  } else {
    badgeEl.innerText = `🚫 距離 ${rounded} 公尺 (超出 100m 範圍，不可打卡)`;
    badgeEl.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 mt-1';
  }

  // 更新即時 GPS 小地圖與虛線指引
  updateRadarMap(s.target.lat, s.target.lng, s.target.name, gps.lat, gps.lng, inRange, rounded);

  // 打卡按鈕邏輯判斷
  if (s.currentUserCheckedIn) {
    btn.disabled = true;
    btn.className = 'w-full py-4 rounded-2xl font-bold text-base shadow transition bg-emerald-100 text-emerald-800 cursor-default';
    btnText.innerText = '✅ 今日您已完成打卡';
    btnIcon.innerText = '🎉';
  } else if (!s.currentUserInTeam) {
    btn.disabled = true;
    btn.className = 'w-full py-4 rounded-2xl font-bold text-base shadow transition bg-slate-200 text-slate-500 cursor-not-allowed';
    btnText.innerText = '請先點選上方「加入小隊」登記名額';
    btnIcon.innerText = '👥';
  } else if (s.isOverdue) {
    btn.disabled = true;
    btn.className = 'w-full py-4 rounded-2xl font-bold text-base shadow transition bg-rose-100 text-rose-700 cursor-not-allowed';
    btnText.innerText = `已超過今日截止時間 (${s.cutoffTime})`;
    btnIcon.innerText = '⏰';
  } else if (!inRange) {
    btn.disabled = true;
    btn.className = 'w-full py-4 rounded-2xl font-bold text-base shadow transition bg-slate-200 text-slate-500 cursor-not-allowed';
    btnText.innerText = `距離打卡點還有 ${rounded} 公尺 (需 <100m)`;
    btnIcon.innerText = '🚫';
  } else {
    // 允許打卡！
    btn.disabled = false;
    btn.className = 'w-full py-4 rounded-2xl font-bold text-base shadow-lg transition bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer pulse-active';
    btnText.innerText = '📍 立即打卡';
    btnIcon.innerText = '✅';
  }
}

// -------------------------------------------------------------
// 4.1 即時 GPS 小地圖與虛線指引 (Leaflet)
// -------------------------------------------------------------
function updateRadarMap(targetLat, targetLng, targetName, userLat, userLng, inRange, roundedDistance) {
  if (typeof L === 'undefined') return;

  const mapEl = document.getElementById('radarMap');
  if (!mapEl) return;

  const targetLatLng = [targetLat, targetLng];
  const userLatLng = [userLat, userLng];

  // 1. 初始化地圖
  if (!map) {
    map = L.map('radarMap', {
      zoomControl: true,
      attributionControl: false
    }).setView(targetLatLng, 17);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);
  }

  // 2. 打卡基準點 Marker & 100m 範圍圓
  const targetIcon = L.divIcon({
    className: 'custom-target-pin',
    html: `<div style="background-color:#10B981; color:#fff; font-weight:bold; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,0.3); border:2px solid #fff; font-size:15px;">📍</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

  if (!targetMarker) {
    targetMarker = L.marker(targetLatLng, { icon: targetIcon })
      .bindPopup(`<b>📍 ${escapeHtml(targetName || '打卡基準點')}</b><br>半徑 100 公尺打卡範圍`)
      .addTo(map);
  } else {
    targetMarker.setLatLng(targetLatLng);
    if (targetMarker.getPopup()) {
      targetMarker.getPopup().setContent(`<b>📍 ${escapeHtml(targetName || '打卡基準點')}</b><br>半徑 100 公尺打卡範圍`);
    }
  }

  if (!targetCircle) {
    targetCircle = L.circle(targetLatLng, {
      radius: 100,
      color: '#10B981',
      weight: 2,
      dashArray: '5, 5',
      fillColor: '#10B981',
      fillOpacity: 0.15
    }).addTo(map);
  } else {
    targetCircle.setLatLng(targetLatLng);
  }

  // 3. 使用者目前 GPS 位置 Marker (帶藍色發光脈衝)
  const userIcon = L.divIcon({
    className: 'user-gps-marker',
    html: `<div class="user-gps-pulse"></div><div class="user-gps-dot"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  if (!userMarker) {
    userMarker = L.marker(userLatLng, { icon: userIcon })
      .bindPopup(`<b>👤 你的目前位置</b><br>距離基準點 ${roundedDistance} 公尺`)
      .addTo(map);
  } else {
    userMarker.setLatLng(userLatLng);
    if (userMarker.getPopup()) {
      userMarker.getPopup().setContent(`<b>👤 你的目前位置</b><br>距離基準點 ${roundedDistance} 公尺 (${inRange ? '在範圍內' : '超出範圍'})`);
    }
  }

  // 4. 虛線指引線 (Guidance Dashed Line)
  const lineColor = inRange ? '#10B981' : '#EF4444';
  if (!guidanceLine) {
    guidanceLine = L.polyline([userLatLng, targetLatLng], {
      color: lineColor,
      weight: 3.5,
      dashArray: '6, 8',
      opacity: 0.9
    }).addTo(map);
  } else {
    guidanceLine.setLatLngs([userLatLng, targetLatLng]);
    guidanceLine.setStyle({ color: lineColor });
  }

  // 5. 更新地圖懸浮距離標籤
  const mapBadgeText = document.getElementById('mapDistanceText');
  if (mapBadgeText) {
    mapBadgeText.innerText = `${roundedDistance}m ${inRange ? '✅ 在 100m 內' : '🚫 超出 100m'}`;
  }

  // 6. 自動調整視野包含目標點、100m 圓形與使用者
  try {
    const bounds = L.featureGroup([targetCircle, userMarker]).getBounds();
    map.fitBounds(bounds, { padding: [35, 35], maxZoom: 18 });
    setTimeout(() => { if (map) map.invalidateSize(); }, 150);
  } catch (err) {}
}

// -------------------------------------------------------------
// 5. 使用者操作事件 (打卡、加入小隊、設定地點)
// -------------------------------------------------------------

async function performCheckIn() {
  if (!state.currentGPS) {
    showToast('⚠️ 尚未取得 GPS 座標', 'warning');
    return;
  }

  const btn = document.getElementById('checkInBtn');
  btn.disabled = true;
  document.getElementById('checkInBtnText').innerText = '打卡驗證中...';

  try {
    const res = await fetch('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: state.groupId,
        userId: state.user.userId,
        displayName: state.user.displayName,
        pictureUrl: state.user.pictureUrl,
        lat: state.currentGPS.lat,
        lng: state.currentGPS.lng
      })
    });

    const json = await res.json();
    if (res.ok && json.success) {
      showToast(json.message, 'success');

      if (json.isAllCheckedIn) {
        // 慶祝彩帶！
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 }
        });
      }
      await fetchStatus();
    } else {
      showToast(json.message || '打卡失敗', 'error');
      await fetchStatus();
    }
  } catch (err) {
    showToast('網路連線失敗: ' + err.message, 'error');
    await fetchStatus();
  }
}

async function handleJoinTeam() {
  try {
    const res = await fetch('/api/member/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: state.groupId,
        userId: state.user.userId,
        displayName: state.user.displayName,
        pictureUrl: state.user.pictureUrl
      })
    });
    const json = await res.json();
    if (res.ok && json.success) {
      showToast(json.message, 'success');
      await fetchStatus();
    } else {
      showToast(json.message || '加入小隊失敗', 'warning');
    }
  } catch (e) {
    showToast('加入失敗: ' + e.message, 'error');
  }
}

async function handleLeaveTeam() {
  if (!confirm('確定要退出打卡小隊嗎？')) return;
  try {
    const res = await fetch('/api/member/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: state.groupId,
        userId: state.user.userId
      })
    });
    const json = await res.json();
    if (json.success) {
      showToast('已退出打卡小隊', 'info');
      await fetchStatus();
    }
  } catch (e) {
    showToast('退出失敗: ' + e.message, 'error');
  }
}

// -------------------------------------------------------------
// 6. 設定 Modal (打卡地點、名額上限、每日截止時間)
// -------------------------------------------------------------
function promptEditSettings() {
  const modal = document.getElementById('settingsModal');
  const s = state.groupStatus;

  if (s) {
    if (s.target) {
      document.getElementById('modalTargetName').value = s.target.name || '';
      document.getElementById('modalTargetLat').value = s.target.lat || '';
      document.getElementById('modalTargetLng').value = s.target.lng || '';
    }
    document.getElementById('modalMemberQuota').value = s.quota || 3;
    document.getElementById('modalCutoffTime').value = s.cutoffTime || '23:59';
  }

  modal.classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

function fillModalWithCurrentGPS() {
  if (state.currentGPS) {
    document.getElementById('modalTargetLat').value = state.currentGPS.lat.toFixed(6);
    document.getElementById('modalTargetLng').value = state.currentGPS.lng.toFixed(6);
    showToast('已帶入目前 GPS 座標！', 'success');
  } else {
    showToast('尚未取得 GPS 定位，請稍候再試', 'warning');
  }
}

async function submitGroupSettings() {
  const name = document.getElementById('modalTargetName').value.trim() || '打卡基準點';
  const lat = parseFloat(document.getElementById('modalTargetLat').value);
  const lng = parseFloat(document.getElementById('modalTargetLng').value);
  const quota = parseInt(document.getElementById('modalMemberQuota').value, 10) || 3;
  const cutoff = document.getElementById('modalCutoffTime').value || '23:59';

  if (isNaN(lat) || isNaN(lng)) {
    showToast('請填寫正確的經緯度座標', 'error');
    return;
  }

  try {
    const res = await fetch('/api/group/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: state.groupId,
        targetLat: lat,
        targetLng: lng,
        targetName: name,
        memberQuota: quota,
        cutoffTime: cutoff
      })
    });

    const json = await res.json();
    if (json.success) {
      showToast('群組設定已成功儲存！', 'success');
      closeSettingsModal();
      await fetchStatus();
    } else {
      showToast(json.message || '儲存失敗', 'error');
    }
  } catch (err) {
    showToast('儲存失敗: ' + err.message, 'error');
  }
}

// -------------------------------------------------------------
// 7. 測試工具 (Mock Controls)
// -------------------------------------------------------------
function toggleMockPanel() {
  const panel = document.getElementById('mockPanel');
  panel.classList.toggle('hidden');
}

function mockSetLocation(inRange) {
  // 基準點: 台北 101 (25.033964, 121.564468)
  if (inRange) {
    // 偏移 ~30 公尺
    state.currentGPS = {
      lat: 25.033964 + 0.00025,
      lng: 121.564468 + 0.0001,
      accuracy: 5
    };
    showToast('🎯 已模擬 GPS 在半徑 100m 範圍內 (約 30m)', 'success');
  } else {
    // 偏移 ~250 公尺
    state.currentGPS = {
      lat: 25.033964 + 0.0022,
      lng: 121.564468 + 0.0015,
      accuracy: 10
    };
    showToast('🚫 已模擬 GPS 在範圍外 (約 250m)', 'info');
  }

  document.getElementById('currentCoords').innerText = `${state.currentGPS.lat.toFixed(5)}, ${state.currentGPS.lng.toFixed(5)} (模擬)`;
  document.getElementById('gpsAccuracy').innerText = `精確度: ±${state.currentGPS.accuracy}m`;
  updateDistanceAndUI();
}

async function mockTeammateCheckin() {
  try {
    const res = await fetch('/api/mock/checkin-other', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: state.groupId })
    });
    const json = await res.json();
    showToast(json.message, json.success ? 'success' : 'info');
    await fetchStatus();
    if (json.data && json.data.isAllCheckedIn) {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    }
  } catch (e) {
    showToast('模擬隊友打卡失敗', 'error');
  }
}

async function mockSimulateOverdue() {
  try {
    const res = await fetch('/api/mock/simulate-overdue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: state.groupId })
    });
    const json = await res.json();
    showToast(json.message, 'warning');
    await fetchStatus();
  } catch (e) {
    showToast('模擬逾期失敗', 'error');
  }
}

async function mockResetData() {
  try {
    const res = await fetch('/api/mock/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: state.groupId })
    });
    const json = await res.json();
    showToast(json.message, 'info');
    await fetchStatus();
  } catch (e) {
    showToast('重設失敗', 'error');
  }
}

// -------------------------------------------------------------
// 8. 輔助工具 (Toast & Escape)
// -------------------------------------------------------------
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toastIcon');
  const text = document.getElementById('toastMsg');

  text.innerText = msg;

  if (type === 'success') {
    icon.innerText = '✅';
    toast.className = 'fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full text-xs font-bold shadow-lg bg-emerald-600 text-white flex items-center space-x-2 transition-all duration-300 opacity-100';
  } else if (type === 'error') {
    icon.innerText = '❌';
    toast.className = 'fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full text-xs font-bold shadow-lg bg-rose-600 text-white flex items-center space-x-2 transition-all duration-300 opacity-100';
  } else if (type === 'warning') {
    icon.innerText = '⚠️';
    toast.className = 'fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full text-xs font-bold shadow-lg bg-amber-600 text-white flex items-center space-x-2 transition-all duration-300 opacity-100';
  } else {
    icon.innerText = 'ℹ️';
    toast.className = 'fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full text-xs font-bold shadow-lg bg-slate-800 text-white flex items-center space-x-2 transition-all duration-300 opacity-100';
  }

  setTimeout(() => {
    toast.className = 'fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full text-xs font-bold shadow-lg transition-all duration-300 opacity-0 pointer-events-none flex items-center space-x-2';
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
