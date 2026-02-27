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

function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  confirmColor,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: 'red' | 'green';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  const colors = confirmColor === 'red'
    ? 'bg-red-500 hover:bg-red-600 text-white'
    : 'bg-green-500 hover:bg-green-600 text-white';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-gray-400 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-300 hover:border-gray-500 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${colors}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Devices() {
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [items, setItems] = useState<DeviceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<DeviceItem | null>(null);

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

  async function confirmToggle() {
    if (!confirmTarget) return;
    const newStatus = confirmTarget.status === 'active' ? 'blocked' : 'active';
    await apiFetch(`/admin/devices/${confirmTarget.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });
    setConfirmTarget(null);
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
                          onClick={() => setConfirmTarget(device)}
                          className="px-3 py-1 rounded text-xs bg-red-400/10 text-red-400 hover:bg-red-400/20 transition-colors cursor-pointer"
                        >
                          Block
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmTarget(device)}
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

      <ConfirmModal
        open={!!confirmTarget}
        title={confirmTarget?.status === 'active' ? 'Block Device' : 'Unblock Device'}
        message={
          confirmTarget?.status === 'active'
            ? `Block "${confirmTarget?.hostname || confirmTarget?.device_id.slice(0, 8)}"? This device will be unable to use Muxvo on next launch.`
            : `Unblock "${confirmTarget?.hostname || confirmTarget?.device_id.slice(0, 8)}"? This device will be able to use Muxvo again.`
        }
        confirmLabel={confirmTarget?.status === 'active' ? 'Block' : 'Unblock'}
        confirmColor={confirmTarget?.status === 'active' ? 'red' : 'green'}
        onConfirm={confirmToggle}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
