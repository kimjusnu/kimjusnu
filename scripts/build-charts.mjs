// 프로필 README 차트 생성기
// GitHub GraphQL로 내 커밋 시각만 모아 SVG 두 장(커밋 시계, 커밋 지층)을 그린다.
// 저장소 이름은 어디에도 쓰지 않는다. 공개 저장소의 Actions 로그도 공개되므로 로그에도 합계만 남긴다.
import { mkdir, writeFile } from "node:fs/promises";

const LOGIN = process.env.PROFILE_LOGIN || "kimjusnu";
const TOKEN = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN;
const TZ = "Asia/Seoul";
const OUT_DIR = "assets";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

if (!TOKEN) throw new Error("STATS_TOKEN 또는 GITHUB_TOKEN 환경 변수가 필요합니다");

// ---------- 데이터 수집 ----------

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL 요청 실패: HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL 오류: ${body.errors.map((e) => e.message).join("; ")}`);
  return body.data;
}

async function listRepos() {
  const repos = [];
  let after = null;
  do {
    const data = await gql(
      `query($login:String!,$after:String){ user(login:$login){ id repositories(first:100, after:$after, ownerAffiliations:OWNER, isFork:false){
        nodes{ name isPrivate defaultBranchRef{ name } } pageInfo{ hasNextPage endCursor } } } }`,
      { login: LOGIN, after },
    );
    const conn = data.user.repositories;
    repos.push(...conn.nodes.filter((r) => r.defaultBranchRef).map((r) => ({ ...r, userId: data.user.id })));
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
  return repos;
}

async function commitDates(repo) {
  const dates = [];
  let after = null;
  do {
    const data = await gql(
      `query($owner:String!,$name:String!,$id:ID!,$after:String){ repository(owner:$owner,name:$name){ defaultBranchRef{ target{ ... on Commit{
        history(first:100, after:$after, author:{id:$id}){ nodes{ authoredDate } pageInfo{ hasNextPage endCursor } } } } } } }`,
      { owner: LOGIN, name: repo.name, id: repo.userId, after },
    );
    const history = data.repository.defaultBranchRef.target.history;
    dates.push(...history.nodes.map((n) => n.authoredDate));
    after = history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null;
  } while (after);
  return dates;
}

// ---------- 집계 (한국 시각 기준) ----------

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "numeric", weekday: "short", hour: "numeric", hourCycle: "h23",
});

function toLocal(iso) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: DAYS.indexOf(p.weekday), hour: Number(p.hour) };
}

function aggregate(dates) {
  const grid = DAYS.map(() => new Array(24).fill(0));
  const perYear = new Map();
  const perMonth = new Map();
  let first = null;
  for (const iso of dates) {
    const t = toLocal(iso);
    grid[t.day][t.hour] += 1;
    perYear.set(`${t.year}`, (perYear.get(`${t.year}`) ?? 0) + 1);
    const m = `${t.year}-${String(t.month).padStart(2, "0")}`;
    perMonth.set(m, (perMonth.get(m) ?? 0) + 1);
    if (!first || iso < first) first = iso;
  }
  return { grid, perYear, perMonth, total: dates.length, since: first?.slice(0, 7) ?? "-" };
}

// ---------- 공통 ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => n.toLocaleString("en-US");
const commits = (n) => `${fmt(n)} ${n === 1 ? "commit" : "commits"}`;
const FONT = `font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"`;

function seeded(seedText) {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// ---------- 차트 1: 커밋 시계 (요일 × 시간대) ----------

const THEMES = {
  light: { bg: "#ffffff", line: "#d0d7de", ink: "#1f2328", muted: "#59636e", scale: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"] },
  dark: { bg: "#0d1117", line: "#30363d", ink: "#e6edf3", muted: "#9198a1", scale: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"] },
};

function level(v, max) {
  if (v === 0) return 0;
  return Math.min(4, 1 + Math.floor(Math.sqrt(v / max) * 3.999));
}

// 열마다 조금씩 늦게 나타난다. 지연을 begin이 아니라 keyTimes에 넣어야 애니메이션을 안 도는 환경에서도 칸이 보인다
function reveal(col) {
  const delay = col * 0.035, dur = delay + 0.4;
  return `<animate attributeName="opacity" values="0;0;1" keyTimes="0;${(delay / dur).toFixed(3)};1" dur="${dur.toFixed(3)}s" fill="freeze"/>`;
}

function clockSvg({ grid, total, since }, theme) {
  const t = THEMES[theme];
  const CELL = 26, GAP = 4, LEFT = 56, TOP = 118, W = 860;
  const hourTotals = Array.from({ length: 24 }, (_, h) => grid.reduce((s, row) => s + row[h], 0));
  const dayTotals = grid.map((row) => row.reduce((s, v) => s + v, 0));
  const max = Math.max(1, ...grid.flat());
  const hourMax = Math.max(1, ...hourTotals);
  const dayMax = Math.max(1, ...dayTotals);
  let peak = { d: 0, h: 0, v: -1 };
  grid.forEach((row, d) => row.forEach((v, h) => { if (v > peak.v) peak = { d, h, v }; }));
  const gridBottom = TOP + 7 * (CELL + GAP);
  const H = gridBottom + 44;
  const out = [];

  out.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="${t.bg}" stroke="${t.line}"/>`);
  out.push(`<text x="24" y="36" fill="${t.ink}" font-size="15" font-weight="700" letter-spacing="1">COMMIT CLOCK</text>`);
  out.push(`<text x="24" y="56" fill="${t.muted}" font-size="12">weekday × hour, ${TZ} · since ${esc(since)}</text>`);
  out.push(`<text x="${W - 24}" y="36" fill="${t.ink}" font-size="15" font-weight="700" text-anchor="end">${fmt(total)} commits</text>`);
  out.push(`<text x="${W - 24}" y="56" fill="${t.muted}" font-size="12" text-anchor="end">peak ${DAYS[peak.d]} ${String(peak.h).padStart(2, "0")}:00</text>`);

  // 시간대 합계 막대
  hourTotals.forEach((v, h) => {
    const bh = Math.round((v / hourMax) * 30);
    const x = LEFT + h * (CELL + GAP);
    out.push(`<rect x="${x}" y="${TOP - 10 - bh}" width="${CELL}" height="${Math.max(bh, 1)}" fill="${t.scale[3]}" opacity="0.8"/>`);
  });

  // 요일 × 시간 칸 (열마다 조금씩 늦게 나타난다)
  grid.forEach((row, d) => {
    const y = TOP + d * (CELL + GAP);
    out.push(`<text x="${LEFT - 12}" y="${y + CELL / 2 + 4}" fill="${t.muted}" font-size="12" text-anchor="end">${DAYS[d]}</text>`);
    row.forEach((v, h) => {
      const x = LEFT + h * (CELL + GAP);
      const tip = `${DAYS[d]} ${String(h).padStart(2, "0")}:00 · ${commits(v)}`;
      out.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${t.scale[level(v, max)]}"><title>${tip}</title>${reveal(h)}</rect>`);
    });
    // 요일 합계 막대
    const bw = Math.round((dayTotals[d] / dayMax) * 40);
    const bx = LEFT + 24 * (CELL + GAP) + 8;
    out.push(`<rect x="${bx}" y="${y + 6}" width="${Math.max(bw, 1)}" height="${CELL - 12}" fill="${t.scale[3]}" opacity="0.8"/>`);
  });

  for (const h of [0, 6, 12, 18]) {
    const x = LEFT + h * (CELL + GAP) + CELL / 2;
    out.push(`<text x="${x}" y="${gridBottom + 16}" fill="${t.muted}" font-size="11" text-anchor="middle">${String(h).padStart(2, "0")}</text>`);
  }
  // 범례
  const lx = W - 24 - 5 * 16 - 70;
  out.push(`<text x="${lx - 8}" y="${gridBottom + 16}" fill="${t.muted}" font-size="11" text-anchor="end">less</text>`);
  t.scale.forEach((c, i) => out.push(`<rect x="${lx + i * 16}" y="${gridBottom + 6}" width="12" height="12" rx="2" fill="${c}"/>`));
  out.push(`<text x="${lx + 5 * 16 + 6}" y="${gridBottom + 16}" fill="${t.muted}" font-size="11">more</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT} role="img" aria-label="Commit clock: ${fmt(total)} commits by weekday and hour">${out.join("")}</svg>`;
}

// ---------- 차트 2: 커밋 지층 (Strata Core, CC0 템플릿 기법) ----------

const STRATA = { ground: "#14100c", ink: "#f0e6da", muted: "#a08f7e", top: [0xe0, 0x7a, 0x3f], bottom: [0x3a, 0x34, 0x48] };

function bedColor(i, n) {
  const k = n === 1 ? 0 : i / (n - 1);
  const c = STRATA.top.map((a, j) => Math.round(a + (STRATA.bottom[j] - a) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// 연도가 4개 미만이면 월로 나눠야 지층이 읽힌다. 최근 7개 층만 두고 나머지는 한 층으로 묶는다
function beds({ perYear, perMonth }) {
  const source = perYear.size >= 4 ? perYear : perMonth;
  const sorted = [...source.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  if (sorted.length <= 8) return sorted;
  const older = sorted.slice(7).reduce((s, [, v]) => s + v, 0);
  return [...sorted.slice(0, 7), [`${sorted.at(-1)[0]} ~ ${sorted[7][0]}`, older]];
}

// 경계선: 제어점은 끝점보다 더 흔들려야 퇴적된 선처럼 보인다(11 대 7)
function contact(y, X0, X1, rand, straight) {
  const pts = [];
  for (let x = X0 + 60; x <= X1; x += 60) {
    pts.push({ cx: x - 30, cy: straight ? y : y + (rand() - 0.5) * 11, x, y: straight ? y : y + (rand() - 0.5) * 7 });
  }
  return { y0: y, pts };
}

const forward = (c) => c.pts.map((p) => ` Q${p.cx} ${p.cy.toFixed(1)} ${p.x} ${p.y.toFixed(1)}`).join("");
function backward(c, X0) {
  let d = "";
  for (let i = c.pts.length - 1; i >= 0; i--) {
    const prev = i === 0 ? { x: X0, y: c.y0 } : c.pts[i - 1];
    d += ` Q${c.pts[i].cx} ${c.pts[i].cy.toFixed(1)} ${prev.x} ${prev.y.toFixed(1)}`;
  }
  return d;
}

function strataSvg(agg) {
  const layers = beds(agg);
  const total = layers.reduce((s, [, v]) => s + v, 0) || 1;
  const W = 860, H = 460, TOP = 92, BOT = 420, X0 = 96, X1 = 576;
  const rand = seeded(layers.map(([k, v]) => `${k}:${v}`).join("|"));
  const out = [];
  const defs = [];

  // 두께는 커밋 비율에 정비례한다. 너무 얇은 층만 4px로 받친다
  const heights = layers.map(([, v]) => Math.max(4, ((BOT - TOP) * v) / total));
  const scale = (BOT - TOP) / heights.reduce((s, h) => s + h, 0);
  const ys = [TOP];
  heights.forEach((h) => ys.push(ys.at(-1) + h * scale));
  const contacts = ys.map((y, i) => contact(y, X0, X1, rand, i === ys.length - 1));

  out.push(`<rect width="${W}" height="${H}" rx="6" fill="${STRATA.ground}"/>`);
  out.push(`<text x="32" y="40" fill="${STRATA.ink}" font-size="15" font-weight="700" letter-spacing="1">COMMIT STRATA</text>`);
  out.push(`<text x="32" y="60" fill="${STRATA.muted}" font-size="12">newest on top · bed thickness = share of ${fmt(total)} commits</text>`);

  layers.forEach(([label, v], i) => {
    const d = `M${X0} ${contacts[i].y0.toFixed(1)}${forward(contacts[i])} L${X1} ${contacts[i + 1].pts.at(-1).y.toFixed(1)}${backward(contacts[i + 1], X0)} Z`;
    const freq = (0.012 + i * 0.01).toFixed(3);
    defs.push(`<filter id="g${i}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq} ${(freq * 3).toFixed(3)}" numOctaves="3" seed="${i + 3}"/>`
      + `<feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.8 0 0 0 -0.7"/><feComposite in2="SourceGraphic" operator="in"/></filter>`);
    out.push(`<path d="${d}" fill="${bedColor(i, layers.length)}"><title>${esc(label)} · ${commits(v)}</title></path>`);
    out.push(`<path d="${d}" fill="#000" opacity="0.55" filter="url(#g${i})"/>`);
  });

  // 깊이 눈금 (누적 비율)
  const SX = X0 - 26;
  out.push(`<line x1="${SX}" y1="${TOP}" x2="${SX}" y2="${BOT}" stroke="${STRATA.muted}" stroke-width="1"/>`);
  for (let k = 0; k <= 4; k++) {
    const y = TOP + ((BOT - TOP) * k) / 4;
    out.push(`<line x1="${SX - 5}" y1="${y}" x2="${SX}" y2="${y}" stroke="${STRATA.muted}"/>`);
    out.push(`<text x="${SX - 9}" y="${y + 4}" fill="${STRATA.muted}" font-size="10" text-anchor="end">${k * 25}%</text>`);
  }

  // 층 이름: 얇은 층은 글자를 줄이지 않고 지시선으로 빼낸다
  const mids = layers.map((_, i) => (ys[i] + ys[i + 1]) / 2);
  const labelYs = [];
  mids.forEach((mid, i) => labelYs.push(Math.max(mid, i ? labelYs[i - 1] + 20 : -Infinity)));
  for (let i = labelYs.length - 1; i >= 0; i--) {
    const limit = i === labelYs.length - 1 ? BOT : labelYs[i + 1] - 20;
    labelYs[i] = Math.min(labelYs[i], limit);
  }
  layers.forEach(([label, v], i) => {
    const mid = mids[i];
    const y = labelYs[i];
    const LX = X1 + 44;
    out.push(`<path d="M${X1 + 4} ${mid.toFixed(1)} L${X1 + 20} ${mid.toFixed(1)} L${LX - 6} ${y.toFixed(1)}" fill="none" stroke="${STRATA.muted}" stroke-width="0.8"/>`);
    out.push(`<text x="${LX}" y="${(y + 4).toFixed(1)}" font-size="13"><tspan fill="${STRATA.ink}" font-weight="700">${esc(label)}</tspan>`
      + `<tspan fill="${STRATA.muted}"> · ${commits(v)}</tspan></text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT} role="img" aria-label="Commit strata: ${fmt(total)} commits by period"><defs>${defs.join("")}</defs>${out.join("")}</svg>`;
}

// ---------- 차트 3: Daytime 차트 (요일별 시간대 곡선, 글자 초상 옆 카드) ----------

// 보라 → 파랑 → 청록. 일요일부터 토요일까지 한 색씩
const SERIES = ["#673bd6", "#535ae0", "#3f77e9", "#2c96f2", "#34adf0", "#56bce1", "#7accd4"];
const WEEK_FROM_SUN = [6, 0, 1, 2, 3, 4, 5]; // DAYS(월 시작) 인덱스를 일요일 시작 순서로

// 균일 3차 B-스플라인. 곡선이 점들의 볼록 껍질 안에 머물러 바닥선 아래로 내려가지 않는다
function basisPath(pts) {
  if (pts.length < 3) return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  const f = (n) => n.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const [a0, a1] = pts;
  d += `L${f((5 * a0[0] + a1[0]) / 6)} ${f((5 * a0[1] + a1[1]) / 6)}`;
  const seg = (p0, p1, p2) => `C${f((2 * p0[0] + p1[0]) / 3)} ${f((2 * p0[1] + p1[1]) / 3)} ${f((p0[0] + 2 * p1[0]) / 3)} ${f((p0[1] + 2 * p1[1]) / 3)} ${f((p0[0] + 4 * p1[0] + p2[0]) / 6)} ${f((p0[1] + 4 * p1[1] + p2[1]) / 6)}`;
  for (let i = 2; i < pts.length; i++) d += seg(pts[i - 2], pts[i - 1], pts[i]);
  const n = pts.length;
  d += seg(pts[n - 2], pts[n - 1], pts[n - 1]);
  d += `L${f(pts[n - 1][0])} ${f(pts[n - 1][1])}`;
  return d;
}

function daytimeSvg({ grid, total }) {
  const W = 560, H = 635, X0 = 30, X1 = 530, TOP = 130, BASE = 548;
  const max = Math.max(1, ...grid.flat());
  const x = (h) => X0 + (h / 23) * (X1 - X0);
  const y = (v) => BASE - (v / max) * (BASE - TOP);
  let peak = { d: 0, h: 0, v: -1 };
  grid.forEach((row, d) => row.forEach((v, h) => { if (v > peak.v) peak = { d, h, v }; }));
  const out = [];

  out.push(`<defs><linearGradient id="dbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111722"/><stop offset="1" stop-color="#0d1117"/></linearGradient></defs>`);
  out.push(`<rect width="${W}" height="${H}" rx="12" fill="url(#dbg)"/><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="#30363d"/>`);
  out.push(`<line x1="0" y1="30" x2="${W}" y2="30" stroke="#30363d"/>`);
  out.push(`<circle cx="20" cy="15" r="5" fill="#ff5f56"/><circle cx="36" cy="15" r="5" fill="#ffbd2e"/><circle cx="52" cy="15" r="5" fill="#27c93f"/>`);
  out.push(`<text x="${W / 2}" y="19" fill="#7d8590" font-size="12" text-anchor="middle">${LOGIN}@github: ~$ ./daytime.sh</text>`);
  out.push(`<text x="${X0}" y="70" fill="#e6edf3" font-size="16" font-weight="700">Daytime Chart</text>`);
  out.push(`<text x="${X0}" y="90" fill="#9aa7b4" font-size="11">${commits(total)} · hour of day, ${TZ}</text>`);

  // 범례: 일 ~ 토
  WEEK_FROM_SUN.forEach((di, i) => {
    const lx = X0 + i * 70;
    out.push(`<circle cx="${lx + 3}" cy="110" r="3.5" fill="${SERIES[i]}"/><text x="${lx + 11}" y="114" fill="#9aa7b4" font-size="11">${DAYS[di]}</text>`);
  });

  // 눈금선
  for (let k = 1; k <= 3; k++) {
    const gy = BASE - ((BASE - TOP) * k) / 4;
    out.push(`<line x1="${X0}" y1="${gy}" x2="${X1}" y2="${gy}" stroke="#21262d" stroke-dasharray="2 4"/>`);
  }
  out.push(`<line x1="${X0}" y1="${BASE}" x2="${X1}" y2="${BASE}" stroke="#30363d"/>`);

  // 요일별 곡선 (선이 그려지며 나타난다)
  WEEK_FROM_SUN.forEach((di, i) => {
    const pts = grid[di].map((v, h) => [x(h), y(v)]);
    const line = basisPath(pts);
    const color = SERIES[i];
    out.push(`<path d="${line}L${X1} ${BASE}L${X0} ${BASE}Z" fill="${color}" fill-opacity="0.12"/>`);
    out.push(`<path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="0">`
      + `<animate attributeName="stroke-dashoffset" values="1;1;0" keyTimes="0;${(i * 0.08 / (i * 0.08 + 1.2)).toFixed(3)};1" dur="${(i * 0.08 + 1.2).toFixed(2)}s" fill="freeze"/></path>`);
  });

  for (let h = 0; h < 24; h += 3) {
    out.push(`<text x="${x(h).toFixed(1)}" y="${BASE + 20}" fill="#9aa7b4" font-size="10" text-anchor="middle">${String(h).padStart(2, "0")}:00</text>`);
  }

  // 아래 프롬프트 줄: 왼쪽 글자 초상 카드와 높이를 맞춘다
  const bar = H - 43;
  out.push(`<line x1="0" y1="${bar}" x2="${W}" y2="${bar}" stroke="#30363d"/>`);
  out.push(`<text x="20" y="${bar + 19}" fill="#7d8590" font-size="13">${LOGIN}@github:~$ peak <tspan fill="#c9d1d9">${DAYS[peak.d]} ${String(peak.h).padStart(2, "0")}:00</tspan></text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT} role="img" aria-label="Daytime chart: ${fmt(total)} commits by hour and weekday">${out.join("")}</svg>`;
}

// ---------- 실행 ----------

async function main() {
  const repos = await listRepos();
  // STATS_TOKEN이 있는데 비공개 저장소가 안 보이면 권한 설정이 잘못된 것이다. 빈약한 차트로 덮어쓰지 않고 멈춘다
  if (process.env.STATS_TOKEN && !repos.some((r) => r.isPrivate)) {
    throw new Error("STATS_TOKEN이 비공개 저장소를 읽지 못합니다. 토큰의 Repository access(All repositories)와 Contents 권한을 확인하세요");
  }
  const dates = [];
  for (const repo of repos) dates.push(...(await commitDates(repo)));
  const agg = aggregate(dates);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/commit-clock.light.svg`, clockSvg(agg, "light"));
  await writeFile(`${OUT_DIR}/commit-clock.dark.svg`, clockSvg(agg, "dark"));
  await writeFile(`${OUT_DIR}/commit-strata.svg`, strataSvg(agg));
  await writeFile(`${OUT_DIR}/daytime.svg`, daytimeSvg(agg));
  const privateCount = repos.filter((r) => r.isPrivate).length;
  console.log(`저장소 ${repos.length}개(비공개 ${privateCount}개) · 커밋 ${agg.total}건 집계 완료`);
}

main().catch((err) => {
  console.error(`차트 생성 실패: ${err.message}`);
  process.exit(1);
});
