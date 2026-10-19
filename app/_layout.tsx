import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { COLORS } from '@/constants/colors';
import { initializeAuth, useAuth } from '@/lib/auth';

export default function RootLayout() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Restore the persisted session once, on first mount.
  useEffect(() => {
    initializeAuth();
  }, []);

  // Keep navigation in sync with the auth state. The redirect has to happen in
  // an effect (router.replace) — rendering <Redirect> as a child of <Stack>
  // does not work, because a navigator only renders its <Stack.Screen>
  // children.
  useEffect(() => {
    if (loading) return;
    const path = segments?.[0];
    const inAuthGroup = path === 'login' || path === 'register';
    const inTabsGroup = path === '(tabs)';

    if (!session && inTabsGroup) {
      router.replace('/login');
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [session, loading, segments, router]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="auth/callback" />
      <Stack.Screen name="event-editor" />
      <Stack.Screen name="event-details" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
});
