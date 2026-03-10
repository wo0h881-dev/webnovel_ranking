// Google Apps Script 웹앱 URL
// 예: https://script.google.com/macros/s/XXXX/exec?source=all
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxOgdSKGBR9xiEAkrHuf9VXIFBkYYDKdNexZEmm8oouuAHLV3rbtFJCwvpUKls3Kwu8bw/exec"; // 실제 URL로 교체

let rawItems = [];      // 시트에서 받은 원본 데이터
let combinedItems = []; // 통합/정렬 결과

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

// 통합 랭킹 계산: score 우선, 동점이면 조회수 큰 순
// Apps Script 통합 시트 헤더 기준:
// ["출처","오늘순위","제목","작가","날짜","장르","오늘조회수",
//  "전일순위","전일조회수","순위변화","조회수증감","조회수증감률","썸네일"]
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

/**
 * 상단: 플랫폼별 TOP10 계산
 * - filter: "all" | "naver" | "kakao"
 * - all: 네이버+카카오 묶어서 조회수 기준 통합 1~10위
 * - naver/kakao: 각 플랫폼 내에서 오늘순위 기준 1~10위
 */
function buildDailyTop10(items) {
  const sourceFilterEl = document.getElementById("source-filter");
  const sourceFilter = sourceFilterEl ? sourceFilterEl.value : "all"; // all/naver/kakao

  // 네이버/카카오 리스트 분리
  const naverList = [];
  const kakaoList = [];

  items.forEach((it) => {
    const srcRaw = String(it["출처"] || "").toLowerCase();
    const todayRank = Number(it["오늘순위"] || 0);
    if (!todayRank) return;

    if (srcRaw.indexOf("naver") !== -1 || srcRaw.indexOf("네이버") !== -1) {
      naverList.push(it);
    } else if (srcRaw.indexOf("kakao") !== -1 || srcRaw.indexOf("카카오") !== -1) {
      kakaoList.push(it);
    }
  });

  // 플랫폼 내부: 오늘순위 기준 정렬 후 1~N 재부여
  function sortAndReRank(list, limit) {
    const sorted = [...list].sort(
      (a, b) => Number(a["오늘순위"] || 0) - Number(b["오늘순위"] || 0)
    );
    return sorted.slice(0, limit).map((it, idx) => ({
      ...it,
      _localRank: idx + 1,
      _viewsNum: parseViews(it["오늘조회수"]),
    }));
  }

  // 각 플랫폼 TOP10
  const naverRanked10 = sortAndReRank(naverList, 10);
  const kakaoRanked10 = sortAndReRank(kakaoList, 10);

  // 필터별 로직
  if (sourceFilter === "naver") {
    // 네이버 탭: 네이버 내부 1~10위 그대로
    return naverRanked10;
  }

  if (sourceFilter === "kakao") {
    // 카카오 탭: 카카오 내부 1~10위 그대로
    return kakaoRanked10;
  }

  // 전체 탭: 네이버+카카오 합쳐서 조회수 기준 통합 1~10위
  const merged = [...naverRanked10, ...kakaoRanked10];

  merged.sort((a, b) => b._viewsNum - a._viewsNum);

  return merged.slice(0, 10).map((it, idx) => ({
    ...it,
    _localRank: idx + 1, // 통합 박스오피스 1~10위
  }));
}

// 상단: 일별 박스오피스 테이블 렌더링
function renderDailyTable() {
  const tbody = document.getElementById("daily-tbody");
  if (!tbody) return;

  const top10 = buildDailyTop10(rawItems);
  tbody.innerHTML = "";

  top10.forEach((item) => {
    const tr = document.createElement("tr");
    const platformRaw = String(item["출처"] || "").trim();
    const isNaver =
      platformRaw.toLowerCase().indexOf("naver") !== -1 ||
      platformRaw.indexOf("네이버") !== -1;
    const platformLabel = isNaver ? "네이버" : "카카오";

    const todayRank = item._localRank ?? item["오늘순위"] ?? "";
    const prevRank = item["전일순위"] ?? "";
    const rankDiff = item["순위변화"] || "-";
    const todayViews = item["오늘조회수"] || "-";
    const viewDiff = item["조회수증감"] || "";
    const viewRate = item["조회수증감률"] || "";

    const thumbUrl = item["썸네일"] && String(item["썸네일"]).trim();
    const thumbHtml = thumbUrl
      ? `<img src="${thumbUrl}" alt="" class="daily-thumb-img">`
      : `<span class="daily-thumb-placeholder">No</span>`;

    const platformClass = isNaver ? "badge-platform-naver" : "badge-platform-kakao";

    tr.innerHTML = `
      <td class="daily-thumb-cell">${thumbHtml}</td>
      <td>${todayRank}</td>
      <td>${item["제목"]}</td>
      <td>${item["작가"]}</td>
      <td><span class="badge ${platformClass}">${platformLabel}</span></td>
      <td>${todayViews}</td>
      <td>${prevRank || "-"}</td>
      <td>${rankDiff}</td>
      <td>${viewDiff || viewRate ? `${viewDiff} ${viewRate}` : "-"}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function fetchData() {
  const statusEl = document.getElementById("status");
  try {
    statusEl.textContent = "불러오는 중...";
    const res = await fetch(APPS_SCRIPT_URL);
    const data = await res.json();
    rawItems = data;

    // 상단 일별 박스오피스 테이블
    renderDailyTable();

    // 하단 통합 TOP40 카드
    combinedItems = buildCombinedRanking(rawItems);
    statusEl.textContent = "";
    renderCards("all");
  } catch (err) {
    console.error(err);
    statusEl.textContent = "데이터를 불러오지 못했습니다.";
  }
}

function createCard(item) {
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
    <div class="card-rank">${item._combinedRank}</div>
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

// 하단 카드 렌더링 (통합 TOP40)
// 탭: all / naver / kakao
function renderCards(filter) {
  const grid = document.getElementById("card-grid");
  if (!grid) return;

  grid.innerHTML = "";

  let list = combinedItems;
  if (filter === "naver" || filter === "kakao") {
    list = combinedItems.filter((it) => it._platform === filter);
  }

  list.forEach((item) => {
    grid.appendChild(createCard(item));
  });
}

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

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupDailyControls();
  fetchData();
});
