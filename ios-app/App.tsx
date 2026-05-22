import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

type Session = { serverUrl: string; token: string; userId: number; circleId: number; displayName: string; email: string; readReceiptsEnabled?: boolean };
type Member = { userId: number; displayName: string; email?: string; role?: string; lat?: number; lng?: number; accuracyM?: number; speedMps?: number; batteryPct?: number; bearing?: number; altitudeM?: number; activity?: string; activityConfidence?: number; recordedAt?: number; photoUrl?: string; address?: string; paused?: boolean; pausedUntil?: number | null; pauseReason?: string | null };
type Place = { id: number; circleId: number; name: string; address?: string | null; lat: number; lng: number; radiusM: number; alertsOnEnter: boolean; alertsOnExit: boolean };
type Message = { id: number; circleId?: number; userId: number; displayName?: string; body?: string; createdAt: number; reactions?: { emoji: string; userIds: number[] }[]; attachmentKind?: string; attachmentUrl?: string; attachmentMime?: string; attachmentBytes?: number; attachmentDurationMs?: number; readers?: { userId: number; readAt: number }[] };
type AlertEvent = { id: number; userId: number; displayName?: string; circleId: number; type: string; value?: number; createdAt: number };
type PlaceSubscription = { id: number; userId: number; placeId: number; memberId: number | null; placeName?: string; memberName?: string; onEnter: boolean; onExit: boolean; quietStart?: number | null; quietEnd?: number | null };
type LocationPoint = { id: number; lat: number; lng: number; recordedAt: number; activity?: string; speedMps?: number };
type Tab = 'map' | 'members' | 'chat' | 'places' | 'alerts' | 'more';

const LOCATION_TASK = 'family-guardian-background-location';
const TOKEN_KEY = 'fg_session_token';
const SESSION_KEY = 'fg_session_meta';

async function api<T>(session: Session, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${session.serverUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${session.token}`,
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let err = `${res.status}`;
    try { err = (await res.json()).error || err; } catch {}
    throw new Error(err);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function postLocationWithStoredSession(coords: Location.LocationObjectCoords, recordedAt: number) {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!raw || !token) return;
  const meta = JSON.parse(raw) as Omit<Session, 'token'>;
  const session: Session = { ...meta, token };
  await api(session, '/api/locations', {
    method: 'POST',
    body: JSON.stringify({
      lat: coords.latitude, lng: coords.longitude,
      accuracyM: coords.accuracy ?? null, speedMps: coords.speed ?? null,
      bearing: coords.heading ?? null, altitudeM: coords.altitude ?? null,
      recordedAt, activity: inferActivity(coords.speed ?? null), activityConfidence: coords.speed == null ? null : 50,
    }),
  });
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] })?.locations || [];
  for (const loc of locations) {
    try { await postLocationWithStoredSession(loc.coords, loc.timestamp); } catch {}
  }
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
});

function inferActivity(speed?: number | null) {
  if (speed == null) return undefined;
  if (speed < 0.7) return 'still';
  if (speed < 2.5) return 'walking';
  if (speed < 7) return 'running';
  return 'driving';
}
function formatPauseUntil(ms?: number | null) {
  if (!ms) return '';
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString()} ${time}`;
}
function minutesUntilTonight() {
  const now = new Date(); const t = new Date(now); t.setHours(20, 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return Math.max(1, Math.min(1440, Math.round((t.getTime() - now.getTime()) / 60000)));
}
function rel(ms?: number) {
  if (!ms) return 'no fix';
  const d = Date.now() - ms;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}
function normalizeServer(url: string) {
  const trimmed = url.trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
  return trimmed;
}
function wsUrl(serverUrl: string) {
  return `${serverUrl.replace(/\/$/, '').replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')}/ws`;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(SESSION_KEY);
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (raw && token) setSession({ ...(JSON.parse(raw) as Omit<Session, 'token'>), token });
      setLoadingSession(false);
    })();
  }, []);

  if (loadingSession) return <SafeAreaProvider><SafeAreaView style={styles.center}><Text>Loading Family Guardian...</Text></SafeAreaView></SafeAreaProvider>;
  return <SafeAreaProvider><StatusBar style="dark" />{session ? <Guardian session={session} onLogout={() => setSession(null)} /> : <Auth onSession={setSession} />}</SafeAreaProvider>;
}

function Auth({ onSession }: { onSession: (s: Session) => void }) {
  const [serverUrl, setServerUrl] = useState('http://10.0.2.2:8080');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);

  async function finish(payload: any, normalized: string) {
    const s: Session = { serverUrl: normalized, token: payload.token, userId: payload.userId, circleId: payload.circleId, displayName: payload.displayName, email };
    await SecureStore.setItemAsync(TOKEN_KEY, s.token);
    const { token, ...meta } = s;
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(meta));
    onSession(s);
  }
  async function submit() {
    setBusy(true);
    try {
      const normalized = normalizeServer(serverUrl);
      const path = joining ? '/api/auth/signup' : '/api/auth/login';
      const body = joining ? { email, password, displayName, inviteCode } : { email, password };
      const res = await fetch(`${normalized}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`);
      await finish(await res.json(), normalized);
    } catch (err: any) { Alert.alert('Sign in failed', err.message); } finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.auth}><Text style={styles.brand}>Family Guardian</Text><Text style={styles.subtitle}>Native iOS client for your self-hosted server.</Text>
    <TextInput style={styles.input} value={serverUrl} onChangeText={setServerUrl} placeholder="Server URL" autoCapitalize="none" />
    <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" keyboardType="email-address" />
    <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
    {joining && <><TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Display name" /><TextInput style={styles.input} value={inviteCode} onChangeText={setInviteCode} placeholder="Invite code" autoCapitalize="characters" /></>}
    <Pressable style={styles.primaryButton} onPress={submit} disabled={busy}><Text style={styles.buttonText}>{busy ? 'Working...' : joining ? 'Join circle' : 'Sign in'}</Text></Pressable>
    <Pressable style={styles.secondaryButton} onPress={() => setJoining(!joining)}><Text style={styles.secondaryText}>{joining ? 'I already have an account' : 'Join with invite code'}</Text></Pressable>
  </SafeAreaView>;
}

function Guardian({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('map');
  const [members, setMembers] = useState<Member[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [history, setHistory] = useState<LocationPoint[]>([]);
  const [sharing, setSharing] = useState(false);
  const [wsState, setWsState] = useState('offline');
  const [typingUsers, setTypingUsers] = useState<Map<number, { displayName: string; expiresAt: number }>>(new Map());
  const mapRef = useRef<MapView | null>(null);
  const readQueueRef = useRef<number[]>([]);
  const readTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const [m, p] = await Promise.all([
      api<{ members: Member[] }>(session, `/api/circles/${session.circleId}/members`),
      api<{ places: Place[] }>(session, `/api/circles/${session.circleId}/places`),
    ]);
    setMembers(m.members); setPlaces(p.places);
  }, [session]);

  useEffect(() => { load().catch((e) => Alert.alert('Load failed', e.message)); }, [load]);
  useEffect(() => {
    const ws = new WebSocket(`${wsUrl(session.serverUrl)}?token=${encodeURIComponent(session.token)}`);
    ws.onopen = () => setWsState('live');
    ws.onclose = () => setWsState('offline');
    ws.onerror = () => setWsState('offline');
    ws.onmessage = async (event: { data: string }) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'location_update') setMembers((cur) => upsertMember(cur, msg));
      if (msg.type === 'chat_message') {
        setMessages((cur) => [...cur, { ...msg, reactions: msg.reactions || [], readers: msg.readers || [] }]);
      }
      if (msg.type === 'chat_typing') {
        setTypingUsers((cur) => { const next = new Map(cur); next.set(msg.userId, { displayName: msg.displayName, expiresAt: msg.expiresAt }); return next; });
      }
      if (msg.type === 'message_read' && msg.userId && msg.messageId) {
        setMessages((cur: Message[]) => cur.map((m: Message) => {
          if (m.id !== msg.messageId || m.userId !== session.userId) return m;
          const readers = [...(m.readers || [])];
          if (!readers.find((r) => r.userId === msg.userId)) readers.push({ userId: msg.userId, readAt: msg.readAt });
          return { ...m, readers };
        }));
      }
      if (msg.type === 'reaction_added' || msg.type === 'reaction_removed') {
        setMessages((cur: Message[]) => cur.map((m: Message) => {
          if (m.id !== msg.messageId) return m;
          const rxs = [...(m.reactions || [])];
          if (msg.type === 'reaction_added') {
            const existing = rxs.find((r: any) => r.emoji === msg.emoji);
            if (existing) { if (!existing.userIds.includes(msg.userId)) existing.userIds = [...existing.userIds, msg.userId]; }
            else rxs.push({ emoji: msg.emoji, userIds: [msg.userId] });
          } else {
            const existing = rxs.find((r: any) => r.emoji === msg.emoji);
            if (existing) { existing.userIds = existing.userIds.filter((id: number) => id !== msg.userId); if (existing.userIds.length === 0) rxs.splice(rxs.indexOf(existing), 1); }
          }
          return { ...m, reactions: rxs };
        }));
      }
      if (msg.type === 'sos_active') await notify('SOS active', `${msg.displayName || 'A member'} triggered SOS`);
      if (msg.type === 'pause_changed') {
        setMembers((cur) => cur.map((m) => m.userId === msg.userId
          ? { ...m, paused: !!msg.pausedUntil, pausedUntil: msg.pausedUntil, pauseReason: msg.reason }
          : m));
      }
      if (msg.type?.includes('alert') || msg.type?.startsWith('geofence')) {
        if (msg.type?.startsWith('geofence') && msg.notifyUserIds && Array.isArray(msg.notifyUserIds) && !msg.notifyUserIds.includes(session.userId)) return;
        await notify('Family Guardian', `${msg.displayName || 'Member'}: ${msg.type.replaceAll('_', ' ')}`);
      }
    };
    return () => ws.close();
  }, [session]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTypingUsers((cur) => {
        let changed = false;
        const next = new Map(cur);
        for (const [k, v] of next) { if (v.expiresAt < now) { next.delete(k); changed = true; } }
        return changed ? next : cur;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  async function startSharing() {
    if (sharing) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
      setSharing(false); return;
    }
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return Alert.alert('Location denied', 'Allow location access to share GPS.');
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) Alert.alert('Background limited', 'Foreground location will work. Choose Always later for background updates.');
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    await postLocationWithStoredSession(loc.coords, loc.timestamp);
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
    if (!started) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, { accuracy: Location.Accuracy.Balanced, timeInterval: 30000, distanceInterval: 50, pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true, foregroundService: { notificationTitle: 'Family Guardian', notificationBody: 'Sharing location with your family circle.' } } as any);
    }
    setSharing(true); load().catch(() => {});
  }

  async function sendSos() {
    Alert.alert('Activate SOS?', 'This alerts your circle.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Activate', style: 'destructive', onPress: async () => { try { await api(session, '/api/sos/activate', { method: 'POST', body: '{}' }); } catch (e: any) { Alert.alert('SOS failed', e.message); } } }]);
  }
  async function checkIn(status: string) {
    try { await api(session, '/api/checkins', { method: 'POST', body: JSON.stringify({ status }) }); Alert.alert('Check-in sent'); } catch (e: any) { Alert.alert('Check-in failed', e.message); }
  }
  async function loadMessages() {
    const data = await api<{ messages: Message[] }>(session, `/api/circles/${session.circleId}/messages?limit=100${session.readReceiptsEnabled ? '&withReaders=1' : ''}`);
    setMessages(data.messages);
  }
  async function loadAlerts() { setAlerts((await api<{ alerts: AlertEvent[] }>(session, `/api/circles/${session.circleId}/alerts?limit=100`)).alerts); }
  async function logout() { await SecureStore.deleteItemAsync(TOKEN_KEY); await AsyncStorage.removeItem(SESSION_KEY); await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {}); onLogout(); }

  return <SafeAreaView style={styles.app}><View style={styles.header}><View><Text style={styles.eyebrow}>{session.displayName}</Text><Text style={styles.title}>Family Guardian</Text></View><Text style={styles.badge}>{wsState}</Text></View>
    {tab === 'map' && <MapTab members={members} places={places} mapRef={mapRef} onMember={setSelectedMember} onShare={startSharing} sharing={sharing} onSos={sendSos} onCheckIn={checkIn} />}
    {tab === 'members' && <MembersTab session={session} members={members} selected={selectedMember} setSelected={setSelectedMember} history={history} setHistory={setHistory} />}
    {tab === 'chat' && <ChatTab session={session} messages={messages} setMessages={setMessages} loadMessages={loadMessages} typingUsers={typingUsers} readQueueRef={readQueueRef} readTimerRef={readTimerRef} />}
    {tab === 'places' && <PlacesTab session={session} places={places} setPlaces={setPlaces} />}
    {tab === 'alerts' && <AlertsTab alerts={alerts} loadAlerts={loadAlerts} />}
    {tab === 'more' && <MoreTab session={session} onLogout={logout} onRefresh={load} />}
    <View style={styles.tabs}>{(['map','members','chat','places','alerts','more'] as Tab[]).map((t) => <Pressable key={t} onPress={() => { setTab(t); if (t === 'chat') loadMessages().catch(() => {}); if (t === 'alerts') loadAlerts().catch(() => {}); }} style={[styles.tab, tab === t && styles.activeTab]}><Text style={[styles.tabText, tab === t && styles.activeTabText]}>{t}</Text></Pressable>)}</View>
  </SafeAreaView>;
}

function upsertMember(cur: Member[], msg: any) { const idx = cur.findIndex((m) => m.userId === msg.userId); const next = { ...(idx >= 0 ? cur[idx] : { userId: msg.userId }), ...msg }; return idx >= 0 ? cur.map((m, i) => i === idx ? next : m) : [...cur, next]; }
async function notify(title: string, body: string) { await Notifications.requestPermissionsAsync(); await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null }); }

function MapTab({ members, places, mapRef, onMember, onShare, sharing, onSos, onCheckIn }: any) {
  const first = members.find((m: Member) => m.lat && m.lng);
  return <View style={styles.flex}><MapView ref={mapRef} style={styles.map} initialRegion={{ latitude: first?.lat || 37.7749, longitude: first?.lng || -122.4194, latitudeDelta: 0.08, longitudeDelta: 0.08 }}>{places.map((p: Place) => <Circle key={p.id} center={{ latitude: p.lat, longitude: p.lng }} radius={p.radiusM} strokeColor="#006c49" fillColor="rgba(0,108,73,.10)" />)}{members.filter((m: Member) => m.lat && m.lng).map((m: Member) => <Marker key={m.userId} coordinate={{ latitude: m.lat!, longitude: m.lng! }} title={m.displayName + (m.paused ? ' (paused)' : '')} description={m.paused ? `Paused${m.pausedUntil ? ' until ' + formatPauseUntil(m.pausedUntil) : ''}` : rel(m.recordedAt)} pinColor={m.paused ? 'gray' : 'red'} opacity={m.paused ? 0.7 : 1} onPress={() => onMember(m)} />)}</MapView><View style={styles.floating}><Text style={styles.cardTitle}>{members.length} members</Text><View style={styles.row}><Pressable style={styles.primaryButton} onPress={onShare}><Text style={styles.buttonText}>{sharing ? 'Stop GPS' : 'Share GPS'}</Text></Pressable><Pressable style={styles.dangerButton} onPress={onSos}><Text style={styles.buttonText}>SOS</Text></Pressable></View><View style={styles.row}><Pressable style={styles.secondaryButton} onPress={() => onCheckIn('safe_home')}><Text>Safe home</Text></Pressable><Pressable style={styles.secondaryButton} onPress={() => onCheckIn('heading_home')}><Text>Heading home</Text></Pressable></View></View></View>;
}
function MembersTab({ session, members, selected, setSelected, history, setHistory }: any) {
  async function open(m: Member) { setSelected(m); const to = Date.now(); const from = to - 86400000 * 7; const data = await api<{ points: LocationPoint[] }>(session, `/api/circles/${session.circleId}/members/${m.userId}/history?from=${from}&to=${to}&limit=500`); setHistory(data.points); }
  return <ScrollView style={styles.content}>{members.map((m: Member) => <Pressable key={m.userId} style={styles.card} onPress={() => open(m)}><Text style={styles.cardTitle}>{m.displayName}</Text>{m.paused ? <Text style={[styles.meta, { color: '#943700' }]}>⏸ Paused{m.pausedUntil ? ` until ${formatPauseUntil(m.pausedUntil)}` : ''}</Text> : <Text style={styles.meta}>{m.address || (m.lat ? `${m.lat.toFixed(4)}, ${m.lng?.toFixed(4)}` : 'No location yet')}</Text>}<Text style={styles.meta}>{rel(m.recordedAt)} {m.batteryPct != null ? `· ${m.batteryPct}%` : ''}</Text></Pressable>)}{selected && <View style={styles.card}><Text style={styles.cardTitle}>{selected.displayName} history</Text><Text style={styles.meta}>{history.length} points in the last 7 days</Text>{history.length > 1 && <MapView style={styles.smallMap} initialRegion={{ latitude: history[0].lat, longitude: history[0].lng, latitudeDelta: .08, longitudeDelta: .08 }}><Polyline coordinates={history.map((p: LocationPoint) => ({ latitude: p.lat, longitude: p.lng }))} strokeColor="#006c49" strokeWidth={4} /></MapView>}</View>}</ScrollView>;
}
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
function ChatTab({ session, messages, setMessages, loadMessages, typingUsers, readQueueRef, readTimerRef }: any) {
  const [body, setBody] = useState('');
  const typingSentRef = useRef(0);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => { loadMessages().catch(() => {}); }, []);

  useEffect(() => {
    if (!session.readReceiptsEnabled) return;
    readTimerRef.current = setInterval(() => {
      const ids = readQueueRef.current.splice(0, 50);
      if (ids.length === 0) return;
      api(session, '/api/messages/read-batch', { method: 'POST', body: JSON.stringify({ messageIds: ids }) }).catch(() => {});
    }, 2000);
    return () => { if (readTimerRef.current) clearInterval(readTimerRef.current); };
  }, [session.readReceiptsEnabled]);

  async function send() {
    if (!body.trim()) return;
    const msg = await api<Message>(session, `/api/circles/${session.circleId}/messages`, { method: 'POST', body: JSON.stringify({ body: body.trim() }) });
    setMessages((cur: Message[]) => [...cur, msg]);
    setBody('');
  }
  async function sendAttachment(file: any, kind: string) {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    const msg = await api<Message>(session, `/api/circles/${session.circleId}/messages/attachment`, { method: 'POST', body: form as any });
    setMessages((cur: Message[]) => [...cur, msg]);
  }
  async function sendTyping() {
    const now = Date.now();
    if (now - typingSentRef.current < 3000) return;
    typingSentRef.current = now;
    await api(session, `/api/circles/${session.circleId}/typing`, { method: 'POST' }).catch(() => {});
  }

  async function toggleReaction(msgId: number, emoji: string) {
    const msg = messages.find((m: Message) => m.id === msgId);
    const existing = msg?.reactions?.find((r: any) => r.emoji === emoji && r.userIds.includes(session.userId));
    if (existing) {
      await api(session, `/api/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' });
    } else {
      await api(session, `/api/messages/${msgId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) });
    }
  }
  function showReactionPicker(msgId: number) {
    Alert.alert('React', 'Choose a reaction', [
      ...REACTION_EMOJIS.map((e) => ({ text: e, onPress: () => toggleReaction(msgId, e) })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const typingNames = Array.from(typingUsers.values() as Iterable<{ displayName: string; expiresAt: number }>)
    .filter((v) => v.expiresAt > Date.now())
    .map((v) => v.displayName);
  const onViewableItemsChanged = useRef(({ changed }: any) => {
    if (!session.readReceiptsEnabled) return;
    for (const item of changed) {
      if (item.isViewable && item.item && item.item.userId !== session.userId) {
        if (!readQueueRef.current.includes(item.item.id)) {
          readQueueRef.current.push(item.item.id);
        }
      }
    }
  }).current;

  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <FlatList ref={flatListRef} style={styles.content} data={messages} keyExtractor={(m) => String(m.id)}
      onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
      onContentSizeChange={() => flatListRef.current?.scrollToEnd?.()}
      renderItem={({ item }: any) => <Pressable onLongPress={() => showReactionPicker(item.id)}>
        <View style={[styles.message, item.userId === session.userId && styles.mine]}>
          <Text style={styles.meta}>{item.displayName || 'Member'}</Text>
          {item.attachmentKind === 'image' && item.attachmentUrl && <Image source={{ uri: `${session.serverUrl.replace(/\/$/, '')}${item.attachmentUrl}`, headers: { Authorization: `Bearer ${session.token}` } }} style={{ width: 200, height: 150, borderRadius: 8, marginVertical: 4 }} resizeMode="cover" />}
          {item.attachmentKind === 'audio' && item.attachmentUrl && <Text style={{ color: '#006c49', marginVertical: 4 }}>🎙 Voice note</Text>}
          {item.body ? <Text>{item.body}</Text> : null}
          {item.reactions?.length > 0 && <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>{item.reactions.map((rx: any, i: number) => <Pressable key={i} style={[styles.chip, rx.userIds.includes(session.userId) && styles.chipActive]} onPress={() => toggleReaction(item.id, rx.emoji)}><Text style={{ fontSize: 12 }}>{rx.emoji} {rx.userIds.length}</Text></Pressable>)}</View>}
          {session.readReceiptsEnabled && item.userId === session.userId && item.readers && item.readers.length > 0 && <Text style={styles.meta}>Seen by {item.readers.length}</Text>}
        </View></Pressable>} />
    {typingNames.length > 0 && <Text style={styles.meta}>{typingNames.join(', ')} typing…</Text>}
    <View style={styles.composer}>
      <TextInput style={styles.inputFlex} value={body} onChangeText={(t) => { setBody(t); sendTyping(); }} placeholder="Message" />
      <Pressable style={styles.smallBtn} onPress={() => {
        Alert.alert('Attach', 'Choose attachment type', [
          { text: 'Photo', onPress: async () => {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') return;
            const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
            if (result.canceled || !result.assets?.[0]) return;
            const asset = result.assets[0];
            const resp = await fetch(asset.uri);
            const blob = await resp.blob();
            sendAttachment(new File([blob], 'photo.jpg', { type: 'image/jpeg' }), 'image');
          }},
          { text: 'Cancel', style: 'cancel' },
        ]);
      }}><Text>📷</Text></Pressable>
      <Pressable style={styles.primaryButton} onPress={send}><Text style={styles.buttonText}>Send</Text></Pressable>
    </View>
  </KeyboardAvoidingView>;
}
function PlacesTab({ session, places, setPlaces }: any) {
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('150');
  const [members, setMembers] = useState<Member[]>([]);
  const [subs, setSubs] = useState<PlaceSubscription[]>([]);
  const [expandedPlace, setExpandedPlace] = useState<number | null>(null);

  useEffect(() => {
    api<{ members: Member[] }>(session, `/api/circles/${session.circleId}/members`)
      .then((d) => setMembers(d.members)).catch(() => {});
    api<{ subscriptions: PlaceSubscription[] }>(session, `/api/circles/${session.circleId}/place-subscriptions`)
      .then((d) => setSubs(d.subscriptions || [])).catch(() => {});
  }, [session]);

  async function toggleSub(placeId: number, memberId: number | null, onEnter: boolean, onExit: boolean) {
    if (!onEnter && !onExit) {
      const existing = subs.find((s) => s.placeId === placeId && s.memberId === memberId);
      if (existing) {
        await api(session, `/api/place-subscriptions/${existing.id}`, { method: 'DELETE' });
        setSubs((cur) => cur.filter((s) => s.id !== existing.id));
      }
      return;
    }
    const result = await api<PlaceSubscription>(session, `/api/circles/${session.circleId}/place-subscriptions`, {
      method: 'POST', body: JSON.stringify({ placeId, memberId, onEnter, onExit }),
    });
    setSubs((cur) => {
      const filtered = cur.filter((s) => !(s.placeId === placeId && s.memberId === memberId));
      return [...filtered, result];
    });
  }

  async function save() { const p = await api<Place>(session, `/api/circles/${session.circleId}/places`, { method: 'POST', body: JSON.stringify({ name, lat: Number(lat), lng: Number(lng), radiusM: Number(radius), alertsOnEnter: true, alertsOnExit: true }) }); setPlaces((cur: Place[]) => [...cur, p]); setName(''); }
  return <ScrollView style={styles.content}><View style={styles.card}><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Place name" /><TextInput style={styles.input} value={lat} onChangeText={setLat} placeholder="Latitude" keyboardType="decimal-pad" /><TextInput style={styles.input} value={lng} onChangeText={setLng} placeholder="Longitude" keyboardType="decimal-pad" /><TextInput style={styles.input} value={radius} onChangeText={setRadius} placeholder="Radius meters" keyboardType="decimal-pad" /><Pressable style={styles.primaryButton} onPress={save}><Text style={styles.buttonText}>Save place</Text></Pressable></View>{places.map((p: Place) => {
    const placeSubs = subs.filter((s) => s.placeId === p.id);
    const isExpanded = expandedPlace === p.id;
    const allTargets: { id: number | null; name: string }[] = [{ id: null, name: 'Anyone' }, ...members.map((m) => ({ id: m.userId, name: m.displayName }))];
    return <View style={styles.card} key={p.id}>
      <Text style={styles.cardTitle}>{p.name}</Text>
      <Text style={styles.meta}>{p.address || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`} · {Math.round(p.radiusM)}m</Text>
      <Pressable style={[styles.secondaryButton, { marginTop: 4 }]} onPress={() => setExpandedPlace(isExpanded ? null : p.id)}><Text>{isExpanded ? 'Hide notifications' : '🔔 Notify me when…'}</Text></Pressable>
      {isExpanded && allTargets.map((t) => {
        const sub = placeSubs.find((s) => s.memberId === t.id);
        return <View key={t.id ?? 'any'} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
          <Text style={{ flex: 1, fontWeight: '600' }}>{t.name}</Text>
          <Pressable style={[styles.chip, sub?.onEnter && styles.chipActive]} onPress={() => toggleSub(p.id, t.id, !(sub?.onEnter ?? false), sub?.onExit ?? false)}><Text>{sub?.onEnter ? '✅' : '◻️'} Arrives</Text></Pressable>
          <Pressable style={[styles.chip, sub?.onExit && styles.chipActive]} onPress={() => toggleSub(p.id, t.id, sub?.onEnter ?? false, !(sub?.onExit ?? false))}><Text>{sub?.onExit ? '✅' : '◻️'} Leaves</Text></Pressable>
        </View>;
      })}
    </View>;
  })}</ScrollView>;
}
function AlertsTab({ alerts, loadAlerts }: any) { useEffect(() => { loadAlerts().catch(() => {}); }, []); return <ScrollView style={styles.content}>{alerts.map((a: AlertEvent) => <View style={styles.card} key={a.id}><Text style={styles.cardTitle}>{a.displayName || 'Member'}</Text><Text style={styles.meta}>{a.type} {a.value != null ? `· ${a.value}` : ''} · {rel(a.createdAt)}</Text></View>)}</ScrollView>; }
function MoreTab({ session, onLogout, onRefresh }: any) {
  const [pauseUntil, setPauseUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [views, setViews] = useState<any[]>([]);
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(session.readReceiptsEnabled || false);
  const RESOURCE_LABELS: Record<string, string> = { history: 'Location history', visits: 'Visits', trips: 'Trips', member_page: 'Profile page' };
  useEffect(() => {
    api<{ pausedUntil: number | null }>(session, '/api/users/me/pause')
      .then((d) => setPauseUntil(d.pausedUntil))
      .catch(() => {});
    api<{ views: any[] }>(session, '/api/users/me/view-log?days=7')
      .then((d) => setViews(d.views || []))
      .catch(() => {});
    api<any>(session, '/api/users/me')
      .then((d) => { if (d.readReceiptsEnabled != null) setReadReceiptsEnabled(d.readReceiptsEnabled); })
      .catch(() => {});
  }, [session]);
  const isPaused = !!(pauseUntil && pauseUntil > Date.now());
  async function setPause(minutes: number) {
    setBusy(true);
    try {
      const d = await api<{ pausedUntil: number | null }>(session, '/api/users/me/pause', { method: 'POST', body: JSON.stringify({ durationMinutes: minutes }) });
      setPauseUntil(d.pausedUntil);
      Alert.alert('Paused', `Sharing paused until ${formatPauseUntil(d.pausedUntil)}`);
    } catch (e: any) { Alert.alert('Pause failed', e.message); } finally { setBusy(false); }
  }
  async function clearPause() {
    setBusy(true);
    try {
      await api(session, '/api/users/me/pause', { method: 'DELETE' });
      setPauseUntil(null);
    } catch (e: any) { Alert.alert('Resume failed', e.message); } finally { setBusy(false); }
  }
  async function toggleReadReceipts() {
    const next = !readReceiptsEnabled;
    try {
      await api(session, '/api/users/me', { method: 'PATCH', body: JSON.stringify({ readReceiptsEnabled: next }) });
      setReadReceiptsEnabled(next);
      session.readReceiptsEnabled = next;
    } catch (e: any) { Alert.alert('Failed', e.message); }
  }
  return <ScrollView style={styles.content}>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Pause sharing</Text>
      <Text style={[styles.meta, isPaused && { color: '#943700' }]}>{isPaused ? `Paused until ${formatPauseUntil(pauseUntil)}` : 'Sharing is on.'}</Text>
      {isPaused
        ? <Pressable style={styles.dangerButton} disabled={busy} onPress={clearPause}><Text style={styles.buttonText}>Resume now</Text></Pressable>
        : <View style={{ gap: 8 }}>
            <View style={styles.row}>
              <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => setPause(15)}><Text>15 min</Text></Pressable>
              <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => setPause(60)}><Text>1 hour</Text></Pressable>
            </View>
            <View style={styles.row}>
              <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => setPause(240)}><Text>4 hours</Text></Pressable>
              <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => setPause(minutesUntilTonight())}><Text>Until 8 PM</Text></Pressable>
            </View>
          </View>}
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Read receipts</Text>
      <Text style={styles.meta}>When ON, people who also enable receipts will see when you've read their messages.</Text>
      <Pressable style={styles.secondaryButton} onPress={toggleReadReceipts}><Text>{readReceiptsEnabled ? '✅ Enabled' : '◻️ Disabled'}</Text></Pressable>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Who viewed your history</Text>
      {views.length === 0
        ? <Text style={styles.meta}>Nobody has viewed your data recently.</Text>
        : views.map((v: any, i: number) => <View key={i} style={{ paddingVertical: 6 }}><Text style={styles.cardTitle}>{v.viewerName}</Text><Text style={styles.meta}>{RESOURCE_LABELS[v.resource] || v.resource} · {rel(v.viewedAt)}</Text></View>)}
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Account</Text>
      <Pressable style={styles.secondaryButton} onPress={async () => {
        try {
          const res = await fetch(`${session.serverUrl}/api/users/me/export`, { headers: { Authorization: `Bearer ${session.token}` } });
          if (!res.ok) throw new Error('Export failed');
          const text = await res.text();
          Alert.alert('Export', `Exported ${(text.length / 1024).toFixed(0)} KB. Full download requires web browser.`);
        } catch (e: any) { Alert.alert('Export failed', e.message); }
      }}><Text>Export my data</Text></Pressable>
      <Pressable style={styles.dangerButton} onPress={async () => {
        Alert.prompt('Delete account', 'Enter your password to confirm deletion.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: async (pwd?: string) => {
            if (!pwd) return;
            try {
              const res = await fetch(`${session.serverUrl}/api/users/me`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd }),
              });
              if (res.status === 409) { Alert.alert('Admin handoff required', 'Promote another member to admin first.'); return; }
              if (res.status === 401) { Alert.alert('Wrong password'); return; }
              if (!res.ok && res.status !== 204) throw new Error('Delete failed');
              onLogout();
            } catch (e: any) { Alert.alert('Failed', e.message); }
          }},
        ], 'secure-text');
      }}><Text style={styles.buttonText}>Delete my account</Text></Pressable>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Server</Text>
      <Text style={styles.meta}>{session.serverUrl}</Text>
      <Pressable style={styles.secondaryButton} onPress={onRefresh}><Text>Refresh data</Text></Pressable>
      <Pressable style={styles.dangerButton} onPress={onLogout}><Text style={styles.buttonText}>Log out</Text></Pressable>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Sideload build</Text>
      <Text style={styles.meta}>This app is built as an unsigned IPA in GitHub Actions, then signed on Windows with Sideloadly or AltStore using a free Apple ID.</Text>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, app: { flex: 1, backgroundColor: '#eef7f0' }, auth: { flex: 1, padding: 22, justifyContent: 'center', backgroundColor: '#eef7f0' }, brand: { fontSize: 44, fontWeight: '900', letterSpacing: -2, color: '#061b16' }, subtitle: { color: '#53616b', marginVertical: 14, fontSize: 16 }, header: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, eyebrow: { color: '#66737f', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.4, fontWeight: '800' }, title: { fontSize: 24, fontWeight: '900', letterSpacing: -1.2 }, badge: { backgroundColor: '#dff2e9', color: '#006c49', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, overflow: 'hidden', fontWeight: '800' }, map: { flex: 1 }, floating: { position: 'absolute', left: 14, right: 14, bottom: 16, backgroundColor: 'rgba(255,255,255,.92)', borderRadius: 26, padding: 14, gap: 10 }, row: { flexDirection: 'row', gap: 10, alignItems: 'center' }, content: { flex: 1, paddingHorizontal: 14 }, card: { backgroundColor: 'white', borderRadius: 22, padding: 14, marginBottom: 10, gap: 8, shadowColor: '#071b24', shadowOpacity: .08, shadowRadius: 12 }, cardTitle: { fontSize: 18, fontWeight: '900' }, meta: { color: '#66737f', lineHeight: 20 }, input: { backgroundColor: 'white', borderRadius: 16, padding: 13, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(7,27,36,.12)' }, inputFlex: { flex: 1, backgroundColor: 'white', borderRadius: 16, padding: 13, borderWidth: 1, borderColor: 'rgba(7,27,36,.12)' }, primaryButton: { backgroundColor: '#006c49', padding: 13, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flex: 1 }, dangerButton: { backgroundColor: '#ba1a1a', padding: 13, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flex: 1 }, secondaryButton: { backgroundColor: '#dff2e9', padding: 13, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flex: 1 }, secondaryText: { color: '#006c49', fontWeight: '700' }, buttonText: { color: 'white', fontWeight: '700' }, tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(7,27,36,.08)' }, tab: { flex: 1, paddingVertical: 8, alignItems: 'center' }, tabText: { fontSize: 12, color: '#66737f', textTransform: 'capitalize' }, activeTab: { backgroundColor: '#dff2e9' }, activeTabText: { color: '#006c49', fontWeight: '800' }, message: { backgroundColor: 'white', borderRadius: 16, padding: 10, marginVertical: 2 }, mine: { backgroundColor: '#006c49' }, composer: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: 'rgba(7,27,36,.08)' }, chip: { backgroundColor: '#f0f4f8', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }, chipActive: { backgroundColor: '#006c49' }, smallMap: { height: 220, borderRadius: 12 }, smallBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: '#dff2e9' },
});
