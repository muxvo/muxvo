import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Stats {
  totalUsers: number;
  activeUsers: number;
  publishedShowcases: number;
  publishedSkills: number;
  signupTrend: { date: string; count: number }[];
}

interface DauItem {
  date: string;
  dau: number;
  registered_users: number;
}
interface DauResponse {
  from: string;
  to: string;
  data: DauItem[];
}

interface UsageDurationItem {
  date: string;
  active_devices: number;
  avg_minutes: number;
  total_minutes: number;
}
interface UsageDurationResponse {
  from: string;
  to: string;
  data: UsageDurationItem[];
}

interface RetentionRateItem {
  total: number;
  retained: number;
  rate: number;
}
interface RetentionResponse {
  rates: Record<string, RetentionRateItem>;
  cohorts: unknown[];
  granularity: 'week' | 'month';
}

interface ChurnBucket {
  count: number;
  rate: number;
}
interface ChurnResponse {
  total_devices: number;
  churn_7d: ChurnBucket;
  churn_14d: ChurnBucket;
  churn_30d: ChurnBucket;
}

type Source = 'app' | 'web';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDateStr(d);
}

const today = formatDateStr(new Date());
const yesterday = daysAgo(1);

function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(minutes)}m`;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function Dashboard() {
  const [source, setSource] = useState<Source>('app');
  const [stats, setStats] = useState<Stats | null>(null);
  const [dauData, setDauData] = useState<DauItem[]>([]);
  const [usageData, setUsageData] = useState<UsageDurationItem[]>([]);
  const [retention, setRetention] = useState<RetentionResponse | null>(null);
  const [churn, setChurn] = useState<ChurnResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      apiFetch<Stats>('/admin/stats'),
      apiFetch<DauResponse>(
        `/admin/analytics/dau?from=${daysAgo(7)}&to=${today}&source=${source}`,
      ),
      apiFetch<UsageDurationResponse>(
        `/admin/analytics/usage-duration?from=${daysAgo(7)}&to=${today}`,
      ),
      apiFetch<RetentionResponse>('/admin/analytics/retention?granularity=week'),
      apiFetch<ChurnResponse>('/admin/analytics/churn'),
    ])
      .then(([s, dau, usage, ret, ch]) => {
        setStats(s);
        setDauData(dau.data);
        setUsageData(usage.data);
        setRetention(ret);
        setChurn(ch);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [source]);

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-gray-500">Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-red-400">Error: {error}</p>
      </div>
    );
  }

  if (!stats) return null;

  // Computed values
  const todayDau = dauData.find((d) => d.date === today)?.dau ?? 0;
  const yesterdayDau = dauData.find((d) => d.date === yesterday)?.dau ?? 0;
  const dauDelta =
    yesterdayDau > 0
      ? Math.round(((todayDau - yesterdayDau) / yesterdayDau) * 100)
      : 0;

  const avgUsageMinutes =
    usageData.length > 0
      ? usageData.reduce((sum, d) => sum + d.avg_minutes, 0) / usageData.length
      : 0;

  const d1 = retention?.rates?.D1;
  const churn7d = churn?.churn_7d;

  return (
    <div className="p-8">
      {/* Section 1: Header + Source Toggle */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <SourceToggle value={source} onChange={setSource} />
      </div>

      {/* Section 2: Hero Metrics */}
      <div className="grid grid-cols-4 gap-5 mb-8">
        <HeroCard
          label={`Today's DAU ${source === 'app' ? '软件日活' : '官网日活'}`}
          value={todayDau.toLocaleString()}
          color="text-amber-400"
          delta={dauDelta}
          subtext={yesterdayDau > 0 ? `Yesterday: ${yesterdayDau}` : undefined}
        />
        <HeroCard
          label="Avg Usage (7d) 平均使用时长"
          value={formatDuration(avgUsageMinutes)}
          color="text-cyan-400"
          subtext="all sources"
        />
        <HeroCard
          label="D1 Retention 次日留存"
          value={d1 ? `${d1.rate}%` : '-'}
          color="text-emerald-400"
          subtext={d1 ? `${d1.retained}/${d1.total} devices` : undefined}
        />
        <HeroCard
          label="7d Churn 七日流失"
          value={churn7d ? `${churn7d.rate}%` : '-'}
          color="text-red-400"
          subtext={
            churn7d && churn
              ? `${churn7d.count}/${churn.total_devices} devices`
              : undefined
          }
        />
      </div>

      {/* Section 3: 7-Day DAU Sparkline */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-8">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">
          DAU Trend (Last 7 Days)
        </h2>
        {dauData.length === 0 ? (
          <p className="text-gray-500 text-sm">No DAU data yet.</p>
        ) : (
          <DauSparkline data={dauData} />
        )}
      </div>

      {/* Section 4: Secondary Stats */}
      <div className="grid grid-cols-2 gap-5 mb-8">
        <StatCard label="Total Users 总用户" value={stats.totalUsers} />
        <StatCard
          label="Active Users 活跃用户"
          value={stats.activeUsers}
          color="text-emerald-400"
        />
      </div>

      {/* Section 5: Bottom Row */}
      <div className="grid grid-cols-5 gap-5">
        {/* Left: Signup Trend */}
        <div className="col-span-3 bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-400 mb-4">
            Signups (Last 30 Days) 注册趋势
          </h2>
          {stats.signupTrend.length === 0 ? (
            <p className="text-gray-500 text-sm">No signup data yet.</p>
          ) : (
            <SignupChart data={stats.signupTrend} />
          )}
        </div>

        {/* Right: Health Indicators */}
        <div className="col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-400 mb-4">
            Health Indicators 健康指标
          </h2>
          <HealthIndicators retention={retention} churn={churn} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SourceToggle({
  value,
  onChange,
}: {
  value: Source;
  onChange: (s: Source) => void;
}) {
  const tabs: { value: Source; label: string }[] = [
    { value: 'app', label: 'App 软件' },
    { value: 'web', label: 'Website 官网' },
  ];

  return (
    <div className="flex gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={
            value === tab.value
              ? 'px-4 py-2 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-400 text-sm font-medium'
              : 'px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 text-sm hover:border-gray-600 transition-colors'
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function HeroCard({
  label,
  value,
  color,
  delta,
  subtext,
}: {
  label: string;
  value: string;
  color: string;
  delta?: number;
  subtext?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-sm text-gray-500 mb-2">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className={`text-4xl font-bold ${color}`}>{value}</p>
        {delta !== undefined && delta !== 0 && (
          <span
            className={`text-sm font-medium ${delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {delta > 0 ? '+' : ''}
            {delta}%
          </span>
        )}
      </div>
      {subtext && (
        <p className="text-xs text-gray-500 mt-1">{subtext}</p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color = 'text-amber-400',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function DauSparkline({ data }: { data: DauItem[] }) {
  const maxDau = Math.max(...data.map((d) => d.dau), 1);

  return (
    <div>
      {/* Legend */}
      <div className="flex gap-4 mb-2 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400/80" />
          <span>Registered</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-amber-400/80" />
          <span>Anonymous</span>
        </div>
      </div>

      {/* Chart */}
      <div className="flex items-end gap-1.5 h-24">
        {data.map((d) => {
          const totalPct = (d.dau / maxDau) * 100;
          const regPct = d.dau > 0 ? (d.registered_users / d.dau) * 100 : 0;
          const anonPct = 100 - regPct;
          const anonymous = d.dau - d.registered_users;
          const dateLabel = d.date.slice(5); // MM-DD

          return (
            <div
              key={d.date}
              className="flex-1 flex flex-col items-center group relative"
            >
              {/* Stacked bar */}
              <div
                className="w-full flex flex-col rounded-t overflow-hidden"
                style={{ height: `${Math.max(totalPct, 3)}%` }}
              >
                <div
                  className="w-full bg-amber-400/80 transition-all group-hover:bg-amber-400"
                  style={{ flex: `${anonPct} 0 0%` }}
                />
                <div
                  className="w-full bg-emerald-400/80 transition-all group-hover:bg-emerald-400"
                  style={{ flex: `${regPct} 0 0%` }}
                />
              </div>

              {/* Date label */}
              <span className="text-[10px] text-gray-600 mt-1">{dateLabel}</span>

              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-800 text-xs text-white px-2 py-1 rounded whitespace-nowrap z-10">
                {d.date}: {d.dau} DAU ({d.registered_users} reg, {anonymous}{' '}
                anon)
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SignupChart({ data }: { data: { date: string; count: number }[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="flex items-end gap-1 h-36">
      {data.map((d) => {
        const height = (d.count / maxCount) * 100;
        return (
          <div
            key={d.date}
            className="flex-1 flex flex-col items-center group relative"
          >
            <div
              className="w-full bg-amber-400/80 rounded-t transition-all hover:bg-amber-400"
              style={{ height: `${Math.max(height, 2)}%` }}
            />
            <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-800 text-xs text-white px-2 py-1 rounded whitespace-nowrap z-10">
              {d.date}: {d.count} signup{d.count !== 1 ? 's' : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HealthIndicators({
  retention,
  churn,
}: {
  retention: RetentionResponse | null;
  churn: ChurnResponse | null;
}) {
  const rows: {
    label: string;
    value: string;
    detail: string;
    pct: number;
    color: string;
    barColor: string;
  }[] = [];

  if (retention) {
    const d7 = retention.rates?.D7;
    const d30 = retention.rates?.D30;
    if (d7) {
      rows.push({
        label: 'D7 Retention 七日留存',
        value: `${d7.rate}%`,
        detail: `${d7.retained}/${d7.total}`,
        pct: d7.rate,
        color: 'text-emerald-400',
        barColor: 'bg-emerald-400/60',
      });
    }
    if (d30) {
      rows.push({
        label: 'D30 Retention 月留存',
        value: `${d30.rate}%`,
        detail: `${d30.retained}/${d30.total}`,
        pct: d30.rate,
        color: 'text-emerald-400',
        barColor: 'bg-emerald-400/60',
      });
    }
  }

  if (churn) {
    rows.push({
      label: '14d Churn 两周流失',
      value: `${churn.churn_14d.rate}%`,
      detail: `${churn.churn_14d.count}/${churn.total_devices}`,
      pct: churn.churn_14d.rate,
      color: 'text-red-400',
      barColor: 'bg-red-400/60',
    });
    rows.push({
      label: '30d Churn 月流失',
      value: `${churn.churn_30d.rate}%`,
      detail: `${churn.churn_30d.count}/${churn.total_devices}`,
      pct: churn.churn_30d.rate,
      color: 'text-red-400',
      barColor: 'bg-red-400/60',
    });
  }

  if (rows.length === 0) {
    return <p className="text-gray-500 text-sm">No data yet.</p>;
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">{row.label}</span>
            <div className="flex items-baseline gap-2">
              <span className={`text-sm font-semibold ${row.color}`}>
                {row.value}
              </span>
              <span className="text-xs text-gray-600">{row.detail}</span>
            </div>
          </div>
          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${row.barColor}`}
              style={{ width: `${Math.min(row.pct, 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
