import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import AppButton from '@/components/AppButton';
import RoleGate from '@/components/RoleGate';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import {
  createEvent,
  getEventByCode,
  getEventById,
  updateEvent,
  normalizeStatus,
  type EventStatus,
} from '@/lib/events';

function toStorageISO(date: Date) {
  return date.toISOString();
}

function formatDateTime(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const month = date.toLocaleString('en-US', { month: 'short' });
  return `${month} ${pad(date.getDate())}, ${date.getFullYear()} at ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function parseLocal(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

type EditTarget = 'start' | 'end';

export default function EventEditorScreen() {
  return (
    <RoleGate
      allow={['teacher', 'admin']}
      title="Teachers & Administrators Only"
      message="Only teacher or administrator accounts can create and edit events."
    >
      <EventEditorContent />
    </RoleGate>
  );
}

function EventEditorContent() {
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = Boolean(id);

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [eventCode, setEventCode] = useState('');
  const [venue, setVenue] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<EventStatus>('open');
  const [startDate, setStartDate] = useState(() => new Date());
  const [endDate, setEndDate] = useState(() => new Date(Date.now() + 60 * 60 * 1000));
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const isAndroid = Platform.OS === 'android';

  useEffect(() => {
    let active = true;
    if (!id) return;
    setLoading(true);
    getEventById(id)
      .then((event) => {
        if (!active || !event) return;
        setTitle(event.title);
        setEventCode(event.event_code);
        setVenue(event.venue ?? '');
        setDescription(event.description ?? '');
        setStatus(normalizeStatus(event.status));
        setStartDate(parseLocal(event.start_time) ?? new Date());
        setEndDate(parseLocal(event.end_time) ?? new Date(Date.now() + 60 * 60 * 1000));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const applyDateValue = (target: EditTarget, next: Date) => {
    if (target === 'start') setStartDate(next);
    else setEndDate(next);
  };

  // Android shows the date and the time as two separate dialogs. Use the
  // imperative API so the time dialog reliably opens right after a date is
  // chosen — flipping `mode` on the mounted declarative component is
  // unreliable on Android and could leave the time stuck at its old value.
  const openAndroidPicker = (target: EditTarget) => {
    const current = target === 'start' ? startDate : endDate;

    DateTimePickerAndroid.open({
      value: current,
      mode: 'date',
      onChange: (event, pickedDate) => {
        if (event.type !== 'set' || !pickedDate) return;

        const withDate = new Date(current);
        withDate.setFullYear(
          pickedDate.getFullYear(),
          pickedDate.getMonth(),
          pickedDate.getDate()
        );

        DateTimePickerAndroid.open({
          value: withDate,
          mode: 'time',
          is24Hour: false,
          onChange: (timeEvent, pickedTime) => {
            const withTime = new Date(withDate);
            if (timeEvent.type === 'set' && pickedTime) {
              withTime.setHours(
                pickedTime.getHours(),
                pickedTime.getMinutes(),
                0,
                0
              );
            }
            applyDateValue(target, withTime);
          },
        });
      },
    });
  };

  const openPicker = (target: EditTarget) => {
    if (isAndroid) {
      openAndroidPicker(target);
      return;
    }
    // iOS uses a single inline date + time picker.
    setEditTarget(target);
  };

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (!editTarget) return;
    if (event.type === 'dismissed' || !selected) {
      setEditTarget(null);
      return;
    }

    const current = editTarget === 'start' ? startDate : endDate;
    const next = new Date(current);
    next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);

    applyDateValue(editTarget, next);
  };

  const handleQuickEnd = (ms: number) => {
    setEndDate(new Date(startDate.getTime() + ms));
  };

  const handleSave = async () => {
    setError(null);

    if (!title.trim() || !eventCode.trim()) {
      setError('Event name and event code are required.');
      return;
    }
    if (endDate.getTime() <= startDate.getTime()) {
      setError('End time must be after start time.');
      return;
    }
    if (!user) {
      setError('You must be logged in to save an event.');
      return;
    }

    setSaving(true);
    const payload = {
      eventId: eventCode.trim(),
      title: title.trim(),
      venue: venue.trim(),
      description: description.trim(),
      start: toStorageISO(startDate),
      end: toStorageISO(endDate),
      status,
    };

    const { error: saveError } = isEditing && id
      ? await updateEvent(id, {
          event_code: payload.eventId,
          title: payload.title,
          venue: payload.venue,
          description: payload.description,
          start_time: payload.start,
          end_time: payload.end,
          status: payload.status,
        })
      : await createEvent(payload, user.id);
    setSaving(false);

    if (saveError) {
      setError(`Failed to save event: ${saveError}`);
      return;
    }

    // After creating, jump straight to the event's details so the QR code is
    // ready to display for students.
    if (!isEditing) {
      const created = await getEventByCode(payload.eventId);
      if (created) {
        router.replace({ pathname: '/event-details', params: { id: created.id } });
        return;
      }
    }

    Alert.alert(
      isEditing ? 'Event updated' : 'Event created',
      `"${payload.title}" was saved.`,
      [{ text: 'OK', onPress: () => router.back() }]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{isEditing ? 'Edit Event' : 'Create Event'}</Text>
      <Text style={styles.subtitle}>
        Provide the event details. Status controls whether attendance can still
        be recorded.
      </Text>

      <Text style={styles.label}>Event Name</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Founders Day Assembly"
        placeholderTextColor={COLORS.textSecondary}
        editable={!saving}
      />

      <Text style={styles.label}>Event Code</Text>
      <TextInput
        style={styles.input}
        value={eventCode}
        onChangeText={setEventCode}
        placeholder="e.g. EVT-2026-0002"
        placeholderTextColor={COLORS.textSecondary}
        autoCapitalize="characters"
        editable={!saving && !isEditing}
      />
      {isEditing && (
        <Text style={styles.hint}>The event code cannot be changed later.</Text>
      )}

      <Text style={styles.label}>Venue</Text>
      <TextInput
        style={styles.input}
        value={venue}
        onChangeText={setVenue}
        placeholder="e.g. Main Auditorium"
        placeholderTextColor={COLORS.textSecondary}
        editable={!saving}
      />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={description}
        onChangeText={setDescription}
        placeholder="What is this event about?"
        placeholderTextColor={COLORS.textSecondary}
        multiline
        numberOfLines={4}
        editable={!saving}
      />

      <Text style={styles.label}>Date & Time</Text>
      <PickerField
        value={`Starts  ${formatDateTime(startDate)}`}
        icon="sunny-outline"
        onPress={() => openPicker('start')}
      />
      <View style={styles.pickerSpacer} />
      <PickerField
        value={`Ends    ${formatDateTime(endDate)}`}
        icon="moon-outline"
        onPress={() => openPicker('end')}
      />
      <View style={styles.chipRow}>
        {QUICK_END_OPTIONS.map((option) => (
          <Pressable
            key={option.label}
            style={styles.chip}
            onPress={() => handleQuickEnd(option.ms)}
          >
            <Text style={styles.chipText}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Status</Text>
      <View style={styles.statusRow}>
        {(['open', 'closed'] as EventStatus[]).map((value) => {
          const active = status === value;
          return (
            <Pressable
              key={value}
              style={[
                styles.statusChip,
                active && value === 'open' && styles.statusChipOpen,
                active && value === 'closed' && styles.statusChipClosed,
              ]}
              onPress={() => setStatus(value)}
            >
              <Ionicons
                name={value === 'open' ? 'lock-open-outline' : 'lock-closed-outline'}
                size={16}
                color={active ? '#fff' : COLORS.textSecondary}
              />
              <Text
                style={[styles.statusChipText, active && styles.statusChipTextActive]}
              >
                {value === 'open' ? 'Open' : 'Closed'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>
        Closed events no longer accept attendance from students.
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <AppButton
        theme="primary"
        title={saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Event'}
        icon={isEditing ? 'save-outline' : 'add-circle-outline'}
        onPress={handleSave}
        disabled={saving}
      />

      {!isAndroid && editTarget && (
        <View style={styles.pickerContainer}>
          <DateTimePicker
            value={editTarget === 'start' ? startDate : endDate}
            mode="datetime"
            display="spinner"
            onChange={onPickerChange}
          />
        </View>
      )}
    </ScrollView>
  );
}

const QUICK_END_OPTIONS = [
  { label: '+30 min', ms: 30 * 60 * 1000 },
  { label: '+1 hour', ms: 60 * 60 * 1000 },
  { label: '+2 hours', ms: 2 * 60 * 60 * 1000 },
];

function PickerField({
  value,
  icon,
  onPress,
}: {
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.pickerField, pressed && styles.pickerFieldPressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={COLORS.primary} />
      <Text style={styles.pickerValue}>{value}</Text>
      <Ionicons name="calendar-outline" size={18} color={COLORS.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
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
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  pickerField: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickerFieldPressed: { backgroundColor: COLORS.surface },
  pickerValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textPrimary,
    marginHorizontal: 10,
  },
  pickerSpacer: { height: 10 },
  chipRow: { flexDirection: 'row', marginTop: 8 },
  chip: {
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginRight: 8,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.primary },
  statusRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  statusChip: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
  },
  statusChipOpen: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  statusChipClosed: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
  statusChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginLeft: 6,
  },
  statusChipTextActive: { color: '#fff' },
  hint: { fontSize: 12, color: COLORS.textSecondary, marginTop: 6 },
  error: {
    fontSize: 14,
    color: COLORS.danger,
    marginTop: 12,
    marginBottom: 4,
  },
  pickerContainer: { marginTop: 12, alignItems: 'center' },
});
