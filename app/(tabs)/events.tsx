import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import AppButton from '@/components/AppButton';
import { COLORS } from '@/constants/colors';
import { getAvailableEvents, type CloudEvent } from '@/lib/events';

export default function EventsScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<CloudEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const rows = await getAvailableEvents();
    setEvents(rows);
  }, []);

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

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading events...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Available Events</Text>
      <Text style={styles.subtitle}>
        Browse upcoming activities, then open the Scan tab to record your
        attendance.
      </Text>

      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons
              name="calendar-outline"
              size={40}
              color={COLORS.textSecondary}
            />
            <Text style={styles.emptyTitle}>No available events</Text>
            <Text style={styles.emptyText}>
              Check back later. Your teacher will publish events here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() =>
              router.push({ pathname: '/event-details', params: { id: item.id } })
            }
          >
            <View style={styles.cardHeaderRow}>
              <Text style={styles.eventTitle}>{item.title}</Text>
              {isLive(item) && (
                <View style={styles.liveBadge}>
                  <Text style={styles.liveBadgeText}>OPEN</Text>
                </View>
              )}
            </View>

            <Text style={styles.eventCode}>{item.event_code}</Text>

            {item.venue ? (
              <View style={styles.metaRow}>
                <Ionicons
                  name="location-outline"
                  size={16}
                  color={COLORS.textSecondary}
                />
                <Text style={styles.eventMeta}>{item.venue}</Text>
              </View>
            ) : null}
            <View style={styles.metaRow}>
              <Ionicons
                name="play-circle-outline"
                size={16}
                color={COLORS.textSecondary}
              />
              <Text style={styles.eventMeta}>
                Starts: {item.start_time ? formatDate(item.start_time) : 'TBA'}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Ionicons
                name="stop-circle-outline"
                size={16}
                color={COLORS.textSecondary}
              />
              <Text style={styles.eventMeta}>
                Ends: {item.end_time ? formatDate(item.end_time) : 'TBA'}
              </Text>
            </View>

            <View style={styles.detailsHint}>
              <Text style={styles.detailsHintText}>View details</Text>
              <Ionicons name="chevron-forward" size={14} color={COLORS.primary} />
            </View>
          </Pressable>
        )}
      />

      <View style={styles.footer}>
        <AppButton
          theme="primary"
          title="Scan Event QR"
          icon="qr-code-outline"
          onPress={() => router.push('/scan')}
        />
      </View>
    </View>
  );
}

function isLive(event: CloudEvent) {
  const now = Date.now();
  const start = event.start_time ? new Date(event.start_time).getTime() : null;
  const end = event.end_time ? new Date(event.end_time).getTime() : null;
  const started = start === null || Number.isNaN(start) || now >= start;
  const notEnded = end === null || Number.isNaN(end) || now <= end;
  return started && notEnded;
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textSecondary,
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
  list: {
    paddingBottom: 12,
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
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  eventCode: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: 8,
  },
  eventMeta: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginLeft: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  liveBadge: {
    backgroundColor: COLORS.success,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginLeft: 8,
  },
  liveBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  detailsHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
  },
  detailsHintText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
    marginRight: 2,
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 24,
    marginTop: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginTop: 10,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 4,
  },
  footer: {
    paddingTop: 4,
    paddingBottom: 8,
  },
});
