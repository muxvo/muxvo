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
interface CohortItem {
  cohort: string;
  size: number;
  retention: number[];
}
interface RetentionResponse {
  rates: Record<string, RetentionRateItem>;
  cohorts: CohortItem[];
  granularity: 'week' | 'month';
}

function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDateISO(d);
}

function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(minutes)}m`;
}

const today = formatDateISO(new Date());
const defaultFrom = daysAgo(30);

type Preset = 'today' | 7 | 30 | 90;
type Source = 'all' | 'web' | 'app';

const SOURCE_TABS: { value: Source; label: string }[] = [
  { value: 'all', label: '全部 All' },
  { value: 'web', label: '官网 Website' },
  { value: 'app', label: '软件 App' },
];

export function Analytics() {
  const [dauData, setDauData] = useState<DauItem[]>([]);
  const [eventsData, setEventsData] = useState<EventItem[]>([]);
  const [usageData, setUsageData] = useState<UsageDurationItem[]>([]);
  const [retentionData, setRetentionData] = useState<RetentionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [activePreset, setActivePreset] = useState<Preset | null>(30);
  const [source, setSource] = useState<Source>('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [retentionGranularity, setRetentionGranularity] = useState<'week' | 'month'>('week');

  useEffect(() => {
    setLoading(true);
    const sourceParam = source !== 'all' ? `&source=${source}` : '';
    Promise.all([
      apiFetch<DauResponse>(`/admin/analytics/dau?from=${from}&to=${to}${sourceParam}`),
      apiFetch<EventsResponse>(`/admin/analytics/events?from=${from}&to=${to}${sourceParam}`),
      apiFetch<UsageDurationResponse>(`/admin/analytics/usage-duration?from=${from}&to=${to}`),
    ])
      .then(([dau, events, usage]) => {
        setDauData(dau.data);
        setEventsData(events.data);
        setUsageData(usage.data);
        setSelectedDate(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [from, to, source]);

  useEffect(() => {
    apiFetch<RetentionResponse>(`/admin/analytics/retention?granularity=${retentionGranularity}`)
      .then(setRetentionData)
      .catch(() => {/* ignore retention errors */});
  }, [retentionGranularity]);

  function applyPreset(preset: Preset) {
    setActivePreset(preset);
    if (preset === 'today') {
      setFrom(today);
      setTo(today);
    } else {
      setFrom(daysAgo(preset));
      setTo(today);
    }
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

  const avgRegistered =
    dauData.length > 0
      ? Math.round(dauData.reduce((sum, d) => sum + d.registered_users, 0) / dauData.length)
      : 0;

  const avgAnonymous = avgDau - avgRegistered;

  const totalEvents = eventsData.reduce((sum, d) => sum + d.total, 0);

  const totalDau = dauData.reduce((sum, d) => sum + d.dau, 0);
  const totalRegistered = dauData.reduce((sum, d) => sum + d.registered_users, 0);
  const registeredPct = totalDau > 0 ? ((totalRegistered / totalDau) * 100).toFixed(1) : '0.0';

  const avgUsageMinutes =
    usageData.length > 0
      ? usageData.reduce((sum, d) => sum + d.avg_minutes, 0) / usageData.length
      : 0;

  // Aggregate events by metric
  const eventsByMetric = eventsData.reduce<Record<string, number>>((acc, d) => {
    acc[d.metric] = (acc[d.metric] || 0) + d.total;
    return acc;
  }, {});
  const days = dauData.length || 1;
  const eventRows = Object.entries(eventsByMetric)
    .map(([metric, total]) => ({ metric, total, avgPerDay: total / days }))
    .sort((a, b) => b.total - a.total);

  // Selected day detail
  const selectedDau = selectedDate ? dauData.find((d) => d.date === selectedDate) : null;
  const selectedEvents = selectedDate
    ? eventsData
        .filter((e) => e.date === selectedDate)
        .sort((a, b) => b.total - a.total)
    : [];

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

  const presetBtn = (preset: Preset, label: string) => (
    <button
      key={preset}
      onClick={() => applyPreset(preset)}
      className={
        activePreset === preset
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
          {presetBtn('today', 'Today')}
          {presetBtn(7, 'Last 7 days')}
          {presetBtn(30, 'Last 30 days')}
          {presetBtn(90, 'Last 90 days')}
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-6 gap-5 mb-10">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm text-gray-500 mb-1">Avg. DAU 日活</p>
          <p className="text-3xl font-bold text-white">{avgDau.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm text-gray-500 mb-1">Avg. Registered 注册</p>
          <p className="text-3xl font-bold text-emerald-400">{avgRegistered.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm text-gray-500 mb-1">Avg. Anonymous 匿名</p>
          <p className="text-3xl font-bold text-amber-400">{avgAnonymous.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm text-gray-500 mb-1">Registered % 注册率</p>
          <p className="text-3xl font-bold text-emerald-400">{registeredPct}%</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm text-gray-500 mb-1">Avg Usage 使用时长</p>
          <p className="text-3xl font-bold text-cyan-400">{formatDuration(avgUsageMinutes)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm text-gray-500 mb-1">Total Events 总事件</p>
          <p className="text-3xl font-bold text-gray-300">{totalEvents.toLocaleString()}</p>
        </div>
      </div>

      {/* Retention cards */}
      {retentionData && (
        <div className="grid grid-cols-3 gap-5 mb-10">
          {(['D1', 'D7', 'D30'] as const).map((period) => {
            const r = retentionData.rates[period];
            return (
              <div key={period} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <p className="text-sm text-gray-500 mb-1">{period} Retention {period === 'D1' ? '次日留存' : period === 'D7' ? '七日留存' : '月留存'}</p>
                <p className="text-3xl font-bold text-cyan-400">
                  {r ? `${r.rate}%` : '-'}
                </p>
                {r && (
                  <p className="text-xs text-gray-500 mt-1">
                    {r.retained}/{r.total} devices
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* DAU trend line chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-10">
        <h2 className="text-lg font-semibold mb-4">DAU Trend DAU 趋势</h2>
        {dauData.length === 0 ? (
          <p className="text-gray-500 text-sm">No DAU data yet.</p>
        ) : (
          <>
            <LineChart
              data={dauData.map((d) => ({
                date: d.date,
                lines: [
                  { value: d.dau, color: '#fbbf24', label: 'DAU' },
                  { value: d.registered_users, color: '#34d399', label: 'Registered' },
                ],
              }))}
              height={200}
              onSelectDate={(date) => setSelectedDate(selectedDate === date ? null : date)}
              selectedDate={selectedDate}
            />
            {selectedDau && (
              <DayDetail
                dau={selectedDau}
                events={selectedEvents}
                onClose={() => setSelectedDate(null)}
              />
            )}
          </>
        )}
      </div>

      {/* Usage duration line chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-10">
        <h2 className="text-lg font-semibold mb-4">Usage Duration 使用时长趋势</h2>
        {usageData.length === 0 ? (
          <p className="text-gray-500 text-sm">No usage data yet.</p>
        ) : (
          <LineChart
            data={usageData.map((d) => ({
              date: d.date,
              lines: [
                { value: d.avg_minutes, color: '#22d3ee', label: 'Avg min' },
              ],
            }))}
            height={160}
            formatValue={(v) => formatDuration(v)}
          />
        )}
      </div>

      {/* Cohort retention matrix */}
      {retentionData && retentionData.cohorts.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Cohort Retention 留存矩阵</h2>
            <div className="flex gap-2">
              {(['week', 'month'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setRetentionGranularity(g)}
                  className={
                    retentionGranularity === g
                      ? 'px-3 py-1.5 rounded-lg bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 text-xs'
                      : 'px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 text-xs hover:border-gray-600 transition-colors'
                  }
                >
                  {g === 'week' ? 'Weekly' : 'Monthly'}
                </button>
              ))}
            </div>
          </div>
          <CohortTable cohorts={retentionData.cohorts} granularity={retentionData.granularity} />
        </div>
      )}

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

// ---------------------------------------------------------------------------
// SVG Line Chart (reusable)
// ---------------------------------------------------------------------------

interface LineChartPoint {
  date: string;
  lines: { value: number; color: string; label: string }[];
}

function LineChart({
  data,
  height = 200,
  formatValue,
  onSelectDate,
  selectedDate,
}: {
  data: LineChartPoint[];
  height?: number;
  formatValue?: (v: number) => string;
  onSelectDate?: (date: string) => void;
  selectedDate?: string | null;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (data.length === 0) return null;

  const padL = 50;
  const padR = 20;
  const padT = 20;
  const padB = 40;
  const W = 800;
  const H = height;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const lineCount = data[0].lines.length;
  const allValues = data.flatMap((d) => d.lines.map((l) => l.value));
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  function x(i: number) {
    return padL + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW);
  }
  function y(v: number) {
    return padT + chartH - ((v - minVal) / range) * chartH;
  }

  // Y-axis ticks (5 ticks)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const val = minVal + (range * i) / 4;
    return { val: Math.round(val), py: y(val) };
  });

  // X-axis labels (show ~6 labels max)
  const labelStep = Math.max(1, Math.floor(data.length / 6));
  const xLabels = data
    .map((d, i) => ({ label: d.date.slice(5), px: x(i), i }))
    .filter((_, i) => i % labelStep === 0 || i === data.length - 1);

  // Build polyline paths
  const paths = Array.from({ length: lineCount }, (_, li) => {
    const points = data.map((d, i) => `${x(i)},${y(d.lines[li].value)}`).join(' ');
    return { points, color: data[0].lines[li].color, label: data[0].lines[li].label };
  });

  const fmt = formatValue || ((v: number) => String(Math.round(v)));

  return (
    <div>
      {/* Legend */}
      <div className="flex gap-4 mb-3 text-xs text-gray-400">
        {paths.map((p) => (
          <div key={p.label} className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 rounded" style={{ backgroundColor: p.color }} />
            <span>{p.label}</span>
          </div>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: `${height}px` }}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* Grid lines */}
        {yTicks.map((t) => (
          <g key={t.val}>
            <line x1={padL} y1={t.py} x2={W - padR} y2={t.py} stroke="#374151" strokeWidth={0.5} />
            <text x={padL - 8} y={t.py + 4} textAnchor="end" fill="#6b7280" fontSize={11}>
              {t.val}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {xLabels.map((l) => (
          <text key={l.i} x={l.px} y={H - 8} textAnchor="middle" fill="#6b7280" fontSize={11}>
            {l.label}
          </text>
        ))}

        {/* Lines */}
        {paths.map((p) => (
          <polyline
            key={p.label}
            points={p.points}
            fill="none"
            stroke={p.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}

        {/* Selected date vertical line */}
        {selectedDate && (() => {
          const si = data.findIndex((d) => d.date === selectedDate);
          if (si < 0) return null;
          return <line x1={x(si)} y1={padT} x2={x(si)} y2={padT + chartH} stroke="#fbbf24" strokeWidth={1} strokeDasharray="4 2" />;
        })()}

        {/* Hover areas */}
        {data.map((d, i) => {
          const colW = data.length === 1 ? chartW : chartW / (data.length - 1);
          return (
            <rect
              key={d.date}
              x={x(i) - colW / 2}
              y={padT}
              width={colW}
              height={chartH}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(i)}
              onClick={() => onSelectDate?.(d.date)}
              style={{ cursor: onSelectDate ? 'pointer' : 'default' }}
            />
          );
        })}

        {/* Hover dots and tooltip */}
        {hoverIndex !== null && (() => {
          const d = data[hoverIndex];
          const tx = x(hoverIndex);
          // Vertical hover line
          return (
            <g>
              <line x1={tx} y1={padT} x2={tx} y2={padT + chartH} stroke="#4b5563" strokeWidth={1} />
              {d.lines.map((l, li) => (
                <circle key={li} cx={tx} cy={y(l.value)} r={4} fill={l.color} stroke="#111827" strokeWidth={2} />
              ))}
              {/* Tooltip background */}
              <rect
                x={Math.min(tx + 8, W - padR - 150)}
                y={padT}
                width={140}
                height={16 + d.lines.length * 16}
                rx={4}
                fill="#1f2937"
                stroke="#374151"
              />
              <text
                x={Math.min(tx + 16, W - padR - 142)}
                y={padT + 14}
                fill="#9ca3af"
                fontSize={11}
              >
                {d.date}
              </text>
              {d.lines.map((l, li) => (
                <text
                  key={li}
                  x={Math.min(tx + 16, W - padR - 142)}
                  y={padT + 30 + li * 16}
                  fill={l.color}
                  fontSize={12}
                  fontWeight="bold"
                >
                  {l.label}: {fmt(l.value)}
                </text>
              ))}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

function DayDetail({
  dau,
  events,
  onClose,
}: {
  dau: DauItem;
  events: EventItem[];
  onClose: () => void;
}) {
  const anonymous = dau.dau - dau.registered_users;

  return (
    <div className="mt-4 border-t border-gray-700 pt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300">
          {dau.date} Detail
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-500">DAU</p>
          <p className="text-xl font-bold text-white">{dau.dau}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-500">Registered</p>
          <p className="text-xl font-bold text-emerald-400">{dau.registered_users}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-500">Anonymous</p>
          <p className="text-xl font-bold text-amber-400">{anonymous}</p>
        </div>
      </div>
      {events.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left text-gray-500 text-xs uppercase py-1.5">Event</th>
              <th className="text-right text-gray-500 text-xs uppercase py-1.5">Count</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.metric} className="border-b border-gray-800 last:border-0">
                <td className="py-1.5 text-gray-300">{e.metric}</td>
                <td className="py-1.5 text-right text-gray-400">{e.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CohortTable({ cohorts, granularity }: { cohorts: CohortItem[]; granularity: 'week' | 'month' }) {
  const maxPeriods = cohorts.reduce((max, c) => Math.max(max, c.retention.length), 0);
  const periodLabel = granularity === 'week' ? 'W' : 'M';

  function retentionColor(rate: number): string {
    if (rate >= 50) return 'bg-cyan-400/40 text-cyan-300';
    if (rate >= 30) return 'bg-cyan-400/25 text-cyan-300';
    if (rate >= 15) return 'bg-cyan-400/15 text-gray-300';
    if (rate > 0) return 'bg-cyan-400/5 text-gray-400';
    return 'text-gray-600';
  }

  function formatCohort(dateStr: string): string {
    return dateStr.slice(0, 10);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="text-left text-gray-500 uppercase py-2 pr-3 sticky left-0 bg-gray-900">Cohort</th>
            <th className="text-right text-gray-500 uppercase py-2 px-2">Size</th>
            {Array.from({ length: maxPeriods }, (_, i) => (
              <th key={i} className="text-center text-gray-500 uppercase py-2 px-2 min-w-[50px]">
                {periodLabel}{i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.cohort} className="border-b border-gray-800 last:border-0">
              <td className="py-1.5 pr-3 text-gray-300 whitespace-nowrap sticky left-0 bg-gray-900">
                {formatCohort(c.cohort)}
              </td>
              <td className="py-1.5 px-2 text-right text-gray-400">{c.size}</td>
              {c.retention.map((rate, i) => (
                <td key={i} className={`py-1.5 px-2 text-center rounded ${retentionColor(rate)}`}>
                  {rate > 0 ? `${rate}%` : '-'}
                </td>
              ))}
              {/* Pad if fewer periods */}
              {Array.from({ length: maxPeriods - c.retention.length }, (_, i) => (
                <td key={`pad-${i}`} className="py-1.5 px-2" />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
