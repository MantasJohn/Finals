import { StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/constants/colors';
import {
  ATTENDANCE_STATUS_LABELS,
  normalizeAttendanceStatus,
} from '@/lib/attendance';

const STATUS_COLORS: Record<string, string> = {
  present: COLORS.success,
  late: COLORS.warning,
  excused: COLORS.info,
  absent: COLORS.danger,
};

type Props = {
  status: string | null | undefined;
  small?: boolean;
};

/** Colored badge showing a record's attendance status (present/late/…). */
export default function AttendanceStatusBadge({ status, small }: Props) {
  const normalized = normalizeAttendanceStatus(status);
  return (
    <View
      style={[
        styles.badge,
        small && styles.badgeSmall,
        { backgroundColor: STATUS_COLORS[normalized] },
      ]}
    >
      <Text style={[styles.text, small && styles.textSmall]}>
        {ATTENDANCE_STATUS_LABELS[normalized].toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeSmall: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  textSmall: {
    fontSize: 9,
  },
});
