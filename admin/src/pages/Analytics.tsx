import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';

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

interface EventItem {
  date: string;
  metric: string;
  total: number;
}
interface EventsResponse {
  from: string;
  to: string;
  data: EventItem[];
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDate(d);
}

const today = formatDate(new Date());
const defaultFrom = daysAgo(30);

type Preset = 7 | 30 | 90;
type Source = 'all' | 'web' | 'app';

const SOURCE_TABS: { value: Source; label: string }[] = [
  { value: 'all', label: '全部 All' },
  { value: 'web', label: '官网 Website' },
  { value: 'app', label: '软件 App' },
];

export function Analytics() {
  const [dauData, setDauData] = useState<DauItem[]>([]);
  const [eventsData, setEventsData] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [activePreset, setActivePreset] = useState<Preset | null>(30);
  const [source, setSource] = useState<Source>('all');

  useEffect(() => {
    setLoading(true);
    const sourceParam = source !== 'all' ? `&source=${source}` : '';
    Promise.all([
      apiFetch<DauResponse>(`/admin/analytics/dau?from=${from}&to=${to}${sourceParam}`),
      apiFetch<EventsResponse>(`/admin/analytics/events?from=${from}&to=${to}${sourceParam}`),
    ])
      .then(([dau, events]) => {
        setDauData(dau.data);
        setEventsData(events.data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [from, to, source]);

  function applyPreset(days: Preset) {
    setActivePreset(days);
    setFrom(daysAgo(days));
    setTo(today);
  }

  function handleFromChange(value: string) {
    setActivePreset(null);
    setFrom(value);
  }

  function handleToChange(value: string) {
    setActivePreset(null);
    setTo(value);
  }

  // Computed overview values
  const avgDau =
    dauData.length > 0
      ? Math.round(dauData.reduce((sum, d) => sum + d.dau, 0) / dauData.length)
      : 0;

  const totalEvents = eventsData.reduce((sum, d) => sum + d.total, 0);

  const totalDau = dauData.reduce((sum, d) => sum + d.dau, 0);
  const totalRegistered = dauData.reduce((sum, d) => sum + d.registered_users, 0);
  const registeredPct = totalDau > 0 ? ((totalRegistered / totalDau) * 100).toFixed(1) : '0.0';

  // Aggregate events by metric
  const eventsByMetric = eventsData.reduce<Record<string, number>>((acc, d) => {
    acc[d.metric] = (acc[d.metric] || 0) + d.total;
    return acc;
  }, {});
  const days = dauData.length || 1;
  const eventRows = Object.entries(eventsByMetric)
    .map(([metric, total]) => ({ metric, total, avgPerDay: total / days }))
    .sort((a, b) => b.total - a.total);

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-gray-500">Loading analytics...</p>
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

  const presetBtn = (days: Preset, label: string) => (
    <button
      key={days}
      onClick={() => applyPreset(days)}
      className={
        activePreset === days
          ? 'px-3 py-2 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-400 text-sm'
          : 'px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 text-sm hover:border-gray-600 transition-colors'
      }
    >
      {label}
    </button>
  );

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-8">Analytics 分析</h1>

      {/* Source tabs */}
      <div className="flex gap-2 mb-6">
        {SOURCE_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setSource(tab.value)}
            className={
              source === tab.value
                ? 'px-4 py-2 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-400 text-sm font-medium'
                : 'px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 text-sm hover:border-gray-600 transition-colors'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Date range selector */}
      <div className="flex items-center gap-3 mb-8 flex-wrap">
        <input
          type="date"
          value={from}
          onChange={(e) => handleFromChange(e.target.value)}
          className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm outline-none focus:border-amber-400 transition-colors"
        />
        <span className="text-gray-500 text-sm">to</span>
        <input
          type="date"
          value={to}
          onChange={(e) => handleToChange(e.target.value)}
          className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm outline-none focus:border-amber-400 transition-colors"
        />
        <div className="flex gap-2 ml-2">
          {presetBtn(7, 'Last 7 days')}
          {presetBtn(30, 'Last 30 days')}
          {presetBtn(90, 'Last 90 days')}
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-4 gap-5 mb-10">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm text-gray-500 mb-1">Avg. DAU 日活</p>
          <p className="text-3xl font-bold text-amber-400">{avgDau.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm text-gray-500 mb-1">Total Events 总事件</p>
          <p className="text-3xl font-bold text-amber-400">{totalEvents.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm text-gray-500 mb-1">Total DAU 总日活</p>
          <p className="text-3xl font-bold text-amber-400">{totalDau.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm text-gray-500 mb-1">Registered % 注册率</p>
          <p className="text-3xl font-bold text-amber-400">{registeredPct}%</p>
        </div>
      </div>

      {/* DAU trend chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-10">
        <h2 className="text-lg font-semibold mb-4">DAU Trend</h2>
        {dauData.length === 0 ? (
          <p className="text-gray-500 text-sm">No DAU data yet.</p>
        ) : (
          <DauChart data={dauData} />
        )}
      </div>

      {/* Event distribution table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Event Distribution 事件分布</h2>
        {eventRows.length === 0 ? (
          <p className="text-gray-500 text-sm">No event data yet.</p>
        ) : (
          <EventTable rows={eventRows} />
        )}
      </div>
    </div>
  );
}

function EventTable({ rows }: { rows: { metric: string; total: number; avgPerDay: number }[] }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-gray-800">
          <th className="text-left text-gray-500 text-xs uppercase py-2 pr-4">Event</th>
          <th className="text-right text-gray-500 text-xs uppercase py-2 px-4">Total</th>
          <th className="text-right text-gray-500 text-xs uppercase py-2 pl-4">Avg/Day</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.metric} className="border-b border-gray-800 last:border-0">
            <td className="py-2 pr-4 text-sm">{row.metric}</td>
            <td className="py-2 px-4 text-sm text-right text-gray-300">
              {row.total.toLocaleString()}
            </td>
            <td className="py-2 pl-4 text-sm text-right text-gray-400">
              {row.avgPerDay.toFixed(1)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DauChart({ data }: { data: DauItem[] }) {
  const maxDau = Math.max(...data.map((d) => d.dau), 1);

  return (
    <div className="flex items-end gap-1 h-40">
      {data.map((d) => {
        const height = (d.dau / maxDau) * 100;
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center group relative">
            <div
              className="w-full bg-amber-400/80 rounded-t transition-all hover:bg-amber-400"
              style={{ height: `${Math.max(height, 2)}%` }}
            />
            <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-800 text-xs text-white px-2 py-1 rounded whitespace-nowrap">
              {d.date}: {d.dau} DAU, {d.registered_users} registered
            </div>
          </div>
        );
      })}
    </div>
  );
}
