import { useEffect, useState } from 'react';

import { useAuth } from './auth';
import { getProfile, type Role } from './profile';

/**
 * Resolves the signed-in user's role from the `profiles` table.
 *
 * `loading` is true until the role is known, so callers can gate role-specific
 * UI (tabs, screens) without briefly flashing the wrong role. When there is no
 * signed-in user, the role resolves to null and loading becomes false.
 */
export function useRole(): { role: Role | null; loading: boolean } {
  const { user } = useAuth();
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    if (!user) {
      setRole(null);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    getProfile(user.id)
      .then((profile) => {
        if (!active) return;
        setRole(profile?.role ?? 'student');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  return { role, loading };
}
