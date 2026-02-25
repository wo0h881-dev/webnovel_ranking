// Google Apps Script 웹앱 URL (source 파라미터는 여기서 붙여도 되고, 나중에 바꿔도 됨)
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxKO8RmSp-95Tkv0oOSL66cieGTK4Iw5m0CIlfHqyxueQljPZqOj4KSvzsXcuF4cl0UfA/exec"; // 실제 URL로 교체

let rawItems = [];      // 시트에서 받은 원본
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

  if (!eokMatch && !manMatch) {
    const numMatch = t.match(/\d+/);
    return numMatch ? parseInt(numMatch[0], 10) : 0;
  }

  return eok * 100_000_000 + man * 10_000;
}

// "1위" → 1
function normalizeRank(rankStr) {
  if (!rankStr) return 0;
  const m = String(rankStr).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// 1위 → 20점, 20위 → 1점
function rankToScore(rank) {
  rank = Number(rank);
  if (!rank) return 0;
  return 21 - rank;
}

// 통합 랭킹 계산: score 우선, 동점이면 조회수 큰 순
function buildCombinedRanking(items) {
  const enriched = items.map((it) => {
    const platform = String(it["출처"] || "").toLowerCase();
    const platformRank = normalizeRank(it["순위"]);
    return {
      ...it,
      _platform: platform,
      _platformRank: platformRank,
      _score: rankToScore(platformRank),
      _viewsNum: parseViews(it["조회수"]),
    };
  });

  enriched.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return b._viewsNum - a._viewsNum;
  });

  enriched.forEach((it, idx) => {
    it._combinedRank = idx + 1;
  });

  return enriched.slice(0, 40);
}

async function fetchData() {
  const statusEl = document.getElementById("status");
  try {
    statusEl.textContent = "불러오는 중...";
    const res = await fetch(APPS_SCRIPT_URL);
    const data = await res.json();
    rawItems = data;
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

  const platform = item._platform === "naver" ? "네이버" : "카카오";
  const platformBadgeClass =
    item._platform === "naver" ? "badge-platform-naver" : "badge-platform-kakao";

  const thumbUrl = item["썸네일"] && String(item["썸네일"]).trim();
  const thumbHtml = thumbUrl
    ? `<img src="${thumbUrl}" alt="">`
    : `<span>썸네일 없음</span>`;

  div.innerHTML = `
    <div class="card-rank">${item._combinedRank}</div>
    <div class="card-thumb">${thumbHtml}</div>
    <div class="card-body">
      <div class="card-title">${item["제목"]}</div>
      <div class="card-author">${item["작가"]}</div>
      <div class="card-meta">
        <span class="badge ${platformBadgeClass}">${platform}</span>
        <span class="badge">${item["장르"] || "장르 미상"}</span>
        <span class="badge">${item["날짜"] || ""}</span>
      </div>
      <div class="card-footer">
        ${platform} ${item["순위"]} · 조회수 ${item["조회수"] || "-"}
      </div>
    </div>
  `;

  return div;
}


function renderCards(filter) {
  const grid = document.getElementById("card-grid");
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

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  fetchData();
});
