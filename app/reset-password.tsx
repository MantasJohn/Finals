import { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from '@/components/AppButton';
import Header from '@/components/Header';
import PasswordInput from '@/components/PasswordInput';
import { COLORS } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { getPasswordChecklist, isStrongPassword } from '@/lib/validation';

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const checklist = getPasswordChecklist(password);

  const handleUpdate = async () => {
    setError(null);

    if (!isStrongPassword(password)) {
      setError(
        'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.'
      );
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    router.replace('/(tabs)');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerContainer}>
            <Header title="New Password" />
          </View>

          <Text style={styles.title}>Choose a new password</Text>
          <Text style={styles.subtitle}>
            Set a strong password to keep your account secure.
          </Text>

          <Text style={styles.label}>New Password</Text>
          <PasswordInput
            value={password}
            onChangeText={setPassword}
            placeholder="Create a strong password"
            editable={!loading}
          />

          {password.length > 0 && (
            <View style={styles.requirements}>
              {checklist.map((rule) => (
                <View key={rule.key} style={styles.requirementRow}>
                  <Ionicons
                    name={rule.passed ? 'checkmark-circle' : 'ellipse-outline'}
                    size={15}
                    color={rule.passed ? COLORS.success : COLORS.textSecondary}
                  />
                  <Text
                    style={[
                      styles.requirementText,
                      rule.passed && styles.requirementTextPassed,
                    ]}
                  >
                    {rule.label}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.label}>Confirm Password</Text>
          <PasswordInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Re-enter your password"
            editable={!loading}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          {loading ? (
            <ActivityIndicator
              size="large"
              color={COLORS.primary}
              style={styles.loader}
            />
          ) : (
            <AppButton
              theme="primary"
              title="Update Password"
              icon="lock-closed-outline"
              onPress={handleUpdate}
            />
          )}

          <Link href="/login" style={styles.link}>
            Back to Sign In
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 },
  headerContainer: { alignItems: 'center', marginTop: 20, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 4 },
  subtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 21,
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
    marginTop: 10,
  },
  requirements: {
    marginTop: 8,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  requirementRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  requirementText: { fontSize: 13, color: COLORS.textSecondary, marginLeft: 8 },
  requirementTextPassed: { color: COLORS.success, fontWeight: '600' },
  error: { fontSize: 14, color: COLORS.danger, marginTop: 12, marginBottom: 4 },
  loader: { marginVertical: 16 },
  link: {
    fontSize: 14,
    color: COLORS.primary,
    textAlign: 'center',
    fontWeight: '600',
    marginTop: 16,
  },
});
