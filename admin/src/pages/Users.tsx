import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface User {
  id: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  status: string;
  role: string;
  createdAt: string;
}

interface UsersResponse {
  items: User[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 20;

export function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));
    if (search) params.set('q', search);
    if (statusFilter) params.set('status', statusFilter);

    try {
      const data = await apiFetch<UsersResponse>(`/admin/users?${params}`);
      setUsers(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchUsers, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchUsers]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleStatusChange = async (userId: string, newStatus: string) => {
    try {
      await apiFetch(`/admin/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await apiFetch(`/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Users</h1>

      {/* Toolbar */}
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 max-w-sm px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-white text-sm outline-none focus:border-amber-400 transition-colors"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-white text-sm outline-none focus:border-amber-400"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="deleted">Deleted</option>
        </select>
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-left">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading...</td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No users found</td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="" className="w-7 h-7 rounded-full" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-400">
                          {(user.displayName || '?')[0].toUpperCase()}
                        </div>
                      )}
                      <span className="text-white">{user.displayName || '(no name)'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{user.email || '-'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={user.role === 'admin' ? 'text-amber-400 font-medium' : 'text-gray-400'}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {user.status === 'active' ? (
                        <ActionButton label="Suspend" onClick={() => handleStatusChange(user.id, 'suspended')} variant="warn" />
                      ) : user.status === 'suspended' ? (
                        <ActionButton label="Activate" onClick={() => handleStatusChange(user.id, 'active')} variant="success" />
                      ) : null}
                      {user.role === 'user' ? (
                        <ActionButton label="Make Admin" onClick={() => handleRoleChange(user.id, 'admin')} variant="default" />
                      ) : (
                        <ActionButton label="Remove Admin" onClick={() => handleRoleChange(user.id, 'user')} variant="default" />
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded bg-gray-900 border border-gray-800 disabled:opacity-30 hover:border-gray-600 transition-colors cursor-pointer disabled:cursor-default"
            >
              Previous
            </button>
            <button
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded bg-gray-900 border border-gray-800 disabled:opacity-30 hover:border-gray-600 transition-colors cursor-pointer disabled:cursor-default"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'text-green-400 bg-green-400/10',
    suspended: 'text-yellow-400 bg-yellow-400/10',
    deleted: 'text-red-400 bg-red-400/10',
  };
  const cls = colors[status] || 'text-gray-400 bg-gray-400/10';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {status}
    </span>
  );
}

function ActionButton({ label, onClick, variant }: { label: string; onClick: () => void; variant: 'warn' | 'success' | 'default' }) {
  const base = 'px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer';
  const colors = {
    warn: 'text-yellow-400 bg-yellow-400/10 hover:bg-yellow-400/20',
    success: 'text-green-400 bg-green-400/10 hover:bg-green-400/20',
    default: 'text-gray-400 bg-gray-400/10 hover:bg-gray-400/20',
  };
  return (
    <button onClick={onClick} className={`${base} ${colors[variant]}`}>
      {label}
    </button>
  );
}
