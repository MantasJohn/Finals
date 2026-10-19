import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import AppButton from '@/components/AppButton';
import AttendanceStatusBadge from '@/components/AttendanceStatusBadge';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { useRole } from '@/lib/role';
import {
  deleteEvent,
  getEventById,
  normalizeStatus,
  setEventStatus,
  type CloudEvent,
} from '@/lib/events';
import { buildQRPayload } from '@/lib/qr';
import { getEventAttendance, type EventAttendee } from '@/lib/attendance';

export default function EventDetailsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { role } = useRole();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<CloudEvent | null>(null);
  const [attendees, setAttendees] = useState<EventAttendee[]>([]);
  const [showQr, setShowQr] = useState(false);
  const [busy, setBusy] = useState(false);

  const isStaff = role === 'teacher' || role === 'admin';
  const canManage =
    role === 'admin' ||
    (role === 'teacher' && !!user && event?.created_by === user.id);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    const found = await getEventById(id);
    setEvent(found);

    if (found && (role === 'teacher' || role === 'admin')) {
      setAttendees(await getEventAttendance(found.id));
    } else {
      setAttendees([]);
    }
  }, [id, role]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      load().finally(() => {
        if (active) setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [load])
  );

  const handleToggleStatus = () => {
    if (!event) return;
    const next = normalizeStatus(event.status) === 'open' ? 'closed' : 'open';
    Alert.alert(
      next === 'closed' ? 'Close event' : 'Reopen event',
      next === 'closed'
        ? 'Students will no longer be able to record attendance for this event.'
        : 'Students will be able to record attendance again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next === 'closed' ? 'Close' : 'Reopen',
          onPress: async () => {
            setBusy(true);
            const { error } = await setEventStatus(event.id, next);
            setBusy(false);
            if (error) {
              Alert.alert('Error', error);
              return;
            }
            await load();
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    if (!event) return;
    Alert.alert(
      'Delete event',
      `Delete "${event.title}" and all of its attendance records?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await deleteEvent(event.id);
            if (error) {
              Alert.alert('Error', error);
              return;
            }
            router.back();
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.center}>
        <Ionicons name="calendar-outline" size={48} color={COLORS.textSecondary} />
        <Text style={styles.emptyTitle}>Event not found</Text>
        <Text style={styles.emptyText}>
          This event may have been deleted.
        </Text>
      </View>
    );
  }

  const status = normalizeStatus(event.status);
  const isOpen = status === 'open';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{event.title}</Text>
        <View style={[styles.statusBadge, isOpen ? styles.badgeOpen : styles.badgeClosed]}>
          <Text style={styles.statusBadgeText}>{isOpen ? 'OPEN' : 'CLOSED'}</Text>
        </View>
      </View>
      <Text style={styles.code}>{event.event_code}</Text>

      <View style={styles.detailCard}>
        <DetailRow icon="calendar-outline" label="Date" value={datePart(event.start_time)} />
        <DetailRow
          icon="time-outline"
          label="Time"
          value={`${timePart(event.start_time)} – ${timePart(event.end_time)}`}
        />
        <DetailRow icon="location-outline" label="Venue" value={event.venue || 'Not specified'} />
        <DetailRow
          icon="information-circle-outline"
          label="Status"
          value={isOpen ? 'Open — accepting attendance' : 'Closed — no attendance'}
        />
      </View>

      <Text style={styles.sectionTitle}>Description</Text>
      <View style={styles.descriptionCard}>
        <Text style={styles.descriptionText}>
          {event.description?.trim() || 'No description provided.'}
        </Text>
      </View>

      {isStaff && (
        <>
          <Text style={styles.sectionTitle}>
            Attendance ({attendees.length})
          </Text>
          {attendees.length === 0 ? (
            <Text style={styles.emptyText}>No one has checked in yet.</Text>
          ) : (
            <View style={styles.attendeeCard}>
              {attendees.map((a, index) => (
                <View key={`${a.studentId}-${index}`} style={styles.attendeeRow}>
                  <Text style={styles.attendeeName}>
                    {a.studentName || shortId(a.studentId)}
                  </Text>
                  <View style={styles.attendeeRight}>
                    <Text style={styles.attendeeTime}>{formatFull(a.scannedAt)}</Text>
                    <AttendanceStatusBadge status={a.status} small />
                  </View>
                </View>
              ))}
            </View>
          )}

          <Pressable
            style={styles.qrToggle}
            onPress={() => setShowQr((v) => !v)}
          >
            <Ionicons name="qr-code-outline" size={18} color={COLORS.primary} />
            <Text style={styles.qrToggleText}>
              {showQr ? 'Hide event QR code' : 'Show event QR code'}
            </Text>
          </Pressable>
          {showQr && (
            <View style={styles.qrBox}>
              <QRCode
                value={buildQRPayload({
                  eventId: event.event_code,
                  title: event.title,
                  start: event.start_time ?? undefined,
                  end: event.end_time ?? undefined,
                })}
                size={200}
              />
            </View>
          )}
        </>
      )}

      {canManage && (
        <View style={styles.actions}>
          <AppButton
            theme="primary"
            title={isOpen ? 'Close Event' : 'Reopen Event'}
            icon={isOpen ? 'lock-closed-outline' : 'lock-open-outline'}
            onPress={handleToggleStatus}
            disabled={busy}
          />
          <AppButton
            title="Edit Event"
            icon="create-outline"
            onPress={() =>
              router.push({ pathname: '/event-editor', params: { id: event.id } })
            }
          />
          <AppButton
            title="Delete Event"
            icon="trash-outline"
            onPress={handleDelete}
          />
        </View>
      )}

      {!isStaff && isOpen && (
        <View style={styles.actions}>
          <AppButton
            theme="primary"
            title="Scan QR to Attend"
            icon="qr-code-outline"
            onPress={() => router.push('/scan')}
          />
        </View>
      )}

      {!isStaff && !isOpen && (
        <Text style={styles.closedNote}>
          This event is closed and is no longer accepting attendance.
        </Text>
      )}
    </ScrollView>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={18} color={COLORS.primary} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function datePart(value: string | null) {
  if (!value) return 'TBA';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function timePart(value: string | null) {
  if (!value) return 'TBA';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFull(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function shortId(id: string) {
  return id ? `…${id.slice(-8)}` : 'unknown';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  emptyText: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginRight: 10,
  },
  statusBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeOpen: { backgroundColor: COLORS.success },
  badgeClosed: { backgroundColor: COLORS.danger },
  statusBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  code: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
    marginTop: 4,
    marginBottom: 16,
  },
  detailCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginLeft: 8,
    width: 70,
  },
  detailValue: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 22,
    marginBottom: 10,
  },
  descriptionCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
  },
  descriptionText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    lineHeight: 21,
  },
  attendeeCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  attendeeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  attendeeName: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  attendeeRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  attendeeTime: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginLeft: 10,
  },
  qrToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  qrToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
    marginLeft: 6,
  },
  qrBox: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 12,
  },
  actions: {
    marginTop: 24,
  },
  closedNote: {
    marginTop: 24,
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
});
