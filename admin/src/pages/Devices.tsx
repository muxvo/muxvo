import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface DeviceItem {
  id: string;
  device_id: string;
  user_id: string | null;
  user_email: string | null;
  user_display_name: string | null;
  platform: string | null;
  arch: string | null;
  os_version: string | null;
  app_version: string | null;
  hostname: string | null;
  last_ip: string | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
}

interface DevicesResponse {
  items: DeviceItem[];
  total: number;
  page: number;
  limit: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type StatusFilter = '' | 'active' | 'blocked';

export function Devices() {
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [items, setItems] = useState<DeviceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDevices = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (search) params.set('q', search);
    if (statusFilter) params.set('status', statusFilter);

    apiFetch<DevicesResponse>(`/admin/devices?${params}`)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [page, limit, search, statusFilter]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  async function toggleStatus(device: DeviceItem) {
    const newStatus = device.status === 'active' ? 'blocked' : 'active';
    await apiFetch(`/admin/devices/${device.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });
    fetchDevices();
  }

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-gray-500">Loading devices...</p>
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

  const totalPages = Math.ceil(total / limit);

  const statusBtn = (value: StatusFilter, label: string) => (
    <button
      key={value}
      onClick={() => {
        setStatusFilter(value);
        setPage(1);
      }}
      className={
        statusFilter === value
          ? 'px-3 py-2 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-400 text-sm'
          : 'px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 text-sm hover:border-gray-600 transition-colors'
      }
    >
      {label}
    </button>
  );

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-8">Devices</h1>

      {/* Controls bar */}
      <div className="flex items-center gap-3 mb-8 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search hostname or device ID..."
          className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm outline-none focus:border-amber-400 transition-colors"
        />
        <div className="flex gap-2 ml-2">
          {statusBtn('', 'All')}
          {statusBtn('active', 'Active')}
          {statusBtn('blocked', 'Blocked')}
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        {items.length === 0 ? (
          <p className="text-gray-500 text-sm">No devices found.</p>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-gray-500 text-xs uppercase py-2 pr-4">Device ID</th>
                  <th className="text-left text-gray-500 text-xs uppercase py-2 pr-4">Platform</th>
                  <th className="text-left text-gray-500 text-xs uppercase py-2 pr-4">Version</th>
                  <th className="text-left text-gray-500 text-xs uppercase py-2 pr-4">Hostname</th>
                  <th className="text-left text-gray-500 text-xs uppercase py-2 pr-4">User</th>
                  <th className="text-left text-gray-500 text-xs uppercase py-2 pr-4">IP</th>
                  <th className="text-left text-gray-500 text-xs uppercase py-2 pr-4">Last Seen</th>
                  <th className="text-left text-gray-500 text-xs uppercase py-2 pr-4">Status</th>
                  <th className="text-left text-gray-500 text-xs uppercase py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((device) => (
                  <tr key={device.id} className="border-b border-gray-800 last:border-0">
                    <td className="py-2 pr-4 text-sm font-mono text-gray-300">
                      {device.device_id.slice(0, 8)}...
                    </td>
                    <td className="py-2 pr-4 text-sm text-gray-300">{device.platform || '—'}</td>
                    <td className="py-2 pr-4 text-sm text-gray-300">{device.app_version || '—'}</td>
                    <td className="py-2 pr-4 text-sm text-gray-300">{device.hostname || '—'}</td>
                    <td className="py-2 pr-4 text-sm text-gray-300">
                      {device.user_display_name || device.user_email || '—'}
                    </td>
                    <td className="py-2 pr-4 text-sm text-gray-300">{device.last_ip || '—'}</td>
                    <td className="py-2 pr-4 text-sm text-gray-400">{timeAgo(device.last_seen_at)}</td>
                    <td className="py-2 pr-4 text-sm">
                      {device.status === 'active' ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-green-400/10 text-green-400">
                          active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-red-400/10 text-red-400">
                          blocked
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-sm">
                      {device.status === 'active' ? (
                        <button
                          onClick={() => toggleStatus(device)}
                          className="px-3 py-1 rounded text-xs bg-red-400/10 text-red-400 hover:bg-red-400/20 transition-colors cursor-pointer"
                        >
                          Block
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleStatus(device)}
                          className="px-3 py-1 rounded text-xs bg-green-400/10 text-green-400 hover:bg-green-400/20 transition-colors cursor-pointer"
                        >
                          Unblock
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
              <span>
                Showing {items.length} of {total} devices
              </span>
              <div className="flex gap-2 items-center">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1 rounded-lg bg-gray-800 border border-gray-700 text-sm disabled:opacity-40 hover:border-gray-600 transition-colors"
                >
                  Previous
                </button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1 rounded-lg bg-gray-800 border border-gray-700 text-sm disabled:opacity-40 hover:border-gray-600 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
