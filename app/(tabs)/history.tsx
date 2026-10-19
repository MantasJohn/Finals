import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/constants/colors';
import AttendanceStatusBadge from '@/components/AttendanceStatusBadge';
import { useAuth } from '@/lib/auth';
import { getAttendanceHistory, type AttendanceRecord } from '@/lib/attendance';
import { getProfile, type Role } from '@/lib/profile';
import { getTeacherEventAttendance, type TeacherEventAttendance } from '@/lib/attendance';
import {
  getAllAttendanceRecords,
  type AdminAttendanceRecord,
} from '@/lib/admin';

export default function HistoryScreen() {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [studentRecords, setStudentRecords] = useState<AttendanceRecord[]>([]);
  const [teacherEvents, setTeacherEvents] = useState<TeacherEventAttendance[]>([]);
  const [adminRecords, setAdminRecords] = useState<AdminAttendanceRecord[]>([]);
  const { user } = useAuth();

  const load = useCallback(async () => {
    // Reset per-account state on every load so switching accounts
    // (teacher -> student -> teacher) never shows the previous user's data.
    setLoading(true);
    if (!user) {
      setRole(null);
      setStudentRecords([]);
      setTeacherEvents([]);
      setAdminRecords([]);
      setLoading(false);
      return;
    }

    const profile = await getProfile(user.id);
    const currentRole = profile?.role ?? 'student';
    setRole(currentRole);

    if (currentRole === 'teacher') {
      const events = await getTeacherEventAttendance(user.id);
      setTeacherEvents(events);
      setStudentRecords([]);
      setAdminRecords([]);
    } else if (currentRole === 'admin') {
      // Administrators can view attendance records for the whole system.
      const records = await getAllAttendanceRecords();
      setAdminRecords(records);
      setTeacherEvents([]);
      setStudentRecords([]);
    } else {
      const records = await getAttendanceHistory(user.id);
      setStudentRecords(records);
      setTeacherEvents([]);
      setAdminRecords([]);
    }

    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Attendance History</Text>
        <Text style={styles.subtitle}>Loading records...</Text>
      </View>
    );
  }

  if (role === 'admin') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>System Attendance</Text>
        <Text style={styles.sectionMeta}>
          {adminRecords.length} record(s) across all events
        </Text>
        <Text style={styles.hint}>
          Read-only overview. Correct or delete records in the Admin tab.
        </Text>

        {adminRecords.length === 0 ? (
          <Text style={styles.subtitle}>No attendance records yet.</Text>
        ) : (
          <FlatList
            data={adminRecords}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.eventTitle}>
                    {item.studentName || shortId(item.studentId)}
                  </Text>
                  <AttendanceStatusBadge status={item.status} />
                </View>
                <Text style={styles.eventMeta}>{item.eventTitle} · {item.eventCode}</Text>
                <Text style={styles.eventMeta}>Date: {formatDateOnly(item.scannedAt)}</Text>
                <Text style={styles.eventMeta}>Time: {formatTimeOnly(item.scannedAt)}</Text>
              </View>
            )}
          />
        )}
      </View>
    );
  }

  if (role === 'teacher') {
    const totalScans = teacherEvents.reduce(
      (sum, e) => sum + e.attendeeCount,
      0
    );
    return (
      <View style={styles.container}>
        <Text style={styles.title}>My Events</Text>
        {teacherEvents.length > 0 && (
          <Text style={styles.sectionMeta}>
            {teacherEvents.length} event(s) · {totalScans} scan(s)
          </Text>
        )}

        {teacherEvents.length === 0 ? (
          <Text style={styles.subtitle}>
            No events yet. Create an event to start recording attendance.
          </Text>
        ) : (
          <FlatList
            data={teacherEvents}
            keyExtractor={(item) => item.eventId}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.eventTitle}>{item.title}</Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{item.attendeeCount}</Text>
                  </View>
                </View>
                <Text style={styles.eventMeta}>{item.eventCode}</Text>
                {item.startTime && (
                  <Text style={styles.eventMeta}>{formatDate(item.startTime)}</Text>
                )}

                {item.attendees.length > 0 ? (
                  <View style={styles.attendeeList}>
                    {item.attendees.map((a, index) => (
                      <View key={`${a.studentId}-${index}`} style={styles.attendeeRow}>
                        <Text style={styles.attendeeId}>{a.studentName || shortId(a.studentId)}</Text>
                        <View style={styles.attendeeRight}>
                          <Text style={styles.attendeeTime}>{formatDate(a.scannedAt)}</Text>
                          <AttendanceStatusBadge status={a.status} small />
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.noScansText}>No scans yet.</Text>
                )}
              </View>
            )}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Attendance History</Text>
      <Text style={styles.sectionMeta}>
        {studentRecords.length} event(s) attended
      </Text>

      {studentRecords.length === 0 ? (
        <Text style={styles.subtitle}>
          No records yet. Scan a QR code to register your attendance.
        </Text>
      ) : (
        <FlatList
          data={studentRecords}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.eventTitle}>{item.eventTitle}</Text>
                <AttendanceStatusBadge status={item.status} />
              </View>
              <Text style={styles.eventMeta}>{item.eventId}</Text>
              <Text style={styles.eventMeta}>Date: {formatDateOnly(item.scannedAt)}</Text>
              <Text style={styles.eventMeta}>Time: {formatTimeOnly(item.scannedAt)}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function formatDateOnly(iso: string) {
  return new Date(iso).toLocaleDateString();
}

function formatTimeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString();
}

function shortId(id: string) {
  return id ? `…${id.slice(-8)}` : 'unknown';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 32,
  },
  sectionMeta: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  list: {
    paddingBottom: 24,
  },
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
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  eventMeta: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  countBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  attendeeList: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
  },
  attendeeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  attendeeRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  attendeeId: {
    fontSize: 12,
    color: COLORS.textPrimary,
    fontFamily: 'monospace',
  },
  attendeeTime: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  noScansText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginTop: 8,
  },
});