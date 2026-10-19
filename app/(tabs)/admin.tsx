import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { COLORS } from '@/constants/colors';
import AppButton from '@/components/AppButton';
import AttendanceStatusBadge from '@/components/AttendanceStatusBadge';
import RoleGate from '@/components/RoleGate';
import { ROLE_LABELS, type Profile, type Role } from '@/lib/profile';
import {
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatus,
} from '@/lib/attendance';
import {
  deleteAttendanceRecord,
  getAllAttendanceRecords,
  getAttendanceReport,
  listAllProfiles,
  updateAttendanceRecord,
  updateUserRole,
  type AdminAttendanceRecord,
  type AttendanceReport,
} from '@/lib/admin';
import { deleteEvent, getAllEvents, normalizeStatus, setEventStatus, type CloudEvent } from '@/lib/events';

type AdminTab = 'users' | 'events' | 'attendance' | 'reports';

const TABS: { id: AdminTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'users', label: 'Users', icon: 'people-outline' },
  { id: 'events', label: 'Events', icon: 'calendar-outline' },
  { id: 'attendance', label: 'Attendance', icon: 'checkmark-done-outline' },
  { id: 'reports', label: 'Reports', icon: 'bar-chart-outline' },
];

const ROLE_OPTIONS: Role[] = ['student', 'teacher', 'admin'];

const ATTENDANCE_STATUS_OPTIONS: AttendanceStatus[] = [
  'present',
  'late',
  'excused',
  'absent',
];

export default function AdminScreen() {
  return (
    <RoleGate
      allow={['admin']}
      title="Administrators Only"
      message="This area is restricted to administrator accounts."
    >
      <AdminContent />
    </RoleGate>
  );
}

function AdminContent() {
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>('users');
  const [loading, setLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const [users, setUsers] = useState<Profile[]>([]);
  const [events, setEvents] = useState<CloudEvent[]>([]);
  const [records, setRecords] = useState<AdminAttendanceRecord[]>([]);
  const [report, setReport] = useState<AttendanceReport | null>(null);

  // Inline attendance correction state (scan time + status).
  const [correcting, setCorrecting] = useState<AdminAttendanceRecord | null>(null);
  const [draftDate, setDraftDate] = useState(new Date());
  const [draftStatus, setDraftStatus] = useState<AttendanceStatus>('present');
  const [editingPart, setEditingPart] = useState<'date' | 'time'>('date');
  const [savingCorrection, setSavingCorrection] = useState(false);

  const isAndroid = Platform.OS === 'android';

  const loadAll = useCallback(async () => {
    const [profileRows, eventRows, recordRows, reportData] = await Promise.all([
      listAllProfiles(),
      getAllEvents(),
      getAllAttendanceRecords(),
      getAttendanceReport(),
    ]);
    setUsers(profileRows);
    setEvents(eventRows);
    setRecords(recordRows);
    setReport(reportData);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      loadAll().finally(() => {
        if (active) setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [loadAll])
  );

  // ---------- User management ----------

  const handleChangeRole = (target: Profile, next: Role) => {
    if (target.role === next) return;
    Alert.alert(
      'Change role',
      `Change ${target.full_name || target.email}'s role to ${ROLE_LABELS[next]}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change',
          onPress: async () => {
            setUpdatingUserId(target.id);
            const { error } = await updateUserRole(target.id, next);
            setUpdatingUserId(null);
            if (error) {
              Alert.alert('Error', error);
              return;
            }
            await loadAll();
          },
        },
      ]
    );
  };

  // ---------- Event management ----------

  const handleDeleteEvent = (event: CloudEvent) => {
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
            await loadAll();
          },
        },
      ]
    );
  };

  const handleToggleEventStatus = (event: CloudEvent) => {
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
            const { error } = await setEventStatus(event.id, next);
            if (error) {
              Alert.alert('Error', error);
              return;
            }
            await loadAll();
          },
        },
      ]
    );
  };

  // ---------- Attendance corrections ----------

  const startCorrection = (record: AdminAttendanceRecord) => {
    const parsed = new Date(record.scannedAt);
    setDraftDate(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
    setDraftStatus(record.status);
    setEditingPart('date');
    setCorrecting(record);
  };

  const onCorrectionPickerChange = (
    event: DateTimePickerEvent,
    selected?: Date
  ) => {
    if (event.type === 'dismissed' || !selected) return;
    const next = new Date(draftDate);
    next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    setDraftDate(next);
    if (isAndroid && editingPart === 'date') setEditingPart('time');
  };

  const saveCorrection = async () => {
    if (!correcting) return;
    setSavingCorrection(true);
    const { error } = await updateAttendanceRecord(correcting.id, {
      scanned_at: draftDate.toISOString(),
      status: draftStatus,
    });
    setSavingCorrection(false);
    if (error) {
      Alert.alert('Error', error);
      return;
    }
    setCorrecting(null);
    await loadAll();
  };

  const handleDeleteRecord = (record: AdminAttendanceRecord) => {
    Alert.alert('Delete record', 'Remove this attendance record?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteAttendanceRecord(record.id);
          if (error) {
            Alert.alert('Error', error);
            return;
          }
          await loadAll();
        },
      },
    ]);
  };

  // ---------- Gating handled by <RoleGate> above ----------

  const studentCount = users.filter((u) => u.role === 'student').length;
  const teacherCount = users.filter((u) => u.role === 'teacher').length;
  const adminCount = users.filter((u) => u.role === 'admin').length;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Administrator</Text>
      <Text style={styles.subtitle}>
        Manage users and events, review overall attendance, and correct records.
      </Text>

      <View style={styles.tabBar}>
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <Pressable
              key={item.id}
              style={[styles.tabChip, active && styles.tabChipActive]}
              onPress={() => setTab(item.id)}
            >
              <Ionicons
                name={item.icon}
                size={16}
                color={active ? '#fff' : COLORS.textSecondary}
              />
              <Text
                style={[styles.tabChipText, active && styles.tabChipTextActive]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator
          size="large"
          color={COLORS.primary}
          style={styles.loader}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {tab === 'users' && (
            <>
              <View style={styles.summaryRow}>
                <SummaryTile label="Students" value={studentCount} />
                <SummaryTile label="Teachers" value={teacherCount} />
                <SummaryTile label="Admins" value={adminCount} />
              </View>
              <Text style={styles.sectionMeta}>{users.length} user(s)</Text>
              {users.map((item) => (
                <View key={item.id} style={styles.card}>
                  <Text style={styles.cardTitle}>
                    {item.full_name || 'Unnamed user'}
                  </Text>
                  <Text style={styles.cardSub}>{item.email}</Text>

                  <View style={styles.roleRow}>
                    {ROLE_OPTIONS.map((option) => {
                      const active = item.role === option;
                      return (
                        <Pressable
                          key={option}
                          disabled={updatingUserId === item.id}
                          style={[styles.roleChip, active && styles.roleChipActive]}
                          onPress={() => handleChangeRole(item, option)}
                        >
                          <Text
                            style={[
                              styles.roleChipText,
                              active && styles.roleChipTextActive,
                            ]}
                          >
                            {ROLE_LABELS[option]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {updatingUserId === item.id && (
                    <Text style={styles.updatingText}>Updating...</Text>
                  )}
                </View>
              ))}
            </>
          )}

          {tab === 'events' && (
            <>
              <AppButton
                theme="primary"
                title="Create Event"
                icon="add-circle-outline"
                onPress={() => router.push('/event-editor')}
              />
              <Text style={styles.sectionMeta}>{events.length} event(s)</Text>
              {events.length === 0 ? (
                <Text style={styles.emptyText}>No events in the system.</Text>
              ) : (
                events.map((event) => {
                  const status = normalizeStatus(event.status);
                  const open = status === 'open';
                  return (
                    <View key={event.id} style={styles.card}>
                      <View style={styles.cardHeaderRow}>
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
                      <Text style={styles.codeText}>{event.event_code}</Text>
                      <Text style={styles.cardSub}>
                        Owned by: {ownerLabel(event.created_by, users)}
                      </Text>
                      {event.venue && (
                        <Text style={styles.cardSub}>Venue: {event.venue}</Text>
                      )}
                      {event.start_time && (
                        <Text style={styles.cardSub}>
                          Starts: {formatFull(event.start_time)}
                        </Text>
                      )}
                      {event.end_time && (
                        <Text style={styles.cardSub}>
                          Ends: {formatFull(event.end_time)}
                        </Text>
                      )}

                      <View style={styles.recordActions}>
                        <Pressable
                          style={styles.recordAction}
                          onPress={() =>
                            router.push({
                              pathname: '/event-details',
                              params: { id: event.id },
                            })
                          }
                        >
                          <Ionicons name="eye-outline" size={16} color={COLORS.primary} />
                          <Text style={styles.recordActionText}>View</Text>
                        </Pressable>
                        <Pressable
                          style={styles.recordAction}
                          onPress={() =>
                            router.push({
                              pathname: '/event-editor',
                              params: { id: event.id },
                            })
                          }
                        >
                          <Ionicons name="create-outline" size={16} color={COLORS.primary} />
                          <Text style={styles.recordActionText}>Edit</Text>
                        </Pressable>
                        <Pressable
                          style={styles.recordAction}
                          onPress={() => handleToggleEventStatus(event)}
                        >
                          <Ionicons
                            name={open ? 'lock-closed-outline' : 'lock-open-outline'}
                            size={16}
                            color={COLORS.primary}
                          />
                          <Text style={styles.recordActionText}>
                            {open ? 'Close' : 'Reopen'}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={styles.recordAction}
                          onPress={() => handleDeleteEvent(event)}
                        >
                          <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                          <Text
                            style={[styles.recordActionText, { color: COLORS.danger }]}
                          >
                            Delete
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )}
            </>
          )}

          {tab === 'attendance' && (
            <>
              <Text style={styles.sectionMeta}>{records.length} record(s)</Text>
              {records.length === 0 ? (
                <Text style={styles.emptyText}>No attendance records yet.</Text>
              ) : (
                records.map((record) => (
                  <View key={record.id} style={styles.card}>
                    <View style={styles.cardHeaderRow}>
                      <Text style={styles.cardTitle}>
                        {record.studentName || shortId(record.studentId)}
                      </Text>
                      <AttendanceStatusBadge status={record.status} />
                    </View>
                    {record.studentEmail && (
                      <Text style={styles.cardSub}>{record.studentEmail}</Text>
                    )}
                    <Text style={styles.codeText}>
                      {record.eventTitle} · {record.eventCode}
                    </Text>
                    <Text style={styles.cardSub}>
                      Date: {formatDateOnly(record.scannedAt)}
                    </Text>
                    <Text style={styles.cardSub}>
                      Time: {formatTimeOnly(record.scannedAt)}
                    </Text>

                    {correcting?.id === record.id ? (
                      <View style={styles.correctionBox}>
                        <Text style={styles.correctionLabel}>
                          Correct scan time
                        </Text>
                        <DateTimePicker
                          value={draftDate}
                          mode={isAndroid ? editingPart : 'datetime'}
                          display={isAndroid ? 'default' : 'spinner'}
                          onChange={onCorrectionPickerChange}
                        />
                        <Text style={styles.correctionLabel}>Attendance status</Text>
                        <View style={styles.statusOptionRow}>
                          {ATTENDANCE_STATUS_OPTIONS.map((option) => {
                            const active = draftStatus === option;
                            return (
                              <Pressable
                                key={option}
                                style={[
                                  styles.statusOption,
                                  active && styles.statusOptionActive,
                                ]}
                                onPress={() => setDraftStatus(option)}
                              >
                                <Text
                                  style={[
                                    styles.statusOptionText,
                                    active && styles.statusOptionTextActive,
                                  ]}
                                >
                                  {ATTENDANCE_STATUS_LABELS[option]}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <View style={styles.correctionActions}>
                          <Pressable
                            style={[styles.smallButton, styles.smallButtonGhost]}
                            onPress={() => setCorrecting(null)}
                            disabled={savingCorrection}
                          >
                            <Text style={styles.smallButtonGhostText}>Cancel</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.smallButton, styles.smallButtonPrimary]}
                            onPress={saveCorrection}
                            disabled={savingCorrection}
                          >
                            <Text style={styles.smallButtonPrimaryText}>
                              {savingCorrection ? 'Saving...' : 'Save'}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.recordActions}>
                        <Pressable
                          style={styles.recordAction}
                          onPress={() => startCorrection(record)}
                        >
                          <Ionicons
                            name="create-outline"
                            size={16}
                            color={COLORS.primary}
                          />
                          <Text style={styles.recordActionText}>Correct record</Text>
                        </Pressable>
                        <Pressable
                          style={styles.recordAction}
                          onPress={() => handleDeleteRecord(record)}
                        >
                          <Ionicons
                            name="trash-outline"
                            size={16}
                            color={COLORS.danger}
                          />
                          <Text
                            style={[styles.recordActionText, { color: COLORS.danger }]}
                          >
                            Delete
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                ))
              )}
            </>
          )}

          {tab === 'reports' && report && (
            <>
              <View style={styles.summaryRow}>
                <SummaryTile label="Events" value={report.totalEvents} />
                <SummaryTile label="Scans" value={report.totalScans} />
              </View>
              <View style={styles.summaryRow}>
                <SummaryTile label="Students" value={report.totalStudents} />
                <SummaryTile label="Teachers" value={report.totalTeachers} />
                <SummaryTile label="Admins" value={report.totalAdmins} />
              </View>

              <Text style={styles.sectionTitle}>Attendance status</Text>
              <View style={styles.summaryRow}>
                <SummaryTile
                  label="Present"
                  value={report.byStatus.present}
                />
                <SummaryTile label="Late" value={report.byStatus.late} />
              </View>
              <View style={styles.summaryRow}>
                <SummaryTile label="Excused" value={report.byStatus.excused} />
                <SummaryTile label="Absent" value={report.byStatus.absent} />
              </View>

              <Text style={styles.sectionTitle}>Scans per event</Text>
              {report.byEvent.length === 0 ? (
                <Text style={styles.emptyText}>No data yet.</Text>
              ) : (
                report.byEvent.map((row) => (
                  <View key={row.eventId} style={styles.reportRow}>
                    <View style={styles.reportInfo}>
                      <Text style={styles.cardTitle}>{row.title}</Text>
                      <Text style={styles.codeText}>{row.eventCode}</Text>
                    </View>
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>{row.count}</Text>
                    </View>
                  </View>
                ))
              )}

              <Text style={styles.sectionTitle}>Most active students</Text>
              {report.topStudents.length === 0 ? (
                <Text style={styles.emptyText}>No data yet.</Text>
              ) : (
                report.topStudents.map((row) => (
                  <View key={row.studentId} style={styles.reportRow}>
                    <View style={styles.reportInfo}>
                      <Text style={styles.cardTitle}>
                        {row.name || shortId(row.studentId)}
                      </Text>
                      {row.email && (
                        <Text style={styles.cardSub}>{row.email}</Text>
                      )}
                    </View>
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>{row.count}</Text>
                    </View>
                  </View>
                ))
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.summaryTile}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function ownerLabel(createdBy: string | null, users: Profile[]) {
  if (!createdBy) return 'Unknown';
  const owner = users.find((u) => u.id === createdBy);
  return owner?.full_name || owner?.email || shortId(createdBy);
}

function formatFull(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDateOnly(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function formatTimeOnly(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

function shortId(id: string) {
  return id ? `…${id.slice(-8)}` : 'unknown';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 32,
  },
  lockedTitle: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  lockedText: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
    marginBottom: 14,
  },
  tabBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabChipActive: {
    backgroundColor: COLORS.primary,
  },
  tabChipText: {
    marginLeft: 5,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  tabChipTextActive: {
    color: '#fff',
  },
  loader: {
    marginTop: 40,
  },
  content: {
    paddingTop: 12,
    paddingBottom: 40,
  },
  sectionMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 22,
    marginBottom: 10,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  cardSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  codeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
    marginTop: 3,
  },
  statusBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
  },
  badgeOpen: { backgroundColor: COLORS.success },
  badgeClosed: { backgroundColor: COLORS.danger },
  statusBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  roleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  roleChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  roleChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  roleChipTextActive: {
    color: '#fff',
  },
  updatingText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 6,
  },
  deleteButton: {
    padding: 4,
    marginLeft: 8,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
    marginTop: 4,
  },
  recordActions: {
    flexDirection: 'row',
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
  },
  recordAction: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 18,
  },
  recordActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
    marginLeft: 5,
  },
  correctionBox: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
  },
  correctionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
    marginTop: 8,
  },
  statusOptionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusOption: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusOptionActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  statusOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  statusOptionTextActive: {
    color: '#fff',
  },
  correctionActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  smallButton: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  smallButtonPrimary: {
    backgroundColor: COLORS.primary,
  },
  smallButtonPrimaryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  smallButtonGhost: {
    backgroundColor: COLORS.surface,
  },
  smallButtonGhostText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  summaryTile: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.primary,
  },
  summaryLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  reportInfo: {
    flex: 1,
  },
  countBadge: {
    backgroundColor: COLORS.success,
    borderRadius: 12,
    minWidth: 28,
    paddingHorizontal: 9,
    paddingVertical: 4,
    alignItems: 'center',
    marginLeft: 10,
  },
  countBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
