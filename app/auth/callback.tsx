import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';

import { COLORS } from '@/constants/colors';
import { supabase } from '@/lib/supabase';

function readParams(url: string) {
  const [beforeHash, afterHash = ''] = url.split('#');
  const query = beforeHash.split('?')[1] ?? '';
  const queryParams = new URLSearchParams(query);
  const hashParams = new URLSearchParams(afterHash);

  // Values after the "#" (Supabase's implicit flow) take priority over "?".
  return (key: string) => hashParams.get(key) ?? queryParams.get(key);
}

/**
 * Landing route for links Supabase emails out (account confirmation and
 * password recovery). It turns the tokens in the link into a real session, then
 * sends the user into the app.
 */
export default function AuthCallbackScreen() {
  const url = Linking.useURL();
  const [status, setStatus] = useState<'working' | 'error'>('working');
  const [message, setMessage] = useState('Verifying your link...');

  useEffect(() => {
    let active = true;

    async function run(target: string | null) {
      if (!target) return;

      const get = readParams(target);

      const errorDescription = get('error_description');
      if (errorDescription) {
        if (!active) return;
        setStatus('error');
        setMessage(errorDescription.replace(/\+/g, ' '));
        return;
      }

      try {
        const code = get('code');
        const accessToken = get('access_token');
        const refreshToken = get('refresh_token');

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        }

        if (!active) return;
        if (get('type') === 'recovery') {
          router.replace('/reset-password');
        } else {
          router.replace('/(tabs)');
        }
      } catch (err: any) {
        if (!active) return;
        setStatus('error');
        setMessage(err?.message ?? 'This link is invalid or has expired.');
      }
    }

    run(url);
    return () => {
      active = false;
    };
  }, [url]);

  if (status === 'working') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.text}>{message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Link problem</Text>
      <Text style={styles.text}>{message}</Text>
      <Pressable style={styles.button} onPress={() => router.replace('/login')}>
        <Text style={styles.buttonText}>Go to Sign In</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  text: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
