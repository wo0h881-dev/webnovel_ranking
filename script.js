// =======================
// 설정
// =======================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyuDzAA3z1R4GwEj2M6lTu1uygGEtHYEj_GQ1f0NSJhTUaYiqgJOgRpYfpYRlrphIMOLQ/exec"; // 기존에 쓰던 URL

// 통합 / 네이버 / 카카오 데이터
let totalItems = [];   // 통합 시트 (통합용)
let naverRaw = [];     // 네이버 시트 원본 TOP20
let kakaoRaw = [];     // 카카오 시트 원본 TOP20

// 통합 랭킹 계산 결과 (TOP40)
let combinedItems = [];

// "1,307만", "7억 3,316만" → 숫자로 변환
function parseViews(text) {
  if (!text) return 0;
  const t = String(text).replace(/,/g, "").trim();

  let eok = 0;
  let man = 0;

  const eokMatch = t.match(/(\d+)억/);
  const manMatch = t.match(/(\d+)만/);

  if (eokMatch) eok = parseInt(eokMatch[1], 10);
  if (manMatch) man = parseInt(manMatch[1], 10);

  // "12345"처럼 그냥 숫자만 있을 때
  if (!eokMatch && !manMatch) {
    const numMatch = t.match(/\d+/);
    return numMatch ? parseInt(numMatch[0], 10) : 0;
  }

  return eok * 100_000_000 + man * 10_000;
}

// 1위 → 20점, 20위 → 1점
function rankToScore(rank) {
  rank = Number(rank);
  if (!rank) return 0;
  return 21 - rank;
}

// =======================
// 통합 랭킹 계산 (하단 통합 + 상단 전체 기반)
// =======================
// totalItems (통합 시트 JSON) 기준
// 헤더: ["출처","오늘순위","제목","작가","날짜","장르","오늘조회수",
//        "전일순위","전일조회수","순위변화","조회수증감","조회수증감률","썸네일"]
function buildCombinedRanking(items) {
  const enriched = items.map((it) => {
    const platformRaw = String(it["출처"] || "").trim();
    let platform = platformRaw.toLowerCase();

    // 시트 값이 "네이버", "카카오" 같은 한글일 경우 매핑
    if (platform === "네이버") platform = "naver";
    if (platform === "카카오" || platform === "카카오페이지") platform = "kakao";

    const platformRank = Number(it["오늘순위"] || 0);

    return {
      ...it,
      _platform: platform,                 // "naver" 또는 "kakao"
      _platformRank: platformRank,         // 오늘 순위 (숫자)
      _score: rankToScore(platformRank),
      _viewsNum: parseViews(it["오늘조회수"]), // 오늘 조회수 숫자
    };
  });

  // 1순위: score 내림차순, 2순위: 조회수 내림차순
  enriched.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return b._viewsNum - a._viewsNum;
  });

  // 통합 순위 부여
  enriched.forEach((it, idx) => {
    it._combinedRank = idx + 1;
  });

  // TOP 40까지만 사용
  return enriched.slice(0, 40);
}

// =======================
// 상단 박스오피스
// =======================

// 상단 전체 탭: 하단 통합과 같은 로직으로 계산된 통합 랭킹 중 TOP10만 사용
function buildDailyTop10FromCombined() {
  if (!combinedItems || combinedItems.length === 0) return [];
  const top10 = combinedItems.slice(0, 10).map((it, idx) => ({
    ...it,
    _localRank: idx + 1, // 상단에서 보여줄 1~10위
  }));
  return top10;
}

// 네이버/카카오 원본에서 플랫폼별 TOP10 생성
// rawList: 네이버 또는 카카오 시트 JSON
// 구조: ["날짜","출처","순위","제목","작가","장르","조회수","썸네일"]
function buildPlatformTop10(rawList) {
  const sorted = [...rawList].sort(
    (a, b) => Number(a["순위"] || 0) - Number(b["순위"] || 0)
  );
  return sorted.slice(0, 10).map((it, idx) => ({
    ...it,
    _localRank: idx + 1,             // 1~10
    _viewsNum: parseViews(it["조회수"])
  }));
}

// 상단: 일별 박스오피스 테이블 렌더링
function renderDailyTable() {
  const tbody = document.getElementById("daily-tbody");
  if (!tbody) return;

  const sourceSel = document.getElementById("source-filter");
  const sourceFilter = sourceSel ? sourceSel.value : "all"; // all/naver/kakao

  let top10 = [];

  if (sourceFilter === "all") {
    // 상단 전체: 하단 통합 탭과 같은 통합 랭킹 기준 TOP10
    top10 = buildDailyTop10FromCombined();
  } else if (sourceFilter === "naver") {
    // 상단 네이버: 네이버 원본 TOP20에서 1~10
    top10 = buildPlatformTop10(naverRaw);
  } else if (sourceFilter === "kakao") {
    // 상단 카카오: 카카오 원본 TOP20에서 1~10
    top10 = buildPlatformTop10(kakaoRaw);
  }

  tbody.innerHTML = "";

  top10.forEach((item) => {
    const tr = document.createElement("tr");

    let platformLabel = "";
    let todayRank = "";
    let prevRank = "";
    let rankDiff = "-";
    let todayViews = "-";
    let viewDiff = "";
    let viewRate = "";
    let thumbUrl = "";

    if (sourceFilter === "all") {
      // 통합 시트 기반
      platformLabel = String(item["출처"] || "");
      todayRank     = item._localRank ?? item["오늘순위"] ?? "";
      prevRank      = item["전일순위"] ?? "";
      rankDiff      = item["순위변화"] || "-";
      todayViews    = item["오늘조회수"] || "-";
      viewDiff      = item["조회수증감"] || "";
      viewRate      = item["조회수증감률"] || "";
      thumbUrl      = item["썸네일"] && String(item["썸네일"]).trim();
    } else {
      // 원본 시트 기반 (네이버 / 카카오)
      platformLabel = sourceFilter === "naver" ? "네이버" : "카카오";
      todayRank     = item._localRank ?? item["순위"] ?? "";
      prevRank      = "-"; // 원본 시트에는 전일 데이터 없음
      rankDiff      = "-";
      todayViews    = item["조회수"] || "-";
      viewDiff      = "";
      viewRate      = "";
      thumbUrl      = item["썸네일"] && String(item["썸네일"]).trim();
    }

    const thumbHtml = thumbUrl
      ? `<img src="${thumbUrl}" alt="" class="daily-thumb-img">`
      : `<span class="daily-thumb-placeholder">No</span>`;

    const isNaver = platformLabel.indexOf("네이버") !== -1 || platformLabel.toLowerCase().indexOf("naver") !== -1;
    const platformClass = isNaver ? "badge-platform-naver" : "badge-platform-kakao";
    const platformText  = isNaver ? "네이버" : "카카오";

    tr.innerHTML = `
      <td class="daily-thumb-cell">${thumbHtml}</td>
      <td>${todayRank}</td>
      <td>${sourceFilter === "all" ? item["제목"] : item["제목"]}</td>
      <td>${sourceFilter === "all" ? item["작가"] : item["작가"]}</td>
      <td><span class="badge ${platformClass}">${sourceFilter === "all" ? platformText : platformText}</span></td>
      <td>${todayViews}</td>
      <td>${prevRank || "-"}</td>
      <td>${rankDiff}</td>
      <td>${viewDiff || viewRate ? `${viewDiff} ${viewRate}` : "-"}</td>
    `;
    tbody.appendChild(tr);
  });
}

// =======================
// 하단 카드 영역
// =======================

// 하단 통합 카드용 DOM 생성
function createCard(item, rank) {
  const div = document.createElement("div");
  div.className = "card";

  const platformLabel = item._platform === "naver" ? "네이버" : "카카오";
  const platformBadgeClass =
    item._platform === "naver" ? "badge-platform-naver" : "badge-platform-kakao";

  const thumbUrl = item["썸네일"] && String(item["썸네일"]).trim();
  const thumbHtml = thumbUrl
    ? `<img src="${thumbUrl}" alt="">`
    : `<span>썸네일 없음</span>`;

  const todayRank = item._platformRank ?? item["오늘순위"] ?? "";
  const prevRank = item["전일순위"] ?? "";
  const rankDiff = item["순위변화"] || "-";
  const todayViews = item["오늘조회수"] || "-";
  const prevViews = item["전일조회수"] || "-";
  const viewDiff = item["조회수증감"] || "";
  const viewRate = item["조회수증감률"] || "";

  div.innerHTML = `
    <div class="card-rank">${rank}</div>
    <div class="card-thumb">${thumbHtml}</div>
    <div class="card-body">
      <div class="card-title">${item["제목"]}</div>
      <div class="card-author">${item["작가"]}</div>
      <div class="card-meta">
        <span class="badge ${platformBadgeClass}">${platformLabel}</span>
        <span class="badge">${item["장르"] || "장르 미상"}</span>
        <span class="badge">${item["날짜"] || ""}</span>
      </div>
      <div class="card-footer">
        ${platformLabel} 오늘 ${todayRank}위
        ${prevRank ? `(전일 ${prevRank}위, ${rankDiff})` : ""}
        · 조회수 ${todayViews}
        ${viewDiff || viewRate ? ` (전일 ${prevViews}, ${viewDiff} / ${viewRate})` : ""}
      </div>
    </div>
  `;

  return div;
}

// 하단 네이버/카카오 카드용 DOM (원본 TOP20)
function createRawCard(item, rank, platform) {
  const div = document.createElement("div");
  div.className = "card";

  const platformLabel = platform === "naver" ? "네이버" : "카카오";
  const platformBadgeClass =
    platform === "naver" ? "badge-platform-naver" : "badge-platform-kakao";

  const thumbUrl = item["썸네일"] && String(item["썸네일"]).trim();
  const thumbHtml = thumbUrl
    ? `<img src="${thumbUrl}" alt="">`
    : `<span>썸네일 없음</span>`;

  const todayRank = rank;
  const todayViews = item["조회수"] || "-";

  div.innerHTML = `
    <div class="card-rank">${rank}</div>
    <div class="card-thumb">${thumbHtml}</div>
    <div class="card-body">
      <div class="card-title">${item["제목"]}</div>
      <div class="card-author">${item["작가"]}</div>
      <div class="card-meta">
        <span class="badge ${platformBadgeClass}">${platformLabel}</span>
        <span class="badge">${item["장르"] || "웹소설"}</span>
        <span class="badge">${item["날짜"] || ""}</span>
      </div>
      <div class="card-footer">
        ${platformLabel} 오늘 ${todayRank}위 · 조회수 ${todayViews}
      </div>
    </div>
  `;

  return div;
}

// 하단 카드 렌더링
// filter: all / naver / kakao
function renderCards(filter) {
  const grid = document.getElementById("card-grid");
  if (!grid) return;
  grid.innerHTML = "";

  if (filter === "all") {
    // 통합 TOP40 그대로 (_combinedRank 기준)
    combinedItems.forEach((item) => {
      const card = createCard(item, item._combinedRank);
      grid.appendChild(card);
    });
  } else if (filter === "naver") {
    // 네이버 원본 TOP20 → 1~20
    const sorted = [...naverRaw].sort(
      (a, b) => Number(a["순위"] || 0) - Number(b["순위"] || 0)
    );
    sorted.slice(0, 20).forEach((item, idx) => {
      const card = createRawCard(item, idx + 1, "naver");
      grid.appendChild(card);
    });
  } else if (filter === "kakao") {
    // 카카오 원본 TOP20 → 1~20
    const sorted = [...kakaoRaw].sort(
      (a, b) => Number(a["순위"] || 0) - Number(b["순위"] || 0)
    );
    sorted.slice(0, 20).forEach((item, idx) => {
      const card = createRawCard(item, idx + 1, "kakao");
      grid.appendChild(card);
    });
  }
}

// =======================
// 초기화 / 이벤트
// =======================

function setupTabs() {
  const buttons = document.querySelectorAll(".tabs .tab");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const filter = btn.dataset.filter;
      renderCards(filter);
    });
  });
}

// 상단 박스오피스 플랫폼 필터
function setupDailyControls() {
  const sourceSel = document.getElementById("source-filter");
  if (sourceSel) {
    sourceSel.addEventListener("change", () => {
      renderDailyTable();
    });
  }
}

// 데이터 fetch
async function fetchData() {
  const statusEl = document.getElementById("status");
  try {
    if (statusEl) statusEl.textContent = "불러오는 중...";

    // 1) 통합 데이터
    const resTotal = await fetch(`${APPS_SCRIPT_URL}?source=all`);
    totalItems = await resTotal.json();

    // 2) 네이버 원본 TOP20
    const resNaver = await fetch(`${APPS_SCRIPT_URL}?action=getRaw&source=naver`);
    naverRaw = await resNaver.json();

    // 3) 카카오 원본 TOP20
    const resKakao = await fetch(`${APPS_SCRIPT_URL}?action=getRaw&source=kakao`);
    kakaoRaw = await resKakao.json();

    // 통합 랭킹 계산 (하단 통합 + 상단 전체 기반)
    combinedItems = buildCombinedRanking(totalItems);

    // 상단 / 하단 초기 렌더
    renderDailyTable();     // 상단 박스오피스 (기본: 전체)
    renderCards("all");     // 하단 통합 탭

    if (statusEl) statusEl.textContent = "";
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = "데이터를 불러오지 못했습니다.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupDailyControls();
  fetchData();
});
