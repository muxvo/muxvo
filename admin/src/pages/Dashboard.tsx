import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';

interface Stats {
  totalUsers: number;
  activeUsers: number;
  publishedShowcases: number;
  publishedSkills: number;
  signupTrend: { date: string; count: number }[];
}

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<Stats>('/admin/stats')
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-8">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-5 mb-10">
        <StatCard label="Total Users" value={stats.totalUsers} />
        <StatCard label="Active Users" value={stats.activeUsers} />
        <StatCard label="Published Showcases" value={stats.publishedShowcases} />
        <StatCard label="Marketplace Skills" value={stats.publishedSkills} />
      </div>

      {/* Signup trend */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Signups (Last 30 Days)</h2>
        {stats.signupTrend.length === 0 ? (
          <p className="text-gray-500 text-sm">No signup data yet.</p>
        ) : (
          <SignupChart data={stats.signupTrend} />
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-3xl font-bold text-amber-400">{value.toLocaleString()}</p>
    </div>
  );
}

function SignupChart({ data }: { data: { date: string; count: number }[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="flex items-end gap-1 h-40">
      {data.map((d) => {
        const height = (d.count / maxCount) * 100;
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center group relative">
            <div
              className="w-full bg-amber-400/80 rounded-t transition-all hover:bg-amber-400"
              style={{ height: `${Math.max(height, 2)}%` }}
            />
            <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-800 text-xs text-white px-2 py-1 rounded whitespace-nowrap">
              {d.date}: {d.count} signup{d.count !== 1 ? 's' : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}
