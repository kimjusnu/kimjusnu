// 프로필 README 차트 생성기
// GitHub GraphQL로 내 커밋 시각만 모아 요일별 시간대 곡선(Daytime 차트) SVG를 그린다.
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
  timeZone: TZ, weekday: "short", hour: "numeric", hourCycle: "h23",
});

function toLocal(iso) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { day: DAYS.indexOf(p.weekday), hour: Number(p.hour) };
}

function aggregate(dates) {
  const grid = DAYS.map(() => new Array(24).fill(0));
  for (const iso of dates) {
    const t = toLocal(iso);
    grid[t.day][t.hour] += 1;
  }
  return { grid, total: dates.length };
}

// ---------- 공통 ----------

const fmt = (n) => n.toLocaleString("en-US");
const commits = (n) => `${fmt(n)} ${n === 1 ? "commit" : "commits"}`;
const FONT = `font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"`;

// ---------- Daytime 차트 (요일별 시간대 곡선, 글자 초상 옆 카드) ----------

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
  await writeFile(`${OUT_DIR}/daytime.svg`, daytimeSvg(agg));
  const privateCount = repos.filter((r) => r.isPrivate).length;
  console.log(`저장소 ${repos.length}개(비공개 ${privateCount}개) · 커밋 ${agg.total}건 집계 완료`);
}

main().catch((err) => {
  console.error(`차트 생성 실패: ${err.message}`);
  process.exit(1);
});
