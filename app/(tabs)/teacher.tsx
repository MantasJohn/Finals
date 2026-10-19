import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AppButton from '@/components/AppButton';
import RoleGate from '@/components/RoleGate';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import {
  getTeacherEventAttendance,
  type TeacherEventAttendance,
} from '@/lib/attendance';
import { deleteEvent, normalizeStatus, setEventStatus } from '@/lib/events';

export default function TeacherScreen() {
  return (
    <RoleGate
      allow={['teacher']}
      title="Teachers Only"
      message="Only teacher accounts can create and manage events."
    >
      <TeacherContent />
    </RoleGate>
  );
}

function TeacherContent() {
  const { user } = useAuth();
  const router = useRouter();
  const [events, setEvents] = useState<TeacherEventAttendance[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    if (!user) return;
    setEvents(await getTeacherEventAttendance(user.id));
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!user) {
        setLoading(false);
        return () => {
          active = false;
        };
      }
      setLoading(true);
      loadEvents().finally(() => {
        if (active) setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [user, loadEvents])
  );

  const handleToggleStatus = (event: TeacherEventAttendance) => {
    const next = normalizeStatus(event.status) === 'open' ? 'closed' : 'open';
    Alert.alert(
      next === 'closed' ? 'Close event' : 'Reopen event',
      next === 'closed'
        ? `"${event.title}" will stop accepting attendance.`
        : `"${event.title}" will accept attendance again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next === 'closed' ? 'Close' : 'Reopen',
          onPress: async () => {
            const { error } = await setEventStatus(event.eventId, next);
            if (error) {
              Alert.alert('Error', error);
              return;
            }
            await loadEvents();
          },
        },
      ]
    );
  };

  const handleDelete = (event: TeacherEventAttendance) => {
    Alert.alert(
      'Delete event',
      `Delete "${event.title}" and all of its attendance records? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await deleteEvent(event.eventId);
            if (error) {
              Alert.alert('Error', error);
              return;
            }
            await loadEvents();
          },
        },
      ]
    );
  };

  const totalScans = events.reduce((sum, e) => sum + e.attendeeCount, 0);
  const activeEvents = events.filter(
    (e) => normalizeStatus(e.status) === 'open'
  ).length;
  const average =
    events.length > 0 ? (totalScans / events.length).toFixed(1) : '0';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Event Management</Text>
      <Text style={styles.subtitle}>
        Create events, generate QR codes, monitor attendance and close events.
      </Text>

      <AppButton
        theme="primary"
        title="Create Event"
        icon="add-circle-outline"
        onPress={() => router.push('/event-editor')}
      />

      <Text style={styles.sectionTitle}>Attendance Summary</Text>
      <View style={styles.summaryRow}>
        <SummaryTile label="Events" value={String(events.length)} />
        <SummaryTile label="Open" value={String(activeEvents)} />
        <SummaryTile label="Scans" value={String(totalScans)} />
        <SummaryTile label="Avg" value={average} />
      </View>

      <Text style={styles.sectionTitle}>My Events</Text>
      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={styles.loader} />
      ) : events.length === 0 ? (
        <Text style={styles.emptyText}>
          No events yet. Tap "Create Event" to get started.
        </Text>
      ) : (
        events.map((event) => {
          const status = normalizeStatus(event.status);
          const open = status === 'open';
          return (
            <View key={event.eventId} style={styles.card}>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/event-details',
                    params: { id: event.eventId },
                  })
                }
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{event.title}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      open ? styles.badgeOpen : styles.badgeClosed,
                    ]}
                  >
                    <Text style={styles.statusBadgeText}>
                      {open ? 'OPEN' : 'CLOSED'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.cardCode}>{event.eventCode}</Text>
                {event.venue ? (
                  <Text style={styles.cardMeta}>
                    <Ionicons name="location-outline" size={12} /> {event.venue}
                  </Text>
                ) : null}
                {event.startTime && (
                  <Text style={styles.cardMeta}>{formatFull(event.startTime)}</Text>
                )}
                <Text style={styles.cardMeta}>
                  {event.attendeeCount} attendee(s)
                </Text>
              </Pressable>

              <View style={styles.actions}>
                <ManageAction
                  icon="eye-outline"
                  label="View"
                  onPress={() =>
                    router.push({
                      pathname: '/event-details',
                      params: { id: event.eventId },
                    })
                  }
                />
                <ManageAction
                  icon="create-outline"
                  label="Edit"
                  onPress={() =>
                    router.push({
                      pathname: '/event-editor',
                      params: { id: event.eventId },
                    })
                  }
                />
                <ManageAction
                  icon={open ? 'lock-closed-outline' : 'lock-open-outline'}
                  label={open ? 'Close' : 'Reopen'}
                  onPress={() => handleToggleStatus(event)}
                />
                <ManageAction
                  icon="trash-outline"
                  label="Delete"
                  danger
                  onPress={() => handleDelete(event)}
                />
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function formatFull(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryTile}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

type ManageActionProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
};

function ManageAction({ icon, label, onPress, danger }: ManageActionProps) {
  const tint = danger ? COLORS.danger : COLORS.primary;
  return (
    <Pressable
      style={({ pressed }) => [styles.manageAction, pressed && styles.manageActionPressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={18} color={tint} />
      <Text style={[styles.manageActionText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 26,
    marginBottom: 12,
  },
  summaryRow: { flexDirection: 'row', gap: 8 },
  summaryTile: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryValue: { fontSize: 20, fontWeight: '700', color: COLORS.primary },
  summaryLabel: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  loader: { marginVertical: 20 },
  emptyText: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 19 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginRight: 8,
  },
  statusBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeOpen: { backgroundColor: COLORS.success },
  badgeClosed: { backgroundColor: COLORS.danger },
  statusBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  cardCode: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
    marginTop: 2,
  },
  cardMeta: { fontSize: 12, color: COLORS.textSecondary, marginTop: 3 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
  },
  manageAction: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 18,
    paddingVertical: 4,
  },
  manageActionPressed: { opacity: 0.6 },
  manageActionText: { fontSize: 13, fontWeight: '600', marginLeft: 5 },
});
