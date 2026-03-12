// =======================
// 설정(필수): Apps Script URL
// =======================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzcZjEIAkfbSNuMbsCOOkSKLWBXyQIDqLt8yigYsk8-uEs1nbT6d65jfKJKma3PT54k1Q/exec";

// 통합 / 네이버 / 카카오 데이터
let totalItems = [];   // 통합 시트 (통합용)
let naverRaw = [];     // 네이버 시트 원본 TOP20
let kakaoRaw = [];     // 카카오 시트 원본 TOP20

// 통합 랭킹 계산 결과 (TOP40)
let combinedItems = [];

// 상세 레이어 차트 객체
let detailChart = null;

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
// 통합 전일 정보 맵 (출처+제목 → 전일 정보)
// =======================
// totalItems 헤더: ["출처","오늘순위","제목","작가","날짜","장르","오늘조회수",
//                  "전일순위","전일조회수","순위변화","조회수증감","조회수증감률","썸네일"]
function buildPrevInfoMap(items) {
  const map = new Map();

  items.forEach((it) => {
    let sourceRaw = String(it["출처"] || "").trim();   // 예: "네이버", "카카오", "카카오페이지"
    const title = String(it["제목"] || "").trim();
    if (!sourceRaw || !title) return;

    // 출처 정규화 (통합 시트 값에 맞춰 필요하면 추가)
    if (sourceRaw === "카카오페이지") sourceRaw = "카카오";

    const key = `${sourceRaw}|${title}`;

    map.set(key, {
      prevRank: it["전일순위"] ?? "",
      rankDiff: it["순위변화"] ?? "-",
      viewRate: it["조회수증감률"] ?? "",
    });
  });

  return map;
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
// sourceLabel: "네이버" 또는 "카카오" (통합 시트의 출처 값 기준)
// prevInfoMap: buildPrevInfoMap(totalItems) 결과
function buildPlatformTop10(rawList, sourceLabel, prevInfoMap) {
  const sorted = [...rawList].sort(
    (a, b) => Number(a["순위"] || 0) - Number(b["순위"] || 0)
  );

  return sorted.slice(0, 10).map((it, idx) => {
    const title = String(it["제목"] || "").trim();
    const key = `${sourceLabel}|${title}`;

    const prevInfo = prevInfoMap.get(key) || {
      prevRank: "",
      rankDiff: "-",
      viewRate: "",
    };

    return {
      ...it,
      _localRank: idx + 1,               // 1~10
      _viewsNum: parseViews(it["조회수"]),
      _prevRank: prevInfo.prevRank,
      _rankDiff: prevInfo.rankDiff,
      _viewRate: prevInfo.viewRate,
    };
  });
}


// 상단: 일별 박스오피스 테이블 렌더링
function renderDailyTable() {
  const tbody = document.getElementById("daily-tbody");
  if (!tbody) return;

  const sourceSel = document.getElementById("source-filter");
  const sourceFilter = sourceSel ? sourceSel.value : "all"; // all/naver/kakao

  let top10 = [];

  // 통합 전일 정보 맵 (출처+제목 기준)
  const prevInfoMap = buildPrevInfoMap(totalItems);

  if (sourceFilter === "all") {
    // 상단 전체: 하단 통합 탭과 같은 통합 랭킹 기준 TOP10
    top10 = buildDailyTop10FromCombined();
  } else if (sourceFilter === "naver") {
    // 네이버: 네이버 원본 TOP20에서 1~10 + 통합 시트 전일 정보
    top10 = buildPlatformTop10(naverRaw, "네이버", prevInfoMap);
  } else if (sourceFilter === "kakao") {
    // 카카오: 카카오 원본 TOP20에서 1~10 + 통합 시트 전일 정보
    top10 = buildPlatformTop10(kakaoRaw, "카카오", prevInfoMap);
  }

  tbody.innerHTML = "";

  top10.forEach((item) => {
    const tr = document.createElement("tr");

    let platformLabel = "";
    let todayRank = "";
    let prevRank = "";
    let rankDiff = "-";
    let todayViews = "-";
    let viewRate = "";
    let thumbUrl = "";

    if (sourceFilter === "all") {
      // 통합 시트 기반
      platformLabel = String(item["출처"] || "");
      todayRank = item._localRank ?? item["오늘순위"] ?? "";
      prevRank = item["전일순위"] ?? "";
      rankDiff = item["순위변화"] || "-";
      todayViews = item["오늘조회수"] || "-";
      viewRate = item["조회수증감률"] || "";
      thumbUrl = item["썸네일"] && String(item["썸네일"]).trim();
    } else {
      // 네이버/카카오 원본 + 통합 시트 전일 정보
      platformLabel = sourceFilter === "naver" ? "네이버" : "카카오";
      todayRank = item._localRank ?? item["순위"] ?? "";
      prevRank = item._prevRank || "-";
      rankDiff = item._rankDiff || "-";
      todayViews = item["조회수"] || "-";
      viewRate = item._viewRate || "";
      thumbUrl = item["썸네일"] && String(item["썸네일"]).trim();
    }

    function renderRankDiff(rankDiff) {
      if (!rankDiff || rankDiff === "-") return "-";
      if (rankDiff === "유지") {
        return `<span class="rank-diff rank-diff--same">유지</span>`;
      }
      if (rankDiff === "NEW") {
        return `<span class="rank-diff rank-diff--new">NEW</span>`;
      }
      if (rankDiff.startsWith("▲")) {
        return `<span class="rank-diff rank-diff--up">${rankDiff}</span>`;
      }
      if (rankDiff.startsWith("▼")) {
        return `<span class="rank-diff rank-diff--down">${rankDiff}</span>`;
      }
      return rankDiff;
    }

    function renderChangeCell(viewRate) {
      if (!viewRate) return "-";
      if (viewRate === "NEW") {
        return `<span class="change change--new">NEW</span>`;
      }

      const num = parseFloat(String(viewRate).replace("%", ""));
      if (isNaN(num) || num === 0) {
        return `<span class="change change--zero">0%</span>`;
      }
      if (num > 0) {
        return `<span class="change change--up">+${num.toFixed(2)}%</span>`;
      } else {
        return `<span class="change change--down">${num.toFixed(2)}%</span>`;
      }
    }

    const thumbHtml = thumbUrl
      ? `<img src="${thumbUrl}" alt="" class="daily-thumb-img">`
      : `<span class="daily-thumb-placeholder">No</span>`;

    const isNaver =
      platformLabel.indexOf("네이버") !== -1 ||
      platformLabel.toLowerCase().indexOf("naver") !== -1;
    const platformClass = isNaver ? "badge-platform-naver" : "badge-platform-kakao";
    const platformText = isNaver ? "네이버" : "카카오";

    tr.innerHTML = `
      <td class="daily-thumb-cell">${thumbHtml}</td>
      <td>${todayRank}</td>
      <td
        class="title-cell"
        data-title="${item["제목"]}"
        data-author="${item["작가"] || ""}"
        data-platform="${platformText}"
      >
        ${item["제목"]}
      </td>
      <td>${item["작가"]}</td>
      <td><span class="badge ${platformClass}">${platformText}</span></td>
      <td>${todayViews}</td>
      <td>${prevRank || "-"}</td>
      <td>${renderRankDiff(rankDiff)}</td>
      <td>${renderChangeCell(viewRate)}</td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll(".title-cell").forEach((td) => {
    td.addEventListener("click", () => {
      const title = td.dataset.title;
      const author = td.dataset.author;
      const platform = td.dataset.platform; // "네이버" / "카카오"
      openDetailLayer({ title, author, platform });
    });
  });
}

// 네이버/카카오 원본 TOP20 → 하단 카드용 리스트 생성
// sourceLabel: "네이버" / "카카오"
function buildPlatformCards(rawList, sourceLabel, prevInfoMap) {
  const sorted = [...rawList].sort(
    (a, b) => Number(a["순위"] || 0) - Number(b["순위"] || 0)
  );

  return sorted.slice(0, 20).map((it, idx) => {
    const title = String(it["제목"] || "").trim();
    const key = `${sourceLabel}|${title}`;

    const prevInfo = prevInfoMap.get(key) || {
      prevRank: "",
      rankDiff: "-",
      viewRate: "",
    };

    return {
      ...it,
      _localRank: idx + 1,               // 1~20
      _viewsNum: parseViews(it["조회수"]),
      _prevRank: prevInfo.prevRank,
      _rankDiff: prevInfo.rankDiff,
      _viewRate: prevInfo.viewRate,
    };
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
  const rankDiffText = item["순위변화"] || "";
  const todayViews = item["오늘조회수"] || "-";
  const viewRateRaw = item["조회수증감률"] || "";

  function getStatusHtml() {
    let label = "";
    let cls = "";

    if (rankDiffText === "NEW") {
      label = "NEW";
      cls = "rank-diff rank-diff--new";
    } else if (rankDiffText === "재진입") {
      label = "재진입";
      cls = "rank-diff rank-diff--new";
    } else if (rankDiffText === "유지" || !rankDiffText) {
      label = "유지";
      cls = "rank-diff rank-diff--same";
    } else if (String(rankDiffText).startsWith("▲")) {
      label = rankDiffText;
      cls = "rank-diff rank-diff--up";
    } else if (String(rankDiffText).startsWith("▼")) {
      label = rankDiffText;
      cls = "rank-diff rank-diff--down";
    } else {
      label = rankDiffText;
      cls = "rank-diff";
    }

    return `<span class="${cls}">${label}</span>`;
  }

  function getRateHtml() {
    if (!viewRateRaw || viewRateRaw === "NEW") {
      return `<span class="change change--zero">0%</span>`;
    }
    const num = parseFloat(String(viewRateRaw).replace("%", ""));
    if (isNaN(num) || num === 0) {
      return `<span class="change change--zero">0%</span>`;
    }
    if (num > 0) {
      return `<span class="change change--up">+${num.toFixed(2)}%</span>`;
    } else {
      return `<span class="change change--down">${num.toFixed(2)}%</span>`;
    }
  }

  const line1Html = `
    <div class="card-footer-line">
      <span class="card-footer-left">${platformLabel} 오늘 ${todayRank}위</span>
      <span class="card-footer-right">${getStatusHtml()}</span>
    </div>
  `;

  const line2Html = `
    <div class="card-footer-line">
      <span class="card-footer-left">조회수 ${todayViews}</span>
      <span class="card-footer-right">${getRateHtml()}</span>
    </div>
  `;

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
        ${line1Html}
        ${line2Html}
      </div>
    </div>
  `;

  return div;
}


// 하단 네이버/카카오 카드용 DOM (원본 TOP20 + 통합 전일 정보)
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

  const todayRank = item._localRank ?? rank;
  const todayViews = item["조회수"] || "-";

  const rankDiffText = item._rankDiff || "";   // 통합에서 가져온 순위변화
  const viewRateRaw  = item._viewRate || "";   // 통합에서 가져온 증감률

  function getStatusHtml() {
    let label = "";
    let cls = "";

    if (rankDiffText === "NEW") {
      label = "NEW";
      cls = "rank-diff rank-diff--new";
    } else if (rankDiffText === "재진입") {
      label = "재진입";
      cls = "rank-diff rank-diff--new";
    } else if (rankDiffText === "유지" || !rankDiffText) {
      label = "유지";
      cls = "rank-diff rank-diff--same";
    } else if (String(rankDiffText).startsWith("▲")) {
      label = rankDiffText;
      cls = "rank-diff rank-diff--up";
    } else if (String(rankDiffText).startsWith("▼")) {
      label = rankDiffText;
      cls = "rank-diff rank-diff--down";
    } else {
      label = rankDiffText;
      cls = "rank-diff";
    }

    return `<span class="${cls}">${label}</span>`;
  }

  function getRateHtml() {
    if (!viewRateRaw || viewRateRaw === "NEW") {
      return `<span class="change change--zero">0%</span>`;
    }
    const num = parseFloat(String(viewRateRaw).replace("%", ""));
    if (isNaN(num) || num === 0) {
      return `<span class="change change--zero">0%</span>`;
    }
    if (num > 0) {
      return `<span class="change change--up">+${num.toFixed(2)}%</span>`;
    } else {
      return `<span class="change change--down">${num.toFixed(2)}%</span>`;
    }
  }

  const line1Html = `
    <div class="card-footer-line">
      <span class="card-footer-left">${platformLabel} 오늘 ${todayRank}위</span>
      <span class="card-footer-right">${getStatusHtml()}</span>
    </div>
  `;

  const line2Html = `
    <div class="card-footer-line">
      <span class="card-footer-left">조회수 ${todayViews}</span>
      <span class="card-footer-right">${getRateHtml()}</span>
    </div>
  `;

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
        ${line1Html}
        ${line2Html}
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

  // 통합 전일 정보 맵
  const prevInfoMap = buildPrevInfoMap(totalItems);

  if (filter === "all") {
    // 통합 TOP40 그대로 (_combinedRank 기준)
    combinedItems.forEach((item) => {
      const card = createCard(item, item._combinedRank);
      grid.appendChild(card);
    });
  } else if (filter === "naver") {
    // 네이버 원본 TOP20 + 통합 전일 정보
    const list = buildPlatformCards(naverRaw, "네이버", prevInfoMap);
    list.forEach((item, idx) => {
      const card = createRawCard(item, idx + 1, "naver");
      grid.appendChild(card);
    });
  } else if (filter === "kakao") {
    // 카카오 원본 TOP20 + 통합 전일 정보
    const list = buildPlatformCards(kakaoRaw, "카카오", prevInfoMap);
    list.forEach((item, idx) => {
      const card = createRawCard(item, idx + 1, "kakao");
      grid.appendChild(card);
    });
  }
}


// =======================
// 상세 레이어 (KOBIS 스타일)
// =======================
function setupDetailLayer() {
  const layer = document.getElementById("detail-layer");
  if (!layer) return;

  const closeBtn = document.getElementById("detail-close");
  const backdrop = layer.querySelector(".detail-backdrop");

  const tabs = layer.querySelectorAll(".detail-tab");
  const panes = layer.querySelectorAll(".detail-pane");

  // 닫기
  function close() {
    layer.classList.add("hidden");
  }

  if (closeBtn) closeBtn.addEventListener("click", close);
  if (backdrop) backdrop.addEventListener("click", close);

  // 탭 클릭
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabName = btn.dataset.tab;

      tabs.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      panes.forEach((p) => {
        if (p.dataset.tab === tabName) {
          p.classList.add("active");
        } else {
          p.classList.remove("active");
        }
      });
    });
  });
}

// 제목 클릭 시 호출
async function openDetailLayer({ title, author, platform }) {
  const layer = document.getElementById("detail-layer");
  if (!layer) return;

  const titleEl = document.getElementById("detail-title");
  const metaEl = document.getElementById("detail-meta");

  const platformClass =
    platform === "네이버" ? "detail-platform--naver" : "detail-platform--kakao";

  titleEl.innerHTML = `
    <span class="detail-title-text">${title}</span>
    <span class="detail-platform-badge ${platformClass}">${platform}</span>
  `;

  metaEl.innerHTML = `
    <div><strong>작가</strong> : ${author || "-"}</div>
    <div><strong>플랫폼</strong> : ${platform}</div>
    <div>최근 7일 히스토리</div>
  `;

  // 기본 탭을 info로
  layer.querySelectorAll(".detail-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === "info");
  });
  layer.querySelectorAll(".detail-pane").forEach((p) => {
    p.classList.toggle("active", p.dataset.tab === "info");
  });

  // 차트 데이터 fetch
  try {
    const params = new URLSearchParams({
      action: "titleHistory",
      title,
      source: platform, // Apps Script에서 "네이버"/"카카오"를 naver/kakao로 매핑
      days: 7,
    });

    const res = await fetch(`${APPS_SCRIPT_URL}?${params.toString()}`);
    const data = await res.json(); // [{날짜, 오늘순위, 오늘조회수}, ...]

        const labels = data.map((d) => d["날짜"].slice(5));
    const views = data.map((d) => parseViews(d["오늘조회수"]));
    const ranks = data.map((d) => Number(d["오늘순위"]));

    const canvas = document.getElementById("detail-chart");
    if (detailChart) {
      detailChart.destroy();
    }

    // 조회수 숫자를 만/억 단위로 찍는 포맷터
    function formatViews(v) {
      if (v >= 100000000) {
        return (v / 100000000).toFixed(1).replace(/\.0$/, "") + "억";
      } else if (v >= 10000) {
        return (v / 10000).toFixed(1).replace(/\.0$/, "") + "만";
      } else {
        return v.toString();
      }
    }

    detailChart = new Chart(canvas, {
      data: {
        labels,
        datasets: [
          // 조회수: 막대
          {
            type: "bar",
            label: "조회수",
            data: views,
            yAxisID: "yViews",
            backgroundColor: "rgba(33,150,243,0.45)",
            borderColor: "rgba(33,150,243,0.9)",
            borderWidth: 1,
            borderRadius: 3,
            maxBarThickness: 32,
          },
          // 순위: 선
          {
            type: "line",
            label: "순위",
            data: ranks,
            yAxisID: "yRank",
            borderColor: "rgba(244,67,54,0.9)",
            backgroundColor: "rgba(244,67,54,0.05)",
            borderWidth: 2,
            tension: 0.15,
            pointRadius: 3,
            pointHoverRadius: 4,
            pointBackgroundColor: "rgba(244,67,54,1)",
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top" },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const y = ctx.parsed.y;
                if (ctx.dataset.yAxisID === "yViews") {
                  return " 조회수: " + formatViews(y);
                } else {
                  return " 순위: " + y + "위";
                }
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "날짜" },
            ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 },
          },
          yViews: {
            type: "linear",
            position: "left",
            title: { display: true, text: "조회수" },
            ticks: {
              callback: (value) => formatViews(value),
            },
            grid: { color: "rgba(0,0,0,0.05)" },
          },
          yRank: {
            type: "linear",
            position: "right",
            reverse: true, // 1위가 위로
            title: { display: true, text: "순위" },
            grid: { drawOnChartArea: false },
            ticks: { stepSize: 1, min: 1, max: 20 },
          },
        },
      },
    });

  } catch (e) {
    console.error("detail fetch error", e);
  }

  layer.classList.remove("hidden");
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

// =======================
// 장르·플랫폼 비율 도넛
// =======================

// genreSummary API에서 데이터 가져오기
async function loadGenrePlatformShare() {
  try {
    const params = new URLSearchParams({ action: "genreSummary" });
    const res = await fetch(`${APPS_SCRIPT_URL}?${params.toString()}`);
    const data = await res.json(); // [{platform, genre, countShare, viewShare, ...}, ...]

    const kakao = data.filter((d) => d.platform === "kakao");
    const naver = data.filter((d) => d.platform === "naver");

    renderGenreDonut("chart-genre-kakao", kakao);
    renderGenreDonut("chart-genre-naver", naver);
  } catch (e) {
    console.error("장르·플랫폼 비율 로드 실패", e);
  }
}

// 실제 도넛 차트 그리는 함수
function renderGenreDonut(canvasId, rows) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !rows || rows.length === 0) return;

  const ctx = canvas.getContext("2d");

  const labels = rows.map((r) => r.genre);
  const values = rows.map((r) => r.countShare); // 작품수 비율 기준. 조회수 비율 쓰고 싶으면 r.viewShare

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
        },
      ],
    },
    options: {
      plugins: {
        legend: {
          position: "right",
        },
        title: {
          display: true,
          text: "장르 비율(작품수 기준)",
        },
        tooltip: {
          callbacks: {
            label: (ctx2) => {
              const label = ctx2.label || "";
              const value = ctx2.parsed;
              return `${label}: ${value}%`;
            },
          },
        },
      },
    },
  });
}

// 박스오피스 뷰 전환 (테이블 <-> 차트)
function setupDailyViewToggle() {
  const btn = document.getElementById("daily-view-toggle");
  const viewTable = document.getElementById("daily-view-table");
  const viewChart = document.getElementById("daily-view-chart");
  if (!btn || !viewTable || !viewChart) return;

  let isTableView = true; // 초기: 테이블

  btn.addEventListener("click", () => {
    isTableView = !isTableView;

    if (isTableView) {
      viewTable.classList.add("active");
      viewChart.classList.remove("active");
      btn.textContent = "▶"; // 차트로
    } else {
      viewTable.classList.remove("active");
      viewChart.classList.add("active");
      btn.textContent = "◀"; // 테이블로
    }
  });
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
    renderDailyTable();  // 상단 박스오피스 (기본: 전체)
    renderCards("all");  // 하단 통합 탭

    if (statusEl) statusEl.textContent = "";
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = "데이터를 불러오지 못했습니다.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupDailyControls();
  setupDetailLayer();
  fetchData();
  setupDailyViewToggle();
  loadGenrePlatformShare();
});
