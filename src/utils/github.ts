import raw from '@/data/github.json';

export interface GitHubUser {
  login: string;
  name: string;
  bio: string | null;
  avatarUrl: string;
  avatarLocal: boolean;
  htmlUrl: string;
  followers: number;
  following: number;
  publicRepos: number;
  location: string | null;
  createdAt: string;
}

export interface LanguageStat {
  name: string;
  /** 已认证时是代码字节数，匿名时是以该语言为主语言的仓库数 */
  weight: number;
  percent: number;
  color: string;
}

export interface ContributionDay {
  date: string;
  count: number;
  level: number;
}

export interface Contributions {
  total: number;
  weeks: (ContributionDay | null)[][];
  max: number;
  source?: string;
  from?: string;
  to?: string;
  activeDays?: number;
  busiestDay?: { date: string; count: number };
  streak: { current: number; longest: number };
}

export interface RepoSummary {
  name: string;
  description: string | null;
  url: string;
  language: string | null;
  stars: number;
  forks: number;
  pushedAt: string;
  topics: string[];
  archived: boolean;
}

export interface GitHubData {
  generatedAt: string;
  offline?: boolean;
  user: GitHubUser;
  totals: { stars: number; forks: number; repos: number };
  languages: LanguageStat[];
  contributions: Contributions;
  repos: RepoSummary[];
}

export const github = raw as unknown as GitHubData;
