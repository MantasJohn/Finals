import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import AppButton from '@/components/AppButton';
import { COLORS } from '@/constants/colors';
import { useAuth, signOut } from '@/lib/auth';
import { getProfile, updateProfile, type Profile, type Role } from '@/lib/profile';
import { ROLE_INFO } from '@/lib/permissions';
import {
  getAttendanceHistory,
  getTeacherEventAttendance,
} from '@/lib/attendance';
import { getAvailableEvents } from '@/lib/events';
import { getAttendanceReport } from '@/lib/admin';

export default function ProfileScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const loadProfile = useCallback(async () => {
    if (!user) return;
    const p = await getProfile(user.id);
    setProfile(p);
    setDraftName(p?.full_name ?? '');
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const handleSaveName = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await updateProfile(user.id, { full_name: draftName.trim() });
    setSaving(false);
    if (error) {
      Alert.alert('Error', error);
    } else {
      setProfile((prev) => (prev ? { ...prev, full_name: draftName.trim() } : prev));
      setEditing(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await signOut();
      router.replace('/login');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to sign out.');
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  const role: Role = profile?.role ?? 'student';
  const info = ROLE_INFO[role];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{info.title}</Text>
      <Text style={styles.subtitle}>{info.tagline}</Text>

      <View style={styles.infoCard}>
        <View style={[styles.roleBadge, { backgroundColor: info.accent }]}>
          <Text style={styles.roleBadgeText}>{role.toUpperCase()}</Text>
        </View>

        <Text style={styles.label}>Name</Text>
        {editing ? (
          <View style={styles.nameEditRow}>
            <TextInput
              style={styles.nameInput}
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Your name"
              placeholderTextColor={COLORS.textSecondary}
              editable={!saving}
              autoFocus
            />
            <Pressable onPress={handleSaveName} disabled={saving} style={styles.saveButton}>
              <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setEditing(true)} style={styles.nameRow}>
            <Text style={styles.value}>
              {profile?.full_name || 'Tap to add your name'}
            </Text>
            <Text style={styles.editHint}>Edit</Text>
          </Pressable>
        )}

        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{user.email}</Text>

        <Text style={styles.label}>Role</Text>
        <Text style={styles.value}>{role.charAt(0).toUpperCase() + role.slice(1)}</Text>

        <Text style={styles.label}>User ID</Text>
        <Text style={styles.valueSmall}>{user.id}</Text>
      </View>

      <Text style={styles.sectionTitle}>Activity</Text>
      {role === 'student' && <StudentSection userId={user.id} />}
      {role === 'teacher' && <TeacherSection userId={user.id} />}
      {role === 'admin' && <AdminSection />}

      <Text style={styles.sectionTitle}>Role & access</Text>
      <View style={styles.privilegeCard}>
        {info.privileges.map((privilege) => (
          <View key={privilege} style={styles.privilegeRow}>
            <Ionicons name="checkmark-circle" size={16} color={info.accent} />
            <Text style={styles.privilegeText}>{privilege}</Text>
          </View>
        ))}
      </View>

      <AppButton
        title="Sign Out"
        icon="log-out-outline"
        onPress={handleSignOut}
        disabled={loading}
      />
    </ScrollView>
  );
}

// ---------- Role-specific activity sections ----------

function StatGrid({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <View style={styles.statGrid}>
      {stats.map((stat) => (
        <View key={stat.label} style={styles.statTile}>
          <Text style={styles.statValue}>{stat.value}</Text>
          <Text style={styles.statLabel}>{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

function StudentSection({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [attended, setAttended] = useState(0);
  const [available, setAvailable] = useState(0);
  const [latest, setLatest] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      Promise.all([getAttendanceHistory(userId), getAvailableEvents()])
        .then(([records, events]) => {
          if (!active) return;
          setAttended(records.length);
          setAvailable(events.length);
          setLatest(records[0]?.eventTitle ?? null);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [userId])
  );

  if (loading) return <ActivityIndicator color={COLORS.primary} style={styles.sectionLoader} />;

  return (
    <>
      <StatGrid
        stats={[
          { label: 'Events attended', value: String(attended) },
          { label: 'Available events', value: String(available) },
        ]}
      />
      {latest && (
        <Text style={styles.sectionNote}>Most recent attendance: {latest}</Text>
      )}
    </>
  );
}

function TeacherSection({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState(0);
  const [scans, setScans] = useState(0);
  const [active, setActive] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active_ = true;
      setLoading(true);
      getTeacherEventAttendance(userId)
        .then((rows) => {
          if (!active_) return;
          const now = Date.now();
          setEvents(rows.length);
          setScans(rows.reduce((sum, e) => sum + e.attendeeCount, 0));
          setActive(
            rows.filter((e) => {
              if (!e.endTime) return true;
              const end = new Date(e.endTime).getTime();
              return Number.isNaN(end) || end >= now;
            }).length
          );
        })
        .finally(() => {
          if (active_) setLoading(false);
        });
      return () => {
        active_ = false;
      };
    }, [userId])
  );

  if (loading) return <ActivityIndicator color={COLORS.primary} style={styles.sectionLoader} />;

  return (
    <>
      <StatGrid
        stats={[
          { label: 'Events created', value: String(events) },
          { label: 'Total scans', value: String(scans) },
          { label: 'Active events', value: String(active) },
        ]}
      />
      <Text style={styles.sectionNote}>
        Open the Teacher tab to create events and view attendance.
      </Text>
    </>
  );
}

function AdminSection() {
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ users: 0, events: 0, scans: 0 });

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      getAttendanceReport()
        .then((report) => {
          if (!active) return;
          setTotals({
            users:
              report.totalStudents + report.totalTeachers + report.totalAdmins,
            events: report.totalEvents,
            scans: report.totalScans,
          });
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [])
  );

  if (loading) return <ActivityIndicator color={COLORS.primary} style={styles.sectionLoader} />;

  return (
    <>
      <StatGrid
        stats={[
          { label: 'Users', value: String(totals.users) },
          { label: 'Events', value: String(totals.events) },
          { label: 'Scans', value: String(totals.scans) },
        ]}
      />
      <Text style={styles.sectionNote}>
        Open the Admin tab to manage users, events and attendance records.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
  },
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
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 4,
    marginTop: 8,
  },
  value: {
    fontSize: 15,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  valueSmall: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 4,
  },
  roleBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editHint: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameInput: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 22,
    marginBottom: 10,
  },
  sectionLoader: {
    marginVertical: 16,
  },
  sectionNote: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 8,
    lineHeight: 18,
  },
  statGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statTile: {
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
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
  privilegeCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
  },
  privilegeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
  },
  privilegeText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textPrimary,
    marginLeft: 8,
    lineHeight: 18,
  },
});
