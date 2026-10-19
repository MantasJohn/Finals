import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS } from '@/constants/colors';
import { useRole } from '@/lib/role';
import { ROLE_LABELS, type Role } from '@/lib/profile';

type Props = {
  allow: Role[];
  children: ReactNode;
  title?: string;
  message?: string;
};

/**
 * Role-based access guard. Renders `children` only when the signed-in user's
 * role is in `allow`; otherwise shows a "restricted" message. Use it to wrap
 * any screen or section that must not be usable by other roles.
 */
export default function RoleGate({ allow, children, title, message }: Props) {
  const { role, loading } = useRole();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.checkingText}>Checking your account...</Text>
      </View>
    );
  }

  if (!role || !allow.includes(role)) {
    const allowedLabels = allow.map((r) => ROLE_LABELS[r]).join(' / ');
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed-outline" size={48} color={COLORS.textSecondary} />
        <Text style={styles.title}>{title ?? 'Restricted area'}</Text>
        <Text style={styles.message}>
          {message ??
            `This section is only available to ${allowedLabels} accounts.`}
        </Text>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 32,
  },
  checkingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  title: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  message: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
