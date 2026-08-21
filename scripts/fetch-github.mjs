/**
 * 构建前抓取 GitHub 公开数据，落盘为 src/data/github.json。
 *
 * 有 GITHUB_TOKEN 时走 GraphQL 拿官方贡献日历；
 * 没有 token 时退回公开 REST + 第三方贡献 API，本地开发无需任何配置。
 * 任何一步失败都会保留上一次的结果，避免把构建搞挂。
 *
 * 只读公开数据，且 token 只发往 api.github.com。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = resolve(ROOT, 'src/data/github.json');
const AVATAR_FILE = resolve(ROOT, 'public/avatar.png');

const USER = process.env.GITHUB_USER ?? '0xKaeruIO';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
const TOP_REPO_COUNT = 6;

const BASE_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': `${USER}-site-builder`,
  'X-GitHub-Api-Version': '2022-11-28',
};

/**
 * 凭据只附加给 GitHub 官方 API。第三方贡献接口和头像 CDN 都会走这个函数，
 * 无条件带上 Authorization 等于把 token 交给外部服务器。
 */
function headersFor(url) {
  const isGitHubApi = url.startsWith('https://api.github.com/');
  return {
    ...BASE_HEADERS,
    ...(isGitHubApi && TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  };
}

/** 带退避重试的 fetch：CI 与家用网络都常有瞬时抖动，一次失败不该让构建降级。 */
async function fetchWithRetry(url, init = {}, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { ...headersFor(url), ...init.headers },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 800 * 2 ** i));
      }
    }
  }
  throw new Error(`${url} 请求失败：${lastError?.message ?? 'unknown'}`);
}

async function getJSON(url) {
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function graphql(query, variables) {
  const res = await fetchWithRetry('https://api.github.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL -> ${res.status} ${res.statusText}`);
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(`GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  return body.data;
}

/* -------------------------------------------------------------------------- */
/* 贡献日历                                                                    */
/* -------------------------------------------------------------------------- */

const CONTRIB_QUERY = `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { date contributionCount }
          }
        }
      }
    }
  }
`;

async function fetchContributions() {
  if (TOKEN) {
    try {
      const data = await graphql(CONTRIB_QUERY, { login: USER });
      const cal = data.user.contributionsCollection.contributionCalendar;
      const days = cal.weeks.flatMap((w) =>
        w.contributionDays.map((d) => ({
          date: d.date,
          count: d.contributionCount,
        })),
      );
      return { days, total: cal.totalContributions, source: 'graphql' };
    } catch (err) {
      console.warn(`  ! GraphQL 贡献日历失败，回退公开 API：${err.message}`);
    }
  }

  const data = await getJSON(
    `https://github-contributions-api.jogruber.de/v4/${USER}?y=last`,
  );
  const days = (data.contributions ?? []).map((d) => ({
    date: d.date,
    count: d.count,
  }));
  return {
    days,
    total: data.total?.lastYear ?? days.reduce((s, d) => s + d.count, 0),
    source: 'public-api',
  };
}

/** 把按天的数据整理成「7 行 × N 周」的热力图网格，并算出连续天数等派生指标。 */
function buildCalendar({ days, total, source }) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) {
    return { total: 0, weeks: [], max: 0, source, streak: { current: 0, longest: 0 } };
  }

  const max = Math.max(...sorted.map((d) => d.count));
  const thresholds = [0, max * 0.25, max * 0.5, max * 0.75];
  const levelOf = (count) => {
    if (count <= 0) return 0;
    if (count <= thresholds[1]) return 1;
    if (count <= thresholds[2]) return 2;
    if (count <= thresholds[3]) return 3;
    return 4;
  };

  const weeks = [];
  let current = new Array(7).fill(null);
  for (const day of sorted) {
    const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
    if (current[weekday] !== null) {
      weeks.push(current);
      current = new Array(7).fill(null);
    }
    current[weekday] = { ...day, level: levelOf(day.count) };
  }
  weeks.push(current);

  let longest = 0;
  let running = 0;
  for (const day of sorted) {
    running = day.count > 0 ? running + 1 : 0;
    longest = Math.max(longest, running);
  }

  let currentStreak = 0;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i].count > 0) currentStreak += 1;
    else break;
  }

  const busiest = sorted.reduce((a, b) => (b.count > a.count ? b : a));

  return {
    total,
    weeks,
    max,
    source,
    from: sorted[0].date,
    to: sorted[sorted.length - 1].date,
    activeDays: sorted.filter((d) => d.count > 0).length,
    busiestDay: { date: busiest.date, count: busiest.count },
    streak: { current: currentStreak, longest },
  };
}

/* -------------------------------------------------------------------------- */
/* 仓库                                                                        */
/* -------------------------------------------------------------------------- */

async function fetchRepos() {
  const all = [];
  for (let page = 1; page <= 4; page += 1) {
    const batch = await getJSON(
      `https://api.github.com/users/${USER}/repos?per_page=100&sort=pushed&page=${page}`,
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.filter((r) => !r.private);
}

function pickTopRepos(repos) {
  return repos
    .filter((r) => !r.fork)
    .sort(
      (a, b) =>
        b.stargazers_count - a.stargazers_count ||
        new Date(b.pushed_at) - new Date(a.pushed_at),
    )
    .slice(0, TOP_REPO_COUNT)
    .map((r) => ({
      name: r.name,
      description: r.description,
      url: r.html_url,
      language: r.language,
      stars: r.stargazers_count,
      forks: r.forks_count,
      pushedAt: r.pushed_at,
      topics: (r.topics ?? []).slice(0, 4),
      archived: r.archived,
    }));
}

async function downloadAvatar(url) {
  try {
    const res = await fetchWithRetry(`${url}&s=320`);
    if (!res.ok) throw new Error(`${res.status}`);
    await mkdir(dirname(AVATAR_FILE), { recursive: true });
    await writeFile(AVATAR_FILE, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch (err) {
    console.warn(`  ! 头像下载失败，将使用远程地址：${err.message}`);
    return false;
  }
}

/* -------------------------------------------------------------------------- */

async function main() {
  console.log(`> 抓取 GitHub 数据：${USER}${TOKEN ? ' (已认证)' : ' (匿名)'}`);

  const [user, repos, rawContrib] = await Promise.all([
    getJSON(`https://api.github.com/users/${USER}`),
    fetchRepos(),
    fetchContributions(),
  ]);

  const avatarLocal = await downloadAvatar(user.avatar_url);

  const payload = {
    generatedAt: new Date().toISOString(),
    user: {
      login: user.login,
      name: user.name ?? user.login,
      bio: user.bio,
      avatarUrl: user.avatar_url,
      avatarLocal,
      htmlUrl: user.html_url,
      followers: user.followers,
      following: user.following,
      publicRepos: user.public_repos,
      location: user.location,
      createdAt: user.created_at,
    },
    totals: {
      stars: repos.reduce((s, r) => s + r.stargazers_count, 0),
      forks: repos.reduce((s, r) => s + r.forks_count, 0),
      repos: repos.filter((r) => !r.fork).length,
    },
    contributions: buildCalendar(rawContrib),
    repos: pickTopRepos(repos),
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(
    `  ✓ ${payload.totals.repos} 个仓库 / ${payload.contributions.total} 次贡献 (${payload.contributions.source})`,
  );
}

main().catch(async (err) => {
  console.warn(`! GitHub 数据抓取失败：${err.message}`);
  try {
    await readFile(OUT_FILE);
    console.warn('  → 沿用上一次的 src/data/github.json');
  } catch {
    console.warn('  → 写入占位数据，页面会显示离线状态');
    const placeholder = {
      generatedAt: new Date().toISOString(),
      offline: true,
      user: {
        login: USER,
        name: USER,
        bio: null,
        avatarUrl: `https://github.com/${USER}.png`,
        avatarLocal: false,
        htmlUrl: `https://github.com/${USER}`,
        followers: 0,
        following: 0,
        publicRepos: 0,
        location: null,
        createdAt: new Date().toISOString(),
      },
      totals: { stars: 0, forks: 0, repos: 0 },
      contributions: { total: 0, weeks: [], max: 0, streak: { current: 0, longest: 0 } },
      repos: [],
    };
    await mkdir(dirname(OUT_FILE), { recursive: true });
    await writeFile(OUT_FILE, `${JSON.stringify(placeholder, null, 2)}\n`);
  }
});
