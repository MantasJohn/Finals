import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import AppButton from '@/components/AppButton';
import RoleGate from '@/components/RoleGate';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import {
  ATTENDANCE_STATUS_LABELS,
  registerAttendance,
  type RegisterResult,
} from '@/lib/attendance';

export default function ScanScreen() {
  return (
    <RoleGate
      allow={['student']}
      title="Students Only"
      message="Only student accounts can scan event QR codes to record attendance."
    >
      <ScanContent />
    </RoleGate>
  );
}

function ScanContent() {
  const [permission, requestPermission] = useCameraPermissions();
  const { user } = useAuth();

  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!permission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.subtitle}>Loading camera...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Ionicons name="camera-outline" size={48} color={COLORS.textSecondary} />
        <Text style={styles.title}>Camera Permission Needed</Text>
        <Text style={styles.subtitle}>
          We need access to your camera to scan QR codes.
        </Text>
        <AppButton
          theme="primary"
          title="Grant Permission"
          icon="camera"
          onPress={requestPermission}
        />
      </View>
    );
  }

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (scanned) return;

    setScanned(true);
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const studentId = user?.id;
      if (!studentId) {
        setError('You must be signed in to record attendance.');
        return;
      }
      // registerAttendance parses the QR, validates the event
      // (exists / not started / not ended / not closed) and inserts the row.
      const res = await registerAttendance(data, studentId);
      setResult(res);
    } catch (err) {
      console.error('Attendance error:', err);
      setError('Failed to record attendance. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleScanAgain = () => {
    setScanned(false);
    setBusy(false);
    setResult(null);
    setError(null);
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
      />

      <ScrollView
        style={styles.overlay}
        contentContainerStyle={styles.overlayContent}
        showsVerticalScrollIndicator={false}
      >
        {!scanned && (
          <>
            <Ionicons name="qr-code-outline" size={28} color={COLORS.primary} />
            <Text style={styles.overlayText}>
              Point your camera at the event QR code
            </Text>
          </>
        )}

        {scanned && busy && (
          <>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.overlayText}>Validating event...</Text>
          </>
        )}

        {scanned && !busy && error && (
          <>
            <Ionicons name="alert-circle-outline" size={40} color={COLORS.danger} />
            <Text style={styles.resultTitleError}>Something went wrong</Text>
            <Text style={styles.resultText}>{error}</Text>
          </>
        )}

        {scanned && !busy && result && (
          <Confirmation result={result} />
        )}

        {scanned && !busy && (
          <View style={styles.actions}>
            <AppButton
              theme="primary"
              title="Scan Again"
              icon="refresh"
              onPress={handleScanAgain}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Confirmation({ result }: { result: RegisterResult }) {
  if (result.success) {
    return (
      <>
        <Ionicons name="checkmark-circle" size={52} color={COLORS.success} />
        <Text style={styles.resultTitleSuccess}>Attendance recorded</Text>
        <Text style={styles.resultText}>{result.message}</Text>
        <View style={styles.confirmCard}>
          <ConfirmRow label="Event" value={result.eventTitle ?? '—'} />
          <ConfirmRow label="Code" value={result.eventCode ?? '—'} />
          {result.venue ? <ConfirmRow label="Venue" value={result.venue} /> : null}
          <ConfirmRow
            label="Time"
            value={`${timePart(result.startTime)} – ${timePart(result.endTime)}`}
          />
          {result.scannedAt ? (
            <ConfirmRow label="Checked in" value={formatFull(result.scannedAt)} />
          ) : null}
          <ConfirmRow
            label="Status"
            value={
              result.attendanceStatus
                ? ATTENDANCE_STATUS_LABELS[result.attendanceStatus]
                : 'Confirmed'
            }
          />
        </View>
      </>
    );
  }

  if (result.alreadyRegistered) {
    return (
      <>
        <Ionicons name="information-circle" size={52} color={COLORS.warning} />
        <Text style={styles.resultTitleWarn}>Already registered</Text>
        <Text style={styles.resultText}>
          {result.eventTitle
            ? `You have already checked in to "${result.eventTitle}".`
            : 'You have already checked in to this event.'}
        </Text>
      </>
    );
  }

  return (
    <>
      <Ionicons name="close-circle" size={52} color={COLORS.danger} />
      <Text style={styles.resultTitleError}>Attendance not recorded</Text>
      <Text style={styles.resultText}>{result.message}</Text>
      {result.eventTitle ? (
        <Text style={styles.resultMeta}>Event: {result.eventTitle}</Text>
      ) : null}
    </>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.confirmRow}>
      <Text style={styles.confirmLabel}>{label}</Text>
      <Text style={styles.confirmValue}>{value}</Text>
    </View>
  );
}

function timePart(value: string | null | undefined) {
  if (!value) return 'TBA';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatFull(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  camera: { flex: 1, width: '100%' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginTop: 12,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  overlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 40,
    maxHeight: '72%',
    backgroundColor: COLORS.card,
    borderRadius: 16,
  },
  overlayContent: {
    alignItems: 'center',
    padding: 18,
  },
  overlayText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginTop: 8,
    textAlign: 'center',
  },
  resultTitleSuccess: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.success,
    marginTop: 10,
  },
  resultTitleWarn: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.warning,
    marginTop: 10,
  },
  resultTitleError: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.danger,
    marginTop: 10,
  },
  resultText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 6,
  },
  resultMeta: {
    fontSize: 13,
    color: COLORS.textPrimary,
    marginTop: 8,
    fontWeight: '500',
  },
  confirmCard: {
    width: '100%',
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 5,
  },
  confirmLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    width: 86,
  },
  confirmValue: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textPrimary,
    textAlign: 'right',
  },
  actions: {
    width: '100%',
    marginTop: 16,
  },
});
