import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, Vibration } from 'react-native';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

type Session = { serverUrl: string; token: string; userId: number; circleId: number; displayName: string; email: string; readReceiptsEnabled?: boolean; crashDetectionEnabled?: boolean };
type Member = { userId: number; displayName: string; email?: string; role?: string; lat?: number; lng?: number; accuracyM?: number; speedMps?: number; batteryPct?: number; bearing?: number; altitudeM?: number; activity?: string; activityConfidence?: number; recordedAt?: number; photoUrl?: string; address?: string; paused?: boolean; pausedUntil?: number | null; pauseReason?: string | null };
type Place = { id: number; circleId: number; name: string; address?: string | null; lat: number; lng: number; radiusM: number; alertsOnEnter: boolean; alertsOnExit: boolean };
type Message = { id: number; circleId?: number; userId: number; displayName?: string; body?: string; createdAt: number; reactions?: { emoji: string; userIds: number[] }[]; attachmentKind?: string; attachmentUrl?: string; attachmentMime?: string; attachmentBytes?: number; attachmentDurationMs?: number; readers?: { userId: number; readAt: number }[] };
type AlertEvent = { id: number; userId: number; displayName?: string; circleId: number; type: string; value?: number; createdAt: number };
type PlaceSubscription = { id: number; userId: number; placeId: number; memberId: number | null; placeName?: string; memberName?: string; onEnter: boolean; onExit: boolean; quietStart?: number | null; quietEnd?: number | null };
type Routine = {
  id: number; userId: number; circleId: number; placeId: number; placeName: string;
  kind: string; dayOfWeek: number; expectedMinute: number; expectedDwellMinutes: number | null;
  toleranceMinutes: number; sampleCount: number; confidence: number; source: string; active: boolean;
  createdAt: number; updatedAt: number;
};
type RoutinePrefs = { routinesEnabled: boolean; quietStart: number | null; quietEnd: number | null };
type ExpectedArrival = {
  userId: number; displayName: string; photoUrl: string | null;
  placeId: number; placeName: string; kind: string; expectedMinute: number; expectedAt: number;
};
type LocationPoint = { id: number; lat: number; lng: number; recordedAt: number; activity?: string; speedMps?: number };
type MemberHealth = {
  userId: number;
  displayName: string;
  photoUrl: string | null;
  batteryPct: number | null;
  lastFixAt: number | null;
  staleMinutes: number | null;
  activity: string | null;
  paused: boolean;
  pausedUntil: number | null;
  nextRoutine: { kind: string; placeName: string; expectedMinute: number } | null;
  drivingScore: number | null;
  checkinStatus: string | null;
  checkinAt: number | null;
};
type TimelineItem = {
  kind: string;
  at: number;
  payload: Record<string, any>;
};
type TimelineResponse = { items: TimelineItem[]; cursor: number | null };
type PlaceAnalyticsMember = { userId: number; displayName: string; visitCount: number; totalDwellMs: number; lastVisitAt: number | null; avgDwellMs: number | null; longestDwellMs: number | null };
type WeekOverWeek = { lastWeekCount: number; prevWeekCount: number; deltaPct: number };
type PlaceAnalytics = { placeId: number; placeName: string; days: number; perMember: PlaceAnalyticsMember[]; weekOverWeek: WeekOverWeek };
type DigestSnapshot = {
  id: number; circleId: number; weekStart: number; weekEnd: number;
  summary: {
    members: Array<{ userId: number; displayName: string; tripCount: number; totalDistanceM: number; visitCount: number; checkinCount: number; routineAlerts: number; drivingScore: number | null; topPlaces: Array<{ name: string; dwellMs: number }> }>;
    circle: { totalKm: number; totalAlerts: number; busiestPlace: string | null; quietestMember: string | null };
  };
  createdAt: number;
};
type Trip = { id: number; startedAt: number; endedAt: number; mode: string; distanceM: number; maxSpeedMps: number | null; avgSpeedMps: number | null; startLabel: string | null; endLabel: string | null; pointCount: number; eventCount: number; durationMs: number };
type Tab = 'map' | 'members' | 'chat' | 'places' | 'alerts' | 'more';
type SubScreen = 'routines' | 'digest' | 'trips' | null;

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
function fmtMinute(m: number) { const h = Math.floor(m / 60); const mm = m % 60; return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }
function parseMinute(s: string): number | null { const parts = s.trim().split(':'); if (parts.length !== 2) return null; const h = parseInt(parts[0], 10); const m = parseInt(parts[1], 10); if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null; return h * 60 + m; }
function dayShort(dow: number) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow] || '?'; }
function fmtDurationMs(ms: number) { const mins = Math.round(ms / 60000); if (mins < 60) return `${mins}m`; const h = Math.floor(mins / 60); const r = mins % 60; return r > 0 ? `${h}h ${r}m` : `${h}h`; }
function fmtDist(m: number) { const km = m / 1000; return km < 1 ? `${Math.round(m)}m` : `${km.toFixed(1)} km`; }
function fmtSpeed(mps: number) { const kph = mps * 3.6; return `${kph.toFixed(0)} km/h`; }

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

function CrashCountdownModal({ crashState, onCancel, onExpire }: any) {
  const [remaining, setRemaining] = useState(Math.max(0, Math.ceil((crashState.expiresAt - Date.now()) / 1000)));
  useEffect(() => {
    if (remaining <= 0) { onExpire(); return; }
    const timer = setInterval(() => setRemaining((r: number) => r - 1), 1000);
    return () => clearInterval(timer);
  }, [remaining]);
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => {}}>
    <View style={{ flex: 1, backgroundColor: '#ba1a1a', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 16 }}>CRASH DETECTED</Text>
      <Text style={{ color: '#fff', fontSize: 72, fontWeight: '900' }}>{remaining}</Text>
      <Text style={{ color: '#ffffffcc', fontSize: 16, marginBottom: 32 }}>seconds until SOS</Text>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <Pressable onPress={onCancel} style={{ backgroundColor: '#fff', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 }}><Text style={{ color: '#ba1a1a', fontWeight: '700' }}>I'M OK — CANCEL</Text></Pressable>
        <Pressable onPress={onExpire} style={{ backgroundColor: '#fff', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 }}><Text style={{ color: '#ba1a1a', fontWeight: '700' }}>Send SOS now</Text></Pressable>
      </View>
    </View>
  </Modal>;
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
  const [typingUsers, setTypingUsers] = useState<Map<number, { displayName: string; expiresAt: number }>>(new Map());
  const mapRef = useRef<MapView | null>(null);
  const readQueueRef = useRef<number[]>([]);
  const readTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [crashState, setCrashState] = useState<{ id: number; expiresAt: number } | null>(null);
  const recentSpeedsRef = useRef<number[]>([]);
  const lastFixTimeRef = useRef<number>(0);
  const [health, setHealth] = useState<MemberHealth[]>([]);
  const healthDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [subScreen, setSubScreen] = useState<SubScreen>(null);
  const [subMemberId, setSubMemberId] = useState<number | null>(null);
  const [subMemberName, setSubMemberName] = useState('');
  const [digest, setDigest] = useState<DigestSnapshot | null>(null);

  function isProbablyDriving(): boolean {
    const speeds = recentSpeedsRef.current;
    if (speeds.length === 0) return false;
    const sorted = [...speeds].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return median >= 5 && (Date.now() - lastFixTimeRef.current) < 60000;
  }

  const load = useCallback(async () => {
    const [m, p] = await Promise.all([
      api<{ members: Member[] }>(session, `/api/circles/${session.circleId}/members`),
      api<{ places: Place[] }>(session, `/api/circles/${session.circleId}/places`),
    ]);
    setMembers(m.members); setPlaces(p.places);
  }, [session]);

  const loadHealth = useCallback(async () => {
    try {
      const data = await api<{ members: MemberHealth[] }>(session, `/api/circles/${session.circleId}/health`);
      setHealth(data.members);
    } catch {}
  }, [session]);

  const loadDigest = useCallback(async () => {
    try {
      const data = await api<DigestSnapshot | null>(session, `/api/circles/${session.circleId}/digest/current`);
      setDigest(data);
    } catch { setDigest(null); }
  }, [session]);

  useEffect(() => { load().catch((e) => Alert.alert('Load failed', e.message)); loadHealth().catch(() => {}); loadDigest().catch(() => {}); }, [load]);

  useEffect(() => {
    if (!session.crashDetectionEnabled || crashState) return;
    let DeviceMotion: any;
    try { DeviceMotion = require('expo-sensors').DeviceMotion; } catch { return; }
    DeviceMotion.setUpdateInterval(20);
    const sub = DeviceMotion.addListener((data: any) => {
      if (!session.crashDetectionEnabled || crashState) return;
      if (!isProbablyDriving()) return;
      const a = data.acceleration;
      if (!a) return;
      const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) * 9.81;
      if (mag >= 30) {
        (async () => {
          try {
            const res = await api<any>(session, '/api/crash-events', {
              method: 'POST',
              body: JSON.stringify({ peakAccelMps2: mag, sustainedMs: 100, speedMps: recentSpeedsRef.current[recentSpeedsRef.current.length - 1] || 0, platform: 'ios' }),
            });
            setCrashState({ id: res.id, expiresAt: Date.now() + 30000 });
          } catch {}
        })();
      }
    });
    return () => { try { sub.remove(); } catch {} };
  }, [session.crashDetectionEnabled, crashState]);

  useEffect(() => {
    if (!crashState) return;
    const vibInterval = setInterval(() => { Vibration.vibrate([0, 500, 500] as any, false); try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {} }, 800);
    return () => { clearInterval(vibInterval); Vibration.cancel(); };
  }, [crashState]);

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

  useEffect(() => {
    const wsUrl = session.serverUrl.replace(/^http/, 'ws').replace(/\/$/, '');
    const ws = new WebSocket(`${wsUrl}/ws?token=${session.token}`);
    ws.onmessage = (e) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'routine_deviation') {
        const kindLabel = msg.kind === 'missed_arrival' ? "didn't arrive at" : msg.kind === 'overstay' ? 'stayed too long at' : 'deviated from';
        Notifications.scheduleNotificationAsync({
          content: { title: 'Routine deviation', body: `${msg.displayName} ${kindLabel} ${msg.placeName}`, sound: true },
          trigger: null,
        });
      }
      if (['location_update', 'check_in', 'pause_changed', 'sos_active', 'sos_resolved', 'routine_deviation'].includes(msg.type)) {
        if (healthDebounceRef.current) clearTimeout(healthDebounceRef.current);
        healthDebounceRef.current = setTimeout(() => { loadHealth().catch(() => {}); }, 2000);
      }
      if (msg.type === 'digest_ready') { loadDigest().catch(() => {}); }
    };
    return () => { ws.close(); };
  }, [session]);

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

  return <SafeAreaView style={styles.app}><View style={styles.header}><View><Text style={styles.eyebrow}>{session.displayName}</Text><Text style={styles.title}>Family Guardian</Text></View></View>
    {subScreen === 'routines' && <RoutinesScreen session={session} places={places} onBack={() => setSubScreen(null)} />}
    {subScreen === 'digest' && <DigestScreen session={session} digest={digest} onBack={() => setSubScreen(null)} />}
    {subScreen === 'trips' && subMemberId != null && <TripsScreen session={session} memberId={subMemberId} memberName={subMemberName} onBack={() => setSubScreen(null)} />}
    {!subScreen && <>
      {tab === 'map' && <MapTab members={members} places={places} mapRef={mapRef} onMember={setSelectedMember} onShare={startSharing} sharing={sharing} onSos={sendSos} onCheckIn={checkIn} health={health} digest={digest} onOpenDigest={() => setSubScreen('digest')} />}
      {tab === 'members' && <MembersTab session={session} members={members} selected={selectedMember} setSelected={setSelectedMember} history={history} setHistory={setHistory} onViewTrips={(uid: number, name: string) => { setSubMemberId(uid); setSubMemberName(name); setSubScreen('trips'); }} />}
      {tab === 'chat' && <ChatTab session={session} messages={messages} setMessages={setMessages} loadMessages={loadMessages} typingUsers={typingUsers} readQueueRef={readQueueRef} readTimerRef={readTimerRef} />}
      {tab === 'places' && <PlacesTab session={session} places={places} setPlaces={setPlaces} />}
      {tab === 'alerts' && <AlertsTab alerts={alerts} loadAlerts={loadAlerts} />}
      {tab === 'more' && <MoreTab session={session} onLogout={logout} onRefresh={() => { load().catch(() => {}); loadDigest().catch(() => {}); }} onOpenRoutines={() => setSubScreen('routines')} onOpenDigest={() => setSubScreen('digest')} />}
      <View style={styles.tabs}>{(['map','members','chat','places','alerts','more'] as Tab[]).map((t) => <Pressable key={t} onPress={() => { setTab(t); if (t === 'chat') loadMessages().catch(() => {}); if (t === 'alerts') loadAlerts().catch(() => {}); }} style={[styles.tab, tab === t && styles.activeTab]}><Text style={[styles.tabText, tab === t && styles.activeTabText]}>{t}</Text></Pressable>)}</View>
    </>}
    {crashState && <CrashCountdownModal crashState={crashState} onCancel={async () => { try { await api(session, `/api/crash-events/${crashState.id}/dismiss`, { method: 'POST', body: '{}' }); } catch {} setCrashState(null); }} onExpire={async () => { try { await api(session, '/api/sos/activate', { method: 'POST', body: JSON.stringify({ source: 'crash', crashEventId: crashState.id }) }); } catch {} setCrashState(null); }} />}
  </SafeAreaView>;
}

function HealthStrip({ health }: { health: MemberHealth[] }) {
  if (health.length === 0) return null;
  function getInitials(name: string) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
  function statusColor(m: MemberHealth) {
    if (m.paused) return '#76777d';
    if (m.staleMinutes == null) return '#76777d';
    if (m.staleMinutes < 5) return '#006c49';
    if (m.staleMinutes < 30) return '#F57F17';
    return '#ba1a1a';
  }
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 64, paddingHorizontal: 14, paddingVertical: 6 }}>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {health.map((m) => <View key={m.userId} style={{ backgroundColor: 'white', borderRadius: 999, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, gap: 6, shadowColor: '#071b24', shadowOpacity: .06, shadowRadius: 6, elevation: 2 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#dff2e9', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#006c49' }}>{getInitials(m.displayName)}</Text>
        </View>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor(m) }} />
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#061b16' }} numberOfLines={1}>{m.displayName.split(' ')[0]}</Text>
        {m.batteryPct != null && <Text style={{ fontSize: 11, color: '#66737f' }}>{m.batteryPct}%</Text>}
        {m.drivingScore != null && <View style={{ backgroundColor: m.drivingScore >= 80 ? '#dff2e9' : m.drivingScore >= 60 ? '#FFF8E1' : '#FFEBEE', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999 }}>
          <Text style={{ fontSize: 10, fontWeight: '800', color: m.drivingScore >= 80 ? '#006c49' : m.drivingScore >= 60 ? '#F57F17' : '#ba1a1a' }}>{m.drivingScore}</Text>
        </View>}
      </View>)}
    </View>
  </ScrollView>;
}

function MapTab({ members, places, mapRef, onMember, onShare, sharing, onSos, onCheckIn, health, digest, onOpenDigest }: any) {
  const first = members.find((m: Member) => m.lat && m.lng);
  return <View style={styles.flex}><HealthStrip health={health} />
    {digest && digest.summary && <Pressable style={styles.digestCard} onPress={onOpenDigest}><Text style={styles.digestCardTitle}>This week</Text>{digest.summary.members.slice(0, 4).map((m: any) => <Text key={m.userId} style={styles.digestCardLine}>{m.displayName}: {m.tripCount} trips, {fmtDist(m.totalDistanceM)}</Text>)}</Pressable>}
    <MapView ref={mapRef} style={styles.map} initialRegion={{ latitude: first?.lat || 37.7749, longitude: first?.lng || -122.4194, latitudeDelta: 0.08, longitudeDelta: 0.08 }}>{places.map((p: Place) => <Circle key={p.id} center={{ latitude: p.lat, longitude: p.lng }} radius={p.radiusM} strokeColor="#006c49" fillColor="rgba(0,108,73,.10)" />)}{members.filter((m: Member) => m.lat && m.lng).map((m: Member) => <Marker key={m.userId} coordinate={{ latitude: m.lat!, longitude: m.lng! }} title={m.displayName + (m.paused ? ' (paused)' : '')} description={m.paused ? `Paused${m.pausedUntil ? ' until ' + formatPauseUntil(m.pausedUntil) : ''}` : rel(m.recordedAt)} pinColor={m.paused ? 'gray' : 'red'} opacity={m.paused ? 0.7 : 1} onPress={() => onMember(m)} />)}</MapView><View style={styles.floating}><Text style={styles.cardTitle}>{members.length} members</Text><View style={styles.row}><Pressable style={styles.primaryButton} onPress={onShare}><Text style={styles.buttonText}>{sharing ? 'Stop GPS' : 'Share GPS'}</Text></Pressable><Pressable style={styles.dangerButton} onPress={onSos}><Text style={styles.buttonText}>SOS</Text></Pressable></View><View style={styles.row}><Pressable style={styles.secondaryButton} onPress={() => onCheckIn('safe_home')}><Text>Safe home</Text></Pressable><Pressable style={styles.secondaryButton} onPress={() => onCheckIn('heading_home')}><Text>Heading home</Text></Pressable></View></View></View>;
}
function MembersTab({ session, members, selected, setSelected, history, setHistory, onViewTrips }: any) {
  const [ds, setDs] = useState<any>(null);
  const [dsDays, setDsDays] = useState(7);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  async function open(m: Member) { setSelected(m); setDs(null); setTimeline([]); setTimelineLoading(true); const to = Date.now(); const from = to - 86400000 * 7; const data = await api<{ points: LocationPoint[] }>(session, `/api/circles/${session.circleId}/members/${m.userId}/history?from=${from}&to=${to}&limit=500`); setHistory(data.points); loadDs(m.userId, 7); try { const tl = await api<TimelineResponse>(session, `/api/circles/${session.circleId}/members/${m.userId}/timeline?days=7`); setTimeline(tl.items); } catch {} setTimelineLoading(false); }
  async function loadDs(uid: number, days: number) { try { setDsDays(days); const d = await api<any>(session, `/api/users/${uid}/driving-score?days=${days}`); setDs(d); } catch { setDs(null); } }
  const scoreColor = ds?.score == null ? '#76777d' : ds.score >= 80 ? '#2E7D32' : ds.score >= 60 ? '#F57F17' : '#C62828';
  return <ScrollView style={styles.content}>{members.map((m: Member) => <Pressable key={m.userId} style={styles.card} onPress={() => open(m)}><Text style={styles.cardTitle}>{m.displayName}</Text>{m.paused ? <Text style={[styles.meta, { color: '#943700' }]}>⏸ Paused{m.pausedUntil ? ` until ${formatPauseUntil(m.pausedUntil)}` : ''}</Text> : <Text style={styles.meta}>{m.address || (m.lat ? `${m.lat.toFixed(4)}, ${m.lng?.toFixed(4)}` : 'No location yet')}</Text>}<Text style={styles.meta}>{rel(m.recordedAt)} {m.batteryPct != null ? `· ${m.batteryPct}%` : ''}</Text></Pressable>)}{selected && <View style={styles.card}><Text style={styles.cardTitle}>Recent Activity</Text>{timelineLoading ? <Text style={styles.meta}>Loading...</Text> : timeline.length === 0 ? <Text style={styles.meta}>No recent activity.</Text> : timeline.slice(0, 20).map((item, idx) => { const kindColor = item.kind.startsWith('visit') ? '#006c49' : item.kind.startsWith('trip') ? '#7B1FA2' : item.kind === 'check_in' ? '#006c49' : item.kind === 'routine_deviation' ? '#F57F17' : '#ba1a1a'; const kindIcon = item.kind.startsWith('visit') ? '📍' : item.kind.startsWith('trip') ? '🚗' : item.kind === 'check_in' ? '✅' : item.kind === 'routine_deviation' ? '⚠️' : '🚨'; const kindLabel = item.kind === 'visit_started' ? 'Arrived at place' : item.kind === 'visit_ended' ? 'Left place' : item.kind === 'trip_started' ? 'Started trip' : item.kind === 'trip_ended' ? 'Ended trip' : item.kind === 'check_in' ? 'Checked in' : item.kind === 'routine_deviation' ? 'Routine deviation' : item.kind; return <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}><Text style={{ fontSize: 16 }}>{kindIcon}</Text><View style={{ flex: 1 }}><Text style={{ fontSize: 13, fontWeight: '600', color: kindColor }}>{kindLabel}</Text>{item.payload.placeName && <Text style={styles.meta}>{item.payload.placeName}</Text>}</View><Text style={styles.meta}>{rel(item.at)}</Text></View>; })}</View>}{selected && <View style={styles.card}><Text style={styles.cardTitle}>Driving Safety</Text>{ds?.score == null ? <Text style={styles.meta}>Not enough driving data.</Text> : <><Text style={{ fontSize: 40, fontWeight: '900', color: scoreColor }}>{Math.round(ds.score)}<Text style={{ fontSize: 14, color: '#76777d' }}> / 100</Text></Text><View style={{ flexDirection: 'row', gap: 8, marginVertical: 8 }}>{[7,30,90].map(d => <Pressable key={d} onPress={() => loadDs(selected.userId, d)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 50, backgroundColor: dsDays === d ? '#006c49' : '#e5eeff' }}><Text style={{ color: dsDays === d ? '#fff' : '#45464d', fontWeight: '600', fontSize: 12 }}>{d}d</Text></Pressable>)}</View><Text style={styles.meta}>Hard brakes: {ds.hardBrakeCount} ({ds.hardBrakePer100Km?.toFixed(1)} / 100km)</Text><Text style={styles.meta}>Speeding: {ds.speedingMinutes?.toFixed(1)} min</Text><Text style={styles.meta}>Night driving: {((ds.nightDrivingPct ?? 0) * 100).toFixed(0)}%</Text></>}</View>}{selected && <Pressable style={styles.secondaryButton} onPress={() => onViewTrips(selected.userId, selected.displayName)}><Text>View all trips →</Text></Pressable>}{selected && <View style={styles.card}><Text style={styles.cardTitle}>{selected.displayName} history</Text><Text style={styles.meta}>{history.length} points in the last 7 days</Text>{history.length > 1 && <MapView style={styles.smallMap} initialRegion={{ latitude: history[0].lat, longitude: history[0].lng, latitudeDelta: .08, longitudeDelta: .08 }}><Polyline coordinates={history.map((p: LocationPoint) => ({ latitude: p.lat, longitude: p.lng }))} strokeColor="#006c49" strokeWidth={4} /></MapView>}</View>}</ScrollView>;
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
  const [analyticsPlace, setAnalyticsPlace] = useState<number | null>(null);
  const [analyticsData, setAnalyticsData] = useState<PlaceAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  useEffect(() => {
    api<{ members: Member[] }>(session, `/api/circles/${session.circleId}/members`)
      .then((d) => setMembers(d.members)).catch(() => {});
    api<{ subscriptions: PlaceSubscription[] }>(session, `/api/circles/${session.circleId}/place-subscriptions`)
      .then((d) => setSubs(d.subscriptions || [])).catch(() => {});
  }, [session]);

  async function loadAnalytics(placeId: number) {
    if (analyticsPlace === placeId && analyticsData) { setAnalyticsPlace(null); setAnalyticsData(null); return; }
    setAnalyticsLoading(true);
    setAnalyticsPlace(placeId);
    try {
      const data = await api<PlaceAnalytics>(session, `/api/places/${placeId}/analytics?days=30`);
      setAnalyticsData(data);
    } catch { setAnalyticsData(null); }
    setAnalyticsLoading(false);
  }

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
  function fmtMs(ms: number) {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  }
  function pctColor(pct: number) {
    if (pct > 10) return '#006c49';
    if (pct >= -10) return '#F57F17';
    return '#ba1a1a';
  }
  return <ScrollView style={styles.content}><View style={styles.card}><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Place name" /><TextInput style={styles.input} value={lat} onChangeText={setLat} placeholder="Latitude" keyboardType="decimal-pad" /><TextInput style={styles.input} value={lng} onChangeText={setLng} placeholder="Longitude" keyboardType="decimal-pad" /><TextInput style={styles.input} value={radius} onChangeText={setRadius} placeholder="Radius meters" keyboardType="decimal-pad" /><Pressable style={styles.primaryButton} onPress={save}><Text style={styles.buttonText}>Save place</Text></Pressable></View>{places.map((p: Place) => {
    const placeSubs = subs.filter((s) => s.placeId === p.id);
    const isExpanded = expandedPlace === p.id;
    const isAnalyticsOpen = analyticsPlace === p.id;
    const allTargets: { id: number | null; name: string }[] = [{ id: null, name: 'Anyone' }, ...members.map((m) => ({ id: m.userId, name: m.displayName }))];
    return <View style={styles.card} key={p.id}>
      <Text style={styles.cardTitle}>{p.name}</Text>
      <Text style={styles.meta}>{p.address || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`} · {Math.round(p.radiusM)}m</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <Pressable style={[styles.secondaryButton, { flex: 1 }]} onPress={() => setExpandedPlace(isExpanded ? null : p.id)}><Text>{isExpanded ? 'Hide notifications' : '🔔 Notify me when…'}</Text></Pressable>
        <Pressable style={[styles.secondaryButton, { flex: 1 }]} onPress={() => loadAnalytics(p.id)}><Text>{isAnalyticsOpen ? 'Hide analytics' : '📊 Analytics'}</Text></Pressable>
      </View>
      {isExpanded && allTargets.map((t) => {
        const sub = placeSubs.find((s) => s.memberId === t.id);
        return <View key={t.id ?? 'any'} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
          <Text style={{ flex: 1, fontWeight: '600' }}>{t.name}</Text>
          <Pressable style={[styles.chip, sub?.onEnter && styles.chipActive]} onPress={() => toggleSub(p.id, t.id, !(sub?.onEnter ?? false), sub?.onExit ?? false)}><Text>{sub?.onEnter ? '✅' : '◻️'} Arrives</Text></Pressable>
          <Pressable style={[styles.chip, sub?.onExit && styles.chipActive]} onPress={() => toggleSub(p.id, t.id, sub?.onEnter ?? false, !(sub?.onExit ?? false))}><Text>{sub?.onExit ? '✅' : '◻️'} Leaves</Text></Pressable>
        </View>;
      })}
      {isAnalyticsOpen && (analyticsLoading ? <Text style={styles.meta}>Loading analytics...</Text> : analyticsData ? <View style={{ marginTop: 8, gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#dff2e9', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 }}>
          <Text style={{ fontWeight: '700', color: '#006c49' }}>Week over week</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 13, color: '#66737f' }}>{analyticsData.weekOverWeek.prevWeekCount} → {analyticsData.weekOverWeek.lastWeekCount} visits</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: pctColor(analyticsData.weekOverWeek.deltaPct) }}>
              {analyticsData.weekOverWeek.deltaPct >= 0 ? '+' : ''}{analyticsData.weekOverWeek.deltaPct.toFixed(0)}%
            </Text>
          </View>
        </View>
        <Text style={{ fontWeight: '600', fontSize: 13 }}>Last 30 days per member</Text>
        {analyticsData.perMember.map((m) => <View key={m.userId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#e5e7eb' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600' }}>{m.displayName}</Text>
            <Text style={{ fontSize: 12, color: '#66737f' }}>{m.visitCount} visits · {fmtMs(m.totalDwellMs)} total</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            {m.avgDwellMs != null && <Text style={{ fontSize: 12, color: '#66737f' }}>avg {fmtMs(m.avgDwellMs)}</Text>}
            {m.lastVisitAt != null && <Text style={{ fontSize: 11, color: '#66737f' }}>last {rel(m.lastVisitAt)}</Text>}
          </View>
        </View>)}
        {analyticsData.perMember.length === 0 && <Text style={styles.meta}>No visits in the last 30 days.</Text>}
      </View> : <Text style={styles.meta}>Analytics unavailable.</Text>)}
    </View>;
  })}</ScrollView>;
}
function AlertsTab({ alerts, loadAlerts }: any) { useEffect(() => { loadAlerts().catch(() => {}); }, []); return <ScrollView style={styles.content}>{alerts.map((a: AlertEvent) => <View style={styles.card} key={a.id}><Text style={styles.cardTitle}>{a.displayName || 'Member'}</Text><Text style={styles.meta}>{a.type} {a.value != null ? `· ${a.value}` : ''} · {rel(a.createdAt)}</Text></View>)}</ScrollView>; }
function MoreTab({ session, onLogout, onRefresh, onOpenRoutines, onOpenDigest }: any) {
  const [pauseUntil, setPauseUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [views, setViews] = useState<any[]>([]);
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(session.readReceiptsEnabled || false);
  const [crashDetectionEnabled, setCrashDetectionEnabled] = useState(session.crashDetectionEnabled || false);
  const [routinesEnabled, setRoutinesEnabled] = useState(true);
  const [curfewEnabled, setCurfewEnabled] = useState(false);
  const [curfewStart, setCurfewStart] = useState('');
  const [curfewEnd, setCurfewEnd] = useState('');
  const [curfewHomePlaceId, setCurfewHomePlaceId] = useState<number | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [lowBatteryAlerts, setLowBatteryAlerts] = useState(false);
  const [lowBatteryThreshold, setLowBatteryThreshold] = useState(15);
  const [emergencyContacts, setEmergencyContacts] = useState<any[]>([]);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const RESOURCE_LABELS: Record<string, string> = { history: 'Location history', visits: 'Visits', trips: 'Trips', member_page: 'Profile page' };
  useEffect(() => {
    api<{ pausedUntil: number | null }>(session, '/api/users/me/pause')
      .then((d) => setPauseUntil(d.pausedUntil))
      .catch(() => {});
    api<{ views: any[] }>(session, '/api/users/me/view-log?days=7')
      .then((d) => setViews(d.views || []))
      .catch(() => {});
    api<any>(session, '/api/users/me')
      .then((d) => { if (d.readReceiptsEnabled != null) setReadReceiptsEnabled(d.readReceiptsEnabled); if (d.crashDetectionEnabled != null) setCrashDetectionEnabled(d.crashDetectionEnabled); })
      .catch(() => {});
    api<RoutinePrefs>(session, '/api/users/me/routine-prefs')
      .then((d) => { if (d.routinesEnabled != null) setRoutinesEnabled(d.routinesEnabled); })
      .catch(() => {});
    api<any>(session, '/api/users/me/alert-prefs')
      .then((d) => {
        if (d.curfewEnabled != null) setCurfewEnabled(d.curfewEnabled);
        if (d.curfewStart != null) setCurfewStart(fmtMinute(d.curfewStart));
        if (d.curfewEnd != null) setCurfewEnd(fmtMinute(d.curfewEnd));
        if (d.curfewHomePlaceId != null) setCurfewHomePlaceId(d.curfewHomePlaceId);
        if (d.lowBatteryAlerts != null) setLowBatteryAlerts(d.lowBatteryAlerts);
        if (d.lowBatteryThresholdPct != null) setLowBatteryThreshold(d.lowBatteryThresholdPct);
      })
      .catch(() => {});
    api<{ places: Place[] }>(session, `/api/circles/${session.circleId}/places`)
      .then((d) => setPlaces(d.places))
      .catch(() => {});
    api<{ contacts: any[] }>(session, '/api/users/me/emergency-contacts')
      .then((d) => setEmergencyContacts(d.contacts || []))
      .catch(() => {});
    api<{ invites: any[] }>(session, '/api/users/me/pending-invites')
      .then((d) => setPendingInvites(d.invites || []))
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
      <Text style={styles.cardTitle}>Emergency contacts</Text>
      <Text style={styles.meta}>People outside your circle who get notified on SOS. They won't see your location.</Text>
      {pendingInvites.map(inv => <View key={inv.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
        <View><Text style={{ fontWeight: '600' }}>{inv.fromDisplayName}</Text><Text style={styles.meta}>wants you as an emergency contact</Text></View>
        <Pressable style={styles.primaryButton} onPress={async () => {
          await api(session, `/api/users/me/emergency-contacts/${inv.id}/respond`, { method: 'POST', body: JSON.stringify({ action: 'accept' }) });
          setPendingInvites(prev => prev.filter(i => i.id !== inv.id));
        }}><Text style={styles.buttonText}>Accept</Text></Pressable>
      </View>)}
      {emergencyContacts.filter(c => c.status === 'accepted').map(c => <View key={c.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
        <Text>{c.contactDisplayName}</Text>
        <Pressable onPress={async () => {
          await api(session, `/api/users/me/emergency-contacts/${c.id}`, { method: 'DELETE' });
          setEmergencyContacts(prev => prev.filter(x => x.id !== c.id));
        }}><Text style={{ color: '#ba1a1a' }}>Remove</Text></Pressable>
      </View>)}
      {emergencyContacts.filter(c => c.status === 'pending').map(c => <View key={c.id} style={{ paddingVertical: 4 }}>
        <Text style={styles.meta}>{c.contactDisplayName} — pending</Text>
      </View>)}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} value={inviteEmail} onChangeText={setInviteEmail} placeholder="Email address" keyboardType="email-address" autoCapitalize="none" />
        <Pressable style={styles.primaryButton} onPress={async () => {
          if (!inviteEmail.trim()) return;
          try {
            const res = await api<any>(session, '/api/users/me/emergency-contacts', { method: 'POST', body: JSON.stringify({ email: inviteEmail.trim() }) });
            setEmergencyContacts(prev => [...prev, res]);
            setInviteEmail('');
          } catch (e: any) { Alert.alert('Failed', e.message); }
        }}><Text style={styles.buttonText}>Invite</Text></Pressable>
      </View>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Read receipts</Text>
      <Text style={styles.meta}>When ON, people who also enable receipts will see when you've read their messages.</Text>
      <Pressable style={styles.secondaryButton} onPress={toggleReadReceipts}><Text>{readReceiptsEnabled ? '✅ Enabled' : '◻️ Disabled'}</Text></Pressable>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Crash detection (auto-SOS)</Text>
      <Text style={styles.meta}>When ON, Family Guardian uses your phone's motion sensor to detect possible crashes and alerts your circle if you don't dismiss the countdown.</Text>
      <Pressable style={styles.secondaryButton} onPress={async () => {
        const next = !crashDetectionEnabled;
        try {
          await api(session, '/api/users/me', { method: 'PATCH', body: JSON.stringify({ crashDetectionEnabled: next }) });
          setCrashDetectionEnabled(next);
          session.crashDetectionEnabled = next;
        } catch (e: any) { Alert.alert('Failed', e.message); }
      }}><Text>{crashDetectionEnabled ? '✅ Enabled' : '◻️ Disabled'}</Text></Pressable>
    </View>
    <View style={{ padding: 16, borderBottomWidth: 1, borderColor: '#e5e7eb' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontWeight: '600' }}>Smart routines</Text>
        <Switch value={routinesEnabled} onValueChange={async (v) => {
          setRoutinesEnabled(v);
          await api(session, '/api/users/me/routine-prefs', { method: 'PATCH', body: JSON.stringify({ routinesEnabled: v }) });
        }} />
      </View>
      <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Get notified when family deviates from usual patterns</Text>
      <Pressable style={[styles.secondaryButton, { marginTop: 8 }]} onPress={onOpenRoutines}><Text>Manage routines →</Text></Pressable>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Weekly digest</Text>
      <Pressable style={styles.secondaryButton} onPress={onOpenDigest}><Text>View digest →</Text></Pressable>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Curfew alerts</Text>
      <Text style={styles.meta}>Alert your circle if you're not at home during set hours.</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <Text style={{ fontWeight: '600' }}>Enable curfew</Text>
        <Switch value={curfewEnabled} onValueChange={async (v) => {
          setCurfewEnabled(v);
          await api(session, '/api/users/me/alert-prefs', { method: 'PATCH', body: JSON.stringify({ curfewEnabled: v }) });
        }} />
      </View>
      {curfewEnabled && <>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TextInput style={[styles.input, { flex: 1 }]} value={curfewStart} onChangeText={setCurfewStart} placeholder="Start HH:MM" />
          <TextInput style={[styles.input, { flex: 1 }]} value={curfewEnd} onChangeText={setCurfewEnd} placeholder="End HH:MM" />
        </View>
        <ScrollView horizontal style={{ marginVertical: 4 }}>
          {places.map(p => <Pressable key={p.id} style={[styles.chip, curfewHomePlaceId === p.id && styles.chipActive]} onPress={() => setCurfewHomePlaceId(p.id)}><Text>{p.name}</Text></Pressable>)}
        </ScrollView>
        <Pressable style={styles.primaryButton} onPress={async () => {
          try {
            const cs = parseMinute(curfewStart);
            const ce = parseMinute(curfewEnd);
            if (cs == null || ce == null || curfewHomePlaceId == null) { Alert.alert('Fill in all fields'); return; }
            await api(session, '/api/users/me/alert-prefs', { method: 'PATCH', body: JSON.stringify({ curfewStart: cs, curfewEnd: ce, curfewHomePlaceId }) });
            Alert.alert('Curfew saved');
          } catch (e: any) { Alert.alert('Failed', e.message); }
        }}><Text style={styles.buttonText}>Save curfew</Text></Pressable>
      </>}
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Low-battery alerts</Text>
      <Text style={styles.meta}>Notify your circle when your battery drops below a threshold.</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <Text style={{ fontWeight: '600' }}>Enable</Text>
        <Switch value={lowBatteryAlerts} onValueChange={async (v) => {
          setLowBatteryAlerts(v);
          await api(session, '/api/users/me/alert-prefs', { method: 'PATCH', body: JSON.stringify({ lowBatteryAlerts: v }) });
        }} />
      </View>
      {lowBatteryAlerts && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Text style={styles.meta}>Threshold:</Text>
        <TextInput style={[styles.input, { width: 60 }]} value={String(lowBatteryThreshold)} onChangeText={t => setLowBatteryThreshold(parseInt(t) || 15)} keyboardType="number-pad" />
        <Text style={styles.meta}>%</Text>
        <Pressable style={styles.primaryButton} onPress={async () => {
          await api(session, '/api/users/me/alert-prefs', { method: 'PATCH', body: JSON.stringify({ lowBatteryThresholdPct: lowBatteryThreshold }) });
          Alert.alert('Saved');
        }}><Text style={styles.buttonText}>Save</Text></Pressable>
      </View>}
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

function RoutinesScreen({ session, places, onBack }: { session: Session; places: Place[]; onBack: () => void }) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [prefs, setPrefs] = useState<RoutinePrefs>({ routinesEnabled: true, quietStart: null, quietEnd: null });
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addPlace, setAddPlace] = useState<Place | null>(null);
  const [addKind, setAddKind] = useState('arrival');
  const [addDays, setAddDays] = useState<Set<number>>(new Set());
  const [addTime, setAddTime] = useState('');
  const [addTolerance, setAddTolerance] = useState(15);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatePlace, setTemplatePlace] = useState<Place | null>(null);

  async function reload() {
    try {
      const [rData, pData] = await Promise.all([
        api<{ routines: Routine[] }>(session, `/api/users/${session.userId}/routines`),
        api<RoutinePrefs>(session, '/api/users/me/routine-prefs'),
      ]);
      setRoutines(rData.routines);
      setPrefs(pData);
      setError(null);
    } catch (e: any) { setError(e.message); }
  }

  useEffect(() => { reload().finally(() => setLoading(false)); api<any[]>(session, '/api/routine-templates').then(setTemplates).catch(() => {}); }, []);

  async function toggleActive(r: Routine) {
    try {
      await api(session, `/api/routines/${r.id}`, { method: 'PATCH', body: JSON.stringify({ active: !r.active }) });
      reload();
    } catch (e: any) { setError(e.message); }
  }

  async function deleteRoutine(r: Routine) {
    Alert.alert('Delete routine?', `Remove ${r.placeName} ${r.kind}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await api(session, `/api/routines/${r.id}`, { method: 'DELETE' }); reload(); } catch (e: any) { setError(e.message); }
      }},
    ]);
  }

  async function createRoutine() {
    if (!addPlace || !addTime.trim() || addDays.size === 0) return;
    const minute = parseMinute(addTime);
    if (minute == null) return;
    setSaving(true);
    try {
      await api(session, '/api/users/me/routines', {
        method: 'POST',
        body: JSON.stringify({ placeId: addPlace.id, kind: addKind, daysOfWeek: [...addDays].sort(), expectedMinute: minute, toleranceMinutes: addTolerance }),
      });
      setShowAdd(false); setAddPlace(null); setAddDays(new Set()); setAddTime(''); setAddTolerance(15);
      reload();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  async function applyTemplate(t: any) {
    if (!templatePlace) { Alert.alert('Pick a place first'); return; }
    setSaving(true);
    try {
      await api(session, '/api/users/me/routines/from-template', {
        method: 'POST',
        body: JSON.stringify({ templateId: t.id, placeId: templatePlace.id }),
      });
      setShowTemplates(false); setTemplatePlace(null); reload();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  async function togglePrefsEnabled(v: boolean) {
    setPrefs(p => ({ ...p, routinesEnabled: v }));
    try { await api(session, '/api/users/me/routine-prefs', { method: 'PATCH', body: JSON.stringify({ routinesEnabled: v }) }); } catch (e: any) { setError(e.message); }
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (loading) return <View style={styles.center}><Text>Loading routines...</Text></View>;

  return <ScrollView style={styles.content}>
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable onPress={onBack}><Text style={{ color: '#006c49', fontWeight: '700' }}>← Back</Text></Pressable>
        <Text style={styles.cardTitle}>Smart routines</Text>
        <View style={{ width: 50 }} />
      </View>
      <Text style={styles.meta}>Routines are patterns we've noticed about your week.</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <Text style={{ fontWeight: '600' }}>Routine alerts</Text>
        <Switch value={prefs.routinesEnabled} onValueChange={togglePrefsEnabled} />
      </View>
    </View>

    {error && <View style={styles.card}><Text style={{ color: '#ba1a1a' }}>{error}</Text></View>}

    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4, paddingVertical: 8 }}>
      <Pressable style={styles.secondaryButton} onPress={() => setShowAdd(!showAdd)}><Text>{showAdd ? 'Cancel' : '+ Custom'}</Text></Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => setShowTemplates(!showTemplates)}><Text>{showTemplates ? 'Cancel' : 'Templates'}</Text></Pressable>
    </View>

    {showTemplates && <View style={styles.card}>
      <Text style={{ fontWeight: '700', marginBottom: 8 }}>Apply a template</Text>
      <Text style={styles.meta}>Pick a place first</Text>
      <ScrollView horizontal style={{ marginVertical: 4 }}>
        {places.map(p => <Pressable key={p.id} style={[styles.chip, templatePlace?.id === p.id && styles.chipActive]} onPress={() => setTemplatePlace(p)}><Text>{p.name}</Text></Pressable>)}
      </ScrollView>
      {templates.map(t => <View key={t.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: '#e5e7eb' }}>
        <Text style={{ fontWeight: '600' }}>{t.title}</Text>
        <Text style={styles.meta}>{t.description}</Text>
        <Pressable style={[styles.primaryButton, { marginTop: 4, opacity: templatePlace ? 1 : 0.5 }]} onPress={() => applyTemplate(t)} disabled={!templatePlace || saving}><Text style={styles.buttonText}>{saving ? 'Applying...' : 'Apply'}</Text></Pressable>
      </View>)}
    </View>}

    <Text style={{ fontSize: 16, fontWeight: '700', paddingHorizontal: 4, paddingBottom: 4 }}>Your routines</Text>

    {showAdd && <View style={styles.card}>
      <Text style={{ fontWeight: '700', marginBottom: 8 }}>Add routine</Text>
      <Text style={styles.meta}>Place</Text>
      <ScrollView horizontal style={{ marginVertical: 4 }}>
        {places.map(p => <Pressable key={p.id} style={[styles.chip, addPlace?.id === p.id && styles.chipActive]} onPress={() => setAddPlace(p)}><Text>{p.name}</Text></Pressable>)}
      </ScrollView>
      <Text style={styles.meta}>Kind</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 4 }}>
        <Pressable style={[styles.chip, addKind === 'arrival' && styles.chipActive]} onPress={() => setAddKind('arrival')}><Text>Arrival</Text></Pressable>
        <Pressable style={[styles.chip, addKind === 'departure' && styles.chipActive]} onPress={() => setAddKind('departure')}><Text>Departure</Text></Pressable>
        <Pressable style={[styles.chip, addKind === 'dwell' && styles.chipActive]} onPress={() => setAddKind('dwell')}><Text>Dwell</Text></Pressable>
      </View>
      <Text style={styles.meta}>Days</Text>
      <View style={{ flexDirection: 'row', gap: 6, marginVertical: 4, flexWrap: 'wrap' }}>
        {dayNames.map((d, i) => <Pressable key={i} style={[styles.chip, addDays.has(i) && styles.chipActive]} onPress={() => setAddDays(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; })}><Text>{d}</Text></Pressable>)}
      </View>
      <TextInput style={styles.input} value={addTime} onChangeText={setAddTime} placeholder="Expected time (HH:MM, 24h)" />
      <Text style={styles.meta}>Tolerance: {addTolerance} min</Text>
      <TextInput style={styles.input} value={String(addTolerance)} onChangeText={t => setAddTolerance(parseInt(t) || 15)} placeholder="Tolerance (min)" keyboardType="number-pad" />
      <Pressable style={[styles.primaryButton, (saving || !addPlace || !parseMinute(addTime) || addDays.size === 0) && { opacity: 0.5 }]} onPress={createRoutine} disabled={saving || !addPlace || !parseMinute(addTime) || addDays.size === 0}><Text style={styles.buttonText}>{saving ? 'Saving...' : 'Create routine'}</Text></Pressable>
    </View>}

    {routines.length === 0 && <View style={styles.card}><Text style={styles.meta}>No routines yet. Patterns will appear after about a week of visits.</Text></View>}
    {routines.map(r => {
      const confBadge = r.confidence >= 0.8 ? 'Strong' : r.confidence >= 0.6 ? 'Moderate' : 'Learning';
      const confColor = r.confidence >= 0.8 ? '#006c49' : r.confidence >= 0.6 ? '#F57F17' : '#76777d';
      return <View key={r.id} style={styles.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>{r.placeName} · {r.kind === 'arrival' ? 'arrives' : r.kind === 'departure' ? 'leaves' : 'stays'}</Text>
            <Text style={styles.meta}>{dayShort(r.dayOfWeek)} · {r.kind === 'dwell' && r.expectedDwellMinutes ? `~${r.expectedDwellMinutes} min ± ${r.toleranceMinutes} min` : `usually ${fmtMinute(r.expectedMinute)} ± ${r.toleranceMinutes} min`}</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
              <View style={{ backgroundColor: '#f0f4f8', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}><Text style={{ fontSize: 11 }}>{r.source === 'manual' ? 'Manual' : 'Auto'}</Text></View>
              <View style={{ backgroundColor: confColor + '18', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}><Text style={{ fontSize: 11, color: confColor, fontWeight: '600' }}>{confBadge}</Text></View>
            </View>
          </View>
          <Switch value={r.active} onValueChange={() => toggleActive(r)} />
          <Pressable onPress={() => deleteRoutine(r)} style={{ paddingHorizontal: 8 }}><Text style={{ color: '#ba1a1a', fontSize: 20 }}>×</Text></Pressable>
        </View>
      </View>;
    })}
    <View style={{ height: 40 }} />
  </ScrollView>;
}

function DigestScreen({ session, digest, onBack }: { session: Session; digest: DigestSnapshot | null; onBack: () => void }) {
  const [pastDigests, setPastDigests] = useState<DigestSnapshot[]>([]);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    if (!showPast) return;
    const since = Date.now() - 12 * 7 * 24 * 60 * 60 * 1000;
    api<{ snapshots: DigestSnapshot[] }>(session, `/api/circles/${session.circleId}/digest?since=${since}`)
      .then(d => setPastDigests(d.snapshots || []))
      .catch(() => {});
  }, [showPast]);

  return <ScrollView style={styles.content}>
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable onPress={onBack}><Text style={{ color: '#006c49', fontWeight: '700' }}>← Back</Text></Pressable>
        <Text style={styles.cardTitle}>Weekly Digest</Text>
        <View style={{ width: 50 }} />
      </View>
    </View>

    {!digest && <View style={styles.card}><Text style={styles.meta}>No digest available yet. Check back next week.</Text></View>}
    {digest && digest.summary && <>
      <View style={[styles.card, { backgroundColor: '#dff2e9' }]}>
        <Text style={{ fontWeight: '700', color: '#006c49' }}>
          {new Date(digest.weekStart).toLocaleDateString()} – {new Date(digest.weekEnd).toLocaleDateString()}
        </Text>
        <View style={{ flexDirection: 'row', gap: 24, marginTop: 8 }}>
          <View><Text style={{ fontSize: 28, fontWeight: '900', color: '#006c49' }}>{digest.summary.circle.totalKm}</Text><Text style={styles.meta}>Total km</Text></View>
          <View><Text style={{ fontSize: 28, fontWeight: '900', color: '#006c49' }}>{digest.summary.circle.totalAlerts}</Text><Text style={styles.meta}>Alerts</Text></View>
        </View>
        {digest.summary.circle.busiestPlace && <Text style={styles.meta}>Busiest: {digest.summary.circle.busiestPlace}</Text>}
        {digest.summary.circle.quietestMember && <Text style={styles.meta}>Quietest: {digest.summary.circle.quietestMember}</Text>}
      </View>

      {digest.summary.members.map(m => <View key={m.userId} style={styles.card}>
        <Text style={{ fontWeight: '700' }}>{m.displayName}</Text>
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
          <View><Text style={{ fontWeight: '700' }}>{m.tripCount}</Text><Text style={styles.meta}>Trips</Text></View>
          <View><Text style={{ fontWeight: '700' }}>{fmtDist(m.totalDistanceM)}</Text><Text style={styles.meta}>Distance</Text></View>
          <View><Text style={{ fontWeight: '700' }}>{m.visitCount}</Text><Text style={styles.meta}>Visits</Text></View>
          <View><Text style={{ fontWeight: '700' }}>{m.checkinCount}</Text><Text style={styles.meta}>Check-ins</Text></View>
        </View>
        {m.routineAlerts > 0 && <Text style={{ color: '#ba1a1a', fontSize: 12, marginTop: 4 }}>{m.routineAlerts} routine alerts</Text>}
        {m.drivingScore != null && <Text style={{ color: m.drivingScore >= 80 ? '#006c49' : m.drivingScore >= 60 ? '#F57F17' : '#ba1a1a', fontWeight: '700', fontSize: 12, marginTop: 2 }}>Driving score: {m.drivingScore}</Text>}
      </View>)}

      <Pressable style={styles.secondaryButton} onPress={() => setShowPast(!showPast)}><Text>{showPast ? 'Hide past weeks' : 'View past weeks'}</Text></Pressable>
      {showPast && pastDigests.map(d => <View key={d.id} style={styles.card}>
        <Text style={{ fontWeight: '700' }}>{new Date(d.weekStart).toLocaleDateString()} – {new Date(d.weekEnd).toLocaleDateString()}</Text>
        <Text style={styles.meta}>{d.summary?.circle?.totalKm ?? '?'} km · {d.summary?.members?.length ?? '?'} members</Text>
      </View>)}
    </>}
    <View style={{ height: 40 }} />
  </ScrollView>;
}

function TripsScreen({ session, memberId, memberName, onBack }: { session: Session; memberId: number; memberName: string; onBack: () => void }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(7);

  async function loadTrips(days: number) {
    setRange(days);
    setLoading(true);
    try {
      const from = Date.now() - days * 24 * 60 * 60 * 1000;
      const data = await api<{ trips: Trip[] }>(session, `/api/circles/${session.circleId}/members/${memberId}/trips?from=${from}`);
      setTrips(data.trips);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadTrips(7); }, []);

  return <ScrollView style={styles.content}>
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable onPress={onBack}><Text style={{ color: '#006c49', fontWeight: '700' }}>← Back</Text></Pressable>
        <Text style={styles.cardTitle}>{memberName}'s trips</Text>
        <View style={{ width: 50 }} />
      </View>
    </View>

    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4, paddingVertical: 8 }}>
      {[7, 30, 90].map(d => <Pressable key={d} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: range === d ? '#006c49' : '#dff2e9' }} onPress={() => loadTrips(d)}><Text style={{ color: range === d ? '#fff' : '#006c49', fontWeight: '700', fontSize: 12 }}>{d}d</Text></Pressable>)}
    </View>

    {loading && <View style={styles.center}><Text>Loading...</Text></View>}
    {!loading && trips.length === 0 && <View style={styles.card}><Text style={styles.meta}>No trips in this range.</Text></View>}
    {!loading && trips.map(t => {
      const modeIcon = t.mode === 'driving' ? '🚗' : t.mode === 'walking' ? '🚶' : t.mode === 'running' ? '🏃' : '🚴';
      const maxKph = t.maxSpeedMps ? t.maxSpeedMps * 3.6 : null;
      const speedColor = maxKph == null ? '#66737f' : maxKph < 50 ? '#006c49' : maxKph < 70 ? '#F57F17' : '#ba1a1a';
      return <View key={t.id} style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontSize: 24 }}>{modeIcon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>{t.endLabel || t.startLabel || t.mode}</Text>
            <Text style={styles.meta}>{new Date(t.startedAt).toLocaleDateString()} · {fmtDist(t.distanceM)} · {fmtDurationMs(t.durationMs)}</Text>
            {maxKph != null && <Text style={{ color: speedColor, fontWeight: '600', fontSize: 12 }}>Max {maxKph.toFixed(0)} km/h</Text>}
          </View>
        </View>
      </View>;
    })}
    <View style={{ height: 40 }} />
  </ScrollView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, app: { flex: 1, backgroundColor: '#eef7f0' }, auth: { flex: 1, padding: 22, justifyContent: 'center', backgroundColor: '#eef7f0' }, brand: { fontSize: 44, fontWeight: '900', letterSpacing: -2, color: '#061b16' }, subtitle: { color: '#53616b', marginVertical: 14, fontSize: 16 }, header: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, eyebrow: { color: '#66737f', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.4, fontWeight: '800' }, title: { fontSize: 24, fontWeight: '900', letterSpacing: -1.2 }, badge: { backgroundColor: '#dff2e9', color: '#006c49', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, overflow: 'hidden', fontWeight: '800' }, map: { flex: 1 }, floating: { position: 'absolute', left: 14, right: 14, bottom: 16, backgroundColor: 'rgba(255,255,255,.92)', borderRadius: 26, padding: 14, gap: 10 }, row: { flexDirection: 'row', gap: 10, alignItems: 'center' }, content: { flex: 1, paddingHorizontal: 14 }, card: { backgroundColor: 'white', borderRadius: 22, padding: 14, marginBottom: 10, gap: 8, shadowColor: '#071b24', shadowOpacity: .08, shadowRadius: 12 }, cardTitle: { fontSize: 18, fontWeight: '900' }, meta: { color: '#66737f', lineHeight: 20 }, input: { backgroundColor: 'white', borderRadius: 16, padding: 13, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(7,27,36,.12)' }, inputFlex: { flex: 1, backgroundColor: 'white', borderRadius: 16, padding: 13, borderWidth: 1, borderColor: 'rgba(7,27,36,.12)' }, primaryButton: { backgroundColor: '#006c49', padding: 13, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flex: 1 }, dangerButton: { backgroundColor: '#ba1a1a', padding: 13, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flex: 1 }, secondaryButton: { backgroundColor: '#dff2e9', padding: 13, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flex: 1 }, secondaryText: { color: '#006c49', fontWeight: '700' }, buttonText: { color: 'white', fontWeight: '700' }, tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(7,27,36,.08)' }, tab: { flex: 1, paddingVertical: 8, alignItems: 'center' }, tabText: { fontSize: 12, color: '#66737f', textTransform: 'capitalize' }, activeTab: { backgroundColor: '#dff2e9' }, activeTabText: { color: '#006c49', fontWeight: '800' }, message: { backgroundColor: 'white', borderRadius: 16, padding: 10, marginVertical: 2 }, mine: { backgroundColor: '#006c49' }, composer: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: 'rgba(7,27,36,.08)' }, chip: { backgroundColor: '#f0f4f8', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }, chipActive: { backgroundColor: '#006c49' },   smallMap: { height: 220, borderRadius: 12 }, smallBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: '#dff2e9' }, digestCard: { backgroundColor: 'white', marginHorizontal: 14, marginTop: 6, marginBottom: 4, borderRadius: 16, padding: 12, shadowColor: '#071b24', shadowOpacity: .06, shadowRadius: 6, elevation: 2 }, digestCardTitle: { fontSize: 14, fontWeight: '800', color: '#006c49', marginBottom: 4 }, digestCardLine: { fontSize: 12, color: '#45464d', lineHeight: 18 },
});
