import { router } from 'expo-router';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

import AppButton from '@/components/AppButton';
import Header from '@/components/Header';
import { COLORS } from '@/constants/colors';
import { useRole } from '@/lib/role';
import { can } from '@/lib/permissions';

export default function Index() {
  const { role } = useRole();

  const canScan = can(role, 'scan_attendance');
  const canManageEvents =
    can(role, 'manage_own_events') || can(role, 'manage_all_events');
  const canBrowseEvents = role === null || can(role, 'browse_events');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerContainer}>
        <Header title="QR Attendance" />
      </View>

      <View style={styles.bodyContainer}>
        <Text style={styles.mainTitle}>School Event Attendance</Text>
        <Text style={styles.subtitle}>
          Scan QR Codes to record attendance during school activities.
        </Text>
      </View>

      <View style={styles.footerContainer}>
        {canScan && (
          <AppButton
            theme="primary"
            title="Scan QR Code"
            icon="qr-code-outline"
            onPress={() => router.push('/scan')}
          />
        )}
        {canManageEvents && (
          <AppButton
            theme="primary"
            title="Create Event"
            icon="add-circle-outline"
            onPress={() => router.push('/event-editor')}
          />
        )}
        {canBrowseEvents && (
          <AppButton
            title="Available Events"
            icon="calendar-outline"
            onPress={() => router.push('/events')}
          />
        )}
        <AppButton
          title="Attendance History"
          icon="time-outline"
          onPress={() => router.push('/history')}
        />
        <AppButton
          title="Profile"
          icon="person-outline"
          onPress={() => router.push('/profile')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center' },
  headerContainer: { alignItems: 'center', marginTop: 32, marginBottom: 24 },
  bodyContainer: { alignItems: 'center', paddingHorizontal: 32, marginBottom: 20 },
  mainTitle: { fontSize: 18, fontWeight: '600', color: COLORS.primary, marginBottom: 6, textAlign: 'center' },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' },
  footerContainer: { flex: 1, alignItems: 'center', paddingHorizontal: 24, width: '100%' },
});
