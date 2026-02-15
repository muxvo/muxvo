/**
 * 包管理域类型定义
 * 来源: DEV-PLAN.md §2.6 marketplace:* + PRD §7.3
 */

/** 包类型 */
export type PackageType = 'skill' | 'hook';

/** 包版本信息 */
export interface PackageVersion {
  version: string;
  changelog?: string;
  publishedAt: string;
  fileSize?: number;
  fileList?: string[];
}

/** 包作者信息 */
export interface PackageAuthor {
  username: string;
  avatarUrl?: string;
  badges?: string[];
}

/** 包统计信息 */
export interface PackageStats {
  downloads?: number;
  weeklyDownloads?: number;
  avgRating?: number;
  reviewCount?: number;
  favoriteCount?: number;
}

/** marketplace:fetch-sources / marketplace:search 返回的聚合包数据 */
export interface AggregatedPackage {
  id: string;
  name: string;
  type: PackageType;
  displayName?: string;
  description?: string;
  readme?: string;
  author?: PackageAuthor;
  category?: string;
  tags?: string[];
  license?: string;
  stats?: PackageStats;
  latestVersion?: string;
  versions?: PackageVersion[];
  createdAt?: string;
  updatedAt?: string;
}

/** marketplace:get-installed 返回的已安装包信息 */
export interface InstalledPackage {
  name: string;
  type: PackageType;
  version: string;
  packageId?: string;
  source: string;
  sourceUrl?: string;
  installedAt: string;
  updatedAt?: string;
}

/** marketplace:check-updates 返回的更新信息 */
export interface UpdateInfo {
  name: string;
  currentVersion: string;
  latestVersion: string;
  changelog?: string;
}

/** marketplace:install 请求参数 */
export interface InstallRequest {
  name: string;
  source: string;
  type: PackageType;
  version?: string;
}

/** marketplace:install-progress 事件数据（M->R 推送） */
export interface InstallProgressEvent {
  name: string;
  progress: number;
  status: string;
}

/** marketplace:packages-loaded 事件数据（M->R 推送） */
export interface PackagesLoadedEvent {
  packages: AggregatedPackage[];
  source: string;
}

/** marketplace:update-available 事件数据（M->R 推送） */
export interface UpdateAvailableEvent {
  packages: UpdateInfo[];
}
