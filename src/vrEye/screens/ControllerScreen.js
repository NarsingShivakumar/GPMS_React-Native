/**
 * ControllerScreen.js  v2.1  — Overlay fix + style cleanup
 *
 * Changes from v2.0:
 *
 * FIX 1 — Duplicate eyeCentreDivider style removed (was overriding itself)
 * FIX 2 — Double-wrap overflow:hidden on EyePanel containers to fix
 *          Android vignette/overlay bleed from AstigmatismTest & IshiharaTest
 * FIX 3 — eyeScrollOuter / eyeScrollContent dead styles removed
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, StatusBar, ActivityIndicator,
  KeyboardAvoidingView, Platform, Dimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import localPeerService from '../services/localPeerService';
import apiService from '../../api/AxiosClient';
import EyePanel from '../components/EyePanel';
// import apiService from '../../AxiosClient';
import { generatePlateDots, getPlate, TOTAL_PLATES } from '../utils/ishiharaPanel';

// ── API helpers ───────────────────────────────────────────────────────────────
const fetchActiveAssistantsApi = async () => {
  const res = await apiService.get('api/assistant/auth/active-assistants');
  return res?.data?.response ?? res?.data ?? [];
};
const submitRegistrationApi = async (payload) => {
  const res = await apiService.post('api/vr/session/start', payload);
  return res?.data ?? res;
};

const ALLERGY_OPTIONS = [
  { key: 'allergyNITT', label: 'NITT' },
  { key: 'allergyPenicillin', label: 'Penicillin' },
  { key: 'allergyXylocaine', label: 'Xylocaine' },
  { key: 'allergySulpha', label: 'Sulpha' },
  { key: 'allergyAtropine', label: 'Atropine' },
  { key: 'allergyDropsyn', label: 'Dropsyn' },
];
const INIT_ALLERGIES = {
  allergyNITT: false, allergyPenicillin: false, allergyXylocaine: false,
  allergySulpha: false, allergyAtropine: false, allergyDropsyn: false,
};

const PHASE_COLORS = {
  waiting: '#444',
  acuity: '#5b5bd6',
  color: '#e91e63',
  near: '#009688',
  astigmatism: '#ff9800',
  complete: '#4caf50',
};

// Dynamic eye panel size — always fits side-by-side on any screen
// 16px left padding + 16px right padding + 2px divider + 4px gap between cards = 38px chrome
const { width: W } = Dimensions.get('window');
const EYE_W = Math.floor((W - 38) / 2);
const EYE_H = Math.round(EYE_W * (4 / 3));

export default function ControllerScreen({ route, navigation }) {
  // view: 'connecting' | 'registration' | 'ready' | 'monitoring'
  const [view, setView] = useState(
    localPeerService.isConnected() ? 'registration' : 'connecting'
  );

  // ── Peer status ───────────────────────────────────────────────────────────
  const [peerConnected, setPeerConnected] = useState(localPeerService.isConnected());
  const [peerRtt, setPeerRtt] = useState(null);
  const [peerReconnecting, setPeerReconnecting] = useState(false);

  // ── Registration ──────────────────────────────────────────────────────────
  const [regStep, setRegStep] = useState('details');
  const [regName, setRegName] = useState('');
  const [regAge, setRegAge] = useState('');
  const [regGender, setRegGender] = useState('');
  const [regMobile, setRegMobile] = useState('');
  const [regGlasses, setRegGlasses] = useState(false);
  const [regAllergies, setRegAllergies] = useState({ ...INIT_ALLERGIES });
  const [activeAssistants, setActiveAssistants] = useState([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState('');
  const [loadingAssistants, setLoadingAssistants] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // ── Session ───────────────────────────────────────────────────────────────
  const [roomCode, setRoomCode] = useState('');
  const [patientName, setPatientName] = useState('');
  const [vrState, setVrState] = useState({
    phase: 'waiting', instruction: 'Waiting\u2026',
    optotype: null, isComplete: false,
    showLeft: true, showRight: true,
    colorShowLeft: true, colorShowRight: true,
    nearShowLeft: true, nearShowRight: true,
    astigShowLeft: true, astigShowRight: true,
    plateIndex: 0, nearOptotype: null,
    isLensCheck: false, lensCheckEye: 'both',
  });

  const unsubs = useRef([]);

  // ── Mount: peer listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const U = unsubs.current;

    U.push(localPeerService.on('connected', () => {
      setPeerConnected(true);
      setPeerReconnecting(false);
      setView(prev => prev === 'connecting' ? 'registration' : prev);
    }));
    U.push(localPeerService.on('disconnected', () => setPeerConnected(false)));
    U.push(localPeerService.on('reconnecting', () => { setPeerReconnecting(true); setPeerConnected(false); }));
    U.push(localPeerService.on('ping_rtt', ({ rtt }) => setPeerRtt(rtt)));

    U.push(localPeerService.on('vr_state_update', (state) => {
      setVrState(prev => ({ ...prev, ...state }));
      if (state.phase && state.phase !== 'waiting') {
        setView(prev => prev === 'ready' ? 'monitoring' : prev);
      }
    }));

    U.push(localPeerService.on('vr_session_started', ({ patientName: pn }) => {
      if (pn) setPatientName(pn);
      setView('monitoring');
    }));
    U.push(localPeerService.on('vr_session_ended', () => resetSession()));

    if (localPeerService.isConnected()) { setPeerConnected(true); fetchAssistants(); }

    return () => { U.forEach(fn => fn()); unsubs.current = []; };
  }, []); // eslint-disable-line

  const resetSession = useCallback(() => {
    setView('registration'); setRoomCode(''); setRegStep('details');
    setSelectedAssistantId(''); setSubmitError(''); setPatientName('');
    setVrState({
      phase: 'waiting', instruction: 'Waiting\u2026',
      optotype: null, isComplete: false,
      showLeft: true, showRight: true,
      colorShowLeft: true, colorShowRight: true,
      nearShowLeft: true, nearShowRight: true,
      astigShowLeft: true, astigShowRight: true,
      plateIndex: 0, nearOptotype: null,
      isLensCheck: false, lensCheckEye: 'both',
    });
  }, []);

  const fetchAssistants = useCallback(async () => {
    setLoadingAssistants(true);
    try {
      const list = await fetchActiveAssistantsApi();
      setActiveAssistants(Array.isArray(list) ? list : []);
    } catch { setActiveAssistants([]); }
    finally { setLoadingAssistants(false); }
  }, []);

  const regDetailsValid = regName.trim() && regMobile.trim() && regGender;

  const goToAssistantStep = useCallback(() => {
    if (regDetailsValid) { setRegStep('assistant'); fetchAssistants(); }
  }, [regDetailsValid, fetchAssistants]);

  // ── Submit registration ───────────────────────────────────────────────────
  const submitRegistration = useCallback(async () => {
    if (!selectedAssistantId || submitting) return;
    setSubmitting(true); setSubmitError('');
    const payload = {
      patientName: regName.trim(),
      patientAge: regAge ? Number(regAge) : null,
      patientGender: regGender,
      mobileNumber: regMobile.trim(),
      wearingGlasses: regGlasses,
      assistantId: selectedAssistantId,
      ...regAllergies,
    };
    try {
      const res = await submitRegistrationApi(payload);
      const rc = res.roomCode;
      const pn = res.patientName ?? regName.trim();
      setRoomCode(rc); setPatientName(pn);
      localPeerService.send('session_registered', { roomCode: rc, patientName: pn });
      setView('ready');
    } catch (err) {
      setSubmitError(err?.response?.data?.message ?? err?.message ?? 'Could not start session.');
    } finally { setSubmitting(false); }
  }, [selectedAssistantId, submitting, regName, regAge, regGender, regMobile, regGlasses, regAllergies]);

  const startTest = useCallback(() => {
    localPeerService.send('start_test', { roomCode });
    setView('monitoring');
  }, [roomCode]);

  const endSession = useCallback(() => {
    localPeerService.send('end_session', { roomCode });
    resetSession();
  }, [roomCode, resetSession]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Connecting
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'connecting') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={s.root} edges={['top', 'bottom']}>
          <View style={s.centeredCard}>
            <ActivityIndicator color="#5b5bd6" size="large" />
            <Text style={s.connectingTitle}>
              {peerReconnecting ? 'Reconnecting to VR Host\u2026' : 'Waiting for VR Host\u2026'}
            </Text>
            <Text style={s.connectingHint}>
              Make sure the VR host device is running and on the same Wi\u2011Fi.
            </Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Registration
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'registration') {
    return (
      <SafeAreaProvider>
        <KeyboardAvoidingView
          style={s.root}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <StatusBar barStyle="light-content" backgroundColor="#080820" />
          <PeerStatusBar connected={peerConnected} rtt={peerRtt} reconnecting={peerReconnecting} />

          <ScrollView
            contentContainerStyle={s.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={{ fontSize: 24 }}>👁</Text>
                <Text style={s.cardEyebrow}>Controller · Patient Registration</Text>
                <Text style={s.cardTitle}>Patient Registration</Text>
                <View style={s.stepIndicator}>
                  <StepDot n={1} active={regStep === 'details'} done={regStep === 'assistant'} label="Details" />
                  <View style={s.stepLine} />
                  <StepDot n={2} active={regStep === 'assistant'} done={false} label="Assistant" />
                </View>
              </View>

              <View style={s.formBody}>
                {regStep === 'details' && (
                  <>
                    <Field label="Full Name *" value={regName} onChange={setRegName} placeholder="e.g. Ravi Kumar" />
                    <View style={s.row}>
                      <Field label="Age" value={regAge} onChange={setRegAge} placeholder="Years" keyboardType="numeric" maxLength={3} flex={1} />
                      <View style={{ flex: 1, gap: 8 }}>
                        <Text style={s.label}>Gender *</Text>
                        <View style={s.genderRow}>
                          {['Male', 'Female', 'Other'].map(g => (
                            <TouchableOpacity key={g} style={[s.genderBtn, regGender === g && s.genderBtnSel]} onPress={() => setRegGender(g)}>
                              <Text style={[s.genderText, regGender === g && s.genderTextSel]}>{g}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    </View>
                    <Field label="Mobile Number *" value={regMobile} onChange={setRegMobile} placeholder="10-digit" keyboardType="phone-pad" maxLength={15} />

                    <TouchableOpacity style={s.checkRow} onPress={() => setRegGlasses(v => !v)}>
                      <View style={[s.checkbox, regGlasses && s.checkboxOn]}>
                        {regGlasses && <Text style={s.checkmark}>✓</Text>}
                      </View>
                      <Text style={s.checkLabel}>Currently wearing glasses / contacts</Text>
                    </TouchableOpacity>

                    <Text style={s.label}>Known Allergies</Text>
                    <View style={s.allergyGrid}>
                      {ALLERGY_OPTIONS.map(a => (
                        <TouchableOpacity key={a.key} style={[s.chip, regAllergies[a.key] && s.chipSel]} onPress={() => setRegAllergies(p => ({ ...p, [a.key]: !p[a.key] }))}>
                          <Text style={[s.chipText, regAllergies[a.key] && s.chipTextSel]}>{a.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <TouchableOpacity style={[s.btn, !regDetailsValid && s.btnOff]} onPress={goToAssistantStep} disabled={!regDetailsValid}>
                      <Text style={s.btnText}>Next \u2014 Choose Assistant  \u2192</Text>
                    </TouchableOpacity>
                  </>
                )}

                {regStep === 'assistant' && (
                  <>
                    <TouchableOpacity style={s.back} onPress={() => setRegStep('details')}>
                      <Text style={s.backText}>\u2190 Back</Text>
                    </TouchableOpacity>
                    <Text style={s.sectionHeading}>Select Assistant</Text>

                    {loadingAssistants ? (
                      <View style={s.loadingRow}><ActivityIndicator color="#7c7cf0" /><Text style={s.loadingText}>Loading\u2026</Text></View>
                    ) : activeAssistants.length === 0 ? (
                      <View style={s.emptyBox}>
                        <Text style={s.emptyText}>No assistants online.</Text>
                        <TouchableOpacity style={s.retryBtn} onPress={fetchAssistants}><Text style={s.retryText}>Retry</Text></TouchableOpacity>
                      </View>
                    ) : (
                      <View style={{ gap: 10 }}>
                        {activeAssistants.map(a => (
                          <TouchableOpacity key={a.assistantId} style={[s.assistantCard, selectedAssistantId === a.assistantId && s.assistantCardSel]} onPress={() => setSelectedAssistantId(a.assistantId)}>
                            <View style={s.avatar}><Text style={s.avatarText}>{(a.name ?? '?')[0].toUpperCase()}</Text></View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.assistantName}>{a.name}</Text>
                              <Text style={s.assistantIdText}>{a.assistantId}</Text>
                            </View>
                            {selectedAssistantId === a.assistantId && <Text style={s.checkIcon}>✓</Text>}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {submitError ? <View style={s.errorBox}><Text style={s.errorText}>\u26a0 {submitError}</Text></View> : null}

                    <TouchableOpacity style={[s.btn, (!selectedAssistantId || submitting) && s.btnOff]} onPress={submitRegistration} disabled={!selectedAssistantId || submitting}>
                      {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Start Session</Text>}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Ready
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'ready') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={s.root} edges={['top', 'bottom']}>
          <StatusBar barStyle="light-content" />
          <PeerStatusBar connected={peerConnected} rtt={peerRtt} reconnecting={peerReconnecting} />

          <View style={s.centeredCard}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🥽</Text>
            <Text style={s.readyTitle}>Session Ready</Text>
            {patientName ? <Text style={s.readyPatient}>Patient: {patientName}</Text> : null}

            <View style={s.roomBadge}>
              <Text style={s.roomLabel}>ROOM</Text>
              <Text style={s.roomCodeText}>{roomCode}</Text>
            </View>

            <Text style={s.readyHint}>
              Ask the patient to put on the VR headset, then press Begin Test.
            </Text>

            <TouchableOpacity style={s.bigBtn} onPress={startTest} activeOpacity={0.85}>
              <Text style={s.bigBtnText}>\u25b6  Begin Test on VR Device</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.ghostBtn} onPress={() => setView('registration')}>
              <Text style={s.ghostBtnText}>\u2190 Back to Registration</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Monitoring
  // ═══════════════════════════════════════════════════════════════════════════
  const {
    phase, instruction, optotype, nearOptotype,
    showLeft, showRight,
    colorShowLeft, colorShowRight,
    nearShowLeft, nearShowRight,
    astigShowLeft, astigShowRight,
    plateIndex, isLensCheck, lensCheckEye, isComplete,
  } = vrState;

  let leftActive, rightActive;
  if (phase === 'color') {
    leftActive = colorShowLeft; rightActive = colorShowRight;
  } else if (phase === 'near') {
    leftActive = nearShowLeft; rightActive = nearShowRight;
  } else if (phase === 'astigmatism') {
    leftActive = astigShowLeft; rightActive = astigShowRight;
  } else {
    leftActive = showLeft; rightActive = showRight;
  }

  const plateDots =
    phase === 'color'
      ? generatePlateDots(getPlate(plateIndex ?? 0))
      : [];

  // Reusable EyePanel props — identical for both eyes except side + active
  const eyePanelProps = {
    panelWidth: EYE_W,
    panelHeight: EYE_H,
    phase,
    instruction,
    patientName,
    optotype,
    plateDots,
    plateIndex,
    totalPlates: TOTAL_PLATES,
    showFeedback: false,
    feedbackSeen: false,
    parallax: 0,
    nearOptotype,
    isLensCheck,
    lensCheckEye,
    contentTranslateX: 0,
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0f" />
        <PeerStatusBar connected={peerConnected} rtt={peerRtt} reconnecting={peerReconnecting} />

        <ScrollView contentContainerStyle={s.monitorScroll} showsVerticalScrollIndicator={false}>

          {/* ── Header ──────────────────────────────────────────────── */}
          <View style={s.monitorHeader}>
            <View>
              <Text style={s.monitorLabel}>Patient</Text>
              <Text style={s.monitorValue}>{patientName}</Text>
            </View>
            <View>
              <Text style={s.monitorLabel}>Room</Text>
              <Text style={[s.monitorValue, s.mono]}>{roomCode}</Text>
            </View>
            <View style={[s.phasePill, { backgroundColor: PHASE_COLORS[phase] ?? '#333' }]}>
              <Text style={s.phaseText}>{phase.toUpperCase()}</Text>
            </View>
          </View>

          {/* ── Instruction ─────────────────────────────────────────── */}
          <View style={s.instructionBox}>
            <Text style={s.instructionLabel}>VR Instruction</Text>
            <Text style={s.instructionText}>{instruction}</Text>
          </View>

          {/* ── Eye Panel Preview ───────────────────────────────────── */}
          {/*
           * Double-wrapped overflow:hidden on each panel:
           *   Outer View  — forces Android to clip absolutely positioned
           *                 children (vignette, barrel overlay)
           *   Inner View  — eyePanelWrapper — clips borderRadius corners
           *
           * EYE_W / EYE_H are computed from screen width so both eyes
           * always fit side-by-side with no horizontal scroll needed.
           */}
          <View style={s.eyePreviewRow}>

            {/* ── LEFT EYE ── */}
            <View style={s.eyePreviewCard}>
              <Text style={s.eyePreviewLabel}>L</Text>
              {/* Outer clip — fixes Android vignette bleed */}
              <View style={{ width: EYE_W, height: EYE_H, overflow: 'hidden', borderRadius: 6 }}>
                {/* Inner clip — rounds corners */}
                <View style={[s.eyePanelWrapper, { width: EYE_W, height: EYE_H }]}>
                  <EyePanel {...eyePanelProps} side="left" active={leftActive} />
                </View>
              </View>
            </View>

            {/* ── Divider ── */}
            <View style={[s.eyeCentreDivider, { height: EYE_H + 20 }]} />

            {/* ── RIGHT EYE ── */}
            <View style={s.eyePreviewCard}>
              <Text style={s.eyePreviewLabel}>R</Text>
              {/* Outer clip — fixes Android vignette bleed */}
              <View style={{ width: EYE_W, height: EYE_H, overflow: 'hidden', borderRadius: 6 }}>
                {/* Inner clip — rounds corners */}
                <View style={[s.eyePanelWrapper, { width: EYE_W, height: EYE_H }]}>
                  <EyePanel {...eyePanelProps} side="right" active={rightActive} />
                </View>
              </View>
            </View>

          </View>

          {/* ── Phase detail row ────────────────────────────────────── */}
          {phase === 'acuity' && optotype && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Letter:</Text>
              <Text style={s.infoVal}>{optotype.letter}</Text>
              {optotype.rotation != null && (
                <><Text style={s.infoLabel}>Rotation:</Text><Text style={s.infoVal}>{optotype.rotation}°</Text></>
              )}
              {optotype.acuityLabel && (
                <><Text style={s.infoLabel}>Acuity:</Text><Text style={s.infoVal}>{optotype.acuityLabel}</Text></>
              )}
            </View>
          )}

          {phase === 'near' && nearOptotype && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Near letter:</Text>
              <Text style={s.infoVal}>{nearOptotype.letter}</Text>
              {nearOptotype.acuityLabel && (
                <><Text style={s.infoLabel}>Acuity:</Text><Text style={s.infoVal}>{nearOptotype.acuityLabel}</Text></>
              )}
            </View>
          )}

          {phase === 'color' && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Ishihara Plate:</Text>
              <Text style={s.infoVal}>#{(plateIndex ?? 0) + 1} / {TOTAL_PLATES}</Text>
            </View>
          )}

          {phase === 'astigmatism' && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Astigmatism clock chart</Text>
            </View>
          )}

          {/* ── Complete banner ─────────────────────────────────────── */}
          {isComplete && (
            <View style={s.completeBox}>
              <Text style={s.completeText}>\u2705  Test Complete</Text>
            </View>
          )}

          {/* ── End Session ─────────────────────────────────────────── */}
          <TouchableOpacity style={[s.btn, s.endBtn]} onPress={endSession}>
            <Text style={s.btnText}>End Session</Text>
          </TouchableOpacity>

        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PeerStatusBar({ connected, rtt, reconnecting }) {
  const color = connected ? '#4caf50' : reconnecting ? '#f9a825' : '#e53935';
  const label = connected
    ? `\uD83D\uDFE2 Local peer connected${rtt != null ? `  \u00b7  ${rtt}ms RTT` : ''}`
    : reconnecting ? '\uD83D\uDFE1 Reconnecting to VR host\u2026'
      : '\uD83D\uDD34 VR host disconnected';
  return (
    <View style={[ps.bar, { borderBottomColor: color + '44' }]}>
      <Text style={[ps.text, { color }]}>{label}</Text>
    </View>
  );
}

function StepDot({ n, active, done, label }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: active ? 1 : done ? 0.7 : 0.4 }}>
      <View style={[s.stepNum, active && s.stepNumActive, done && s.stepNumDone]}>
        <Text style={s.stepNumText}>{done ? '✓' : n}</Text>
      </View>
      <Text style={[s.stepLabel, active && s.stepLabelActive]}>{label}</Text>
    </View>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType, maxLength, flex }) {
  return (
    <View style={[s.field, flex && { flex }]}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#444"
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCorrect={false}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ps = StyleSheet.create({
  bar: { paddingVertical: 6, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#333', backgroundColor: 'rgba(0,0,0,0.3)' },
  text: { fontSize: 11, fontWeight: '500' },
});

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080820' },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 32, paddingHorizontal: 20 },
  monitorScroll: { padding: 16, paddingBottom: 40 },

  centeredCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  connectingTitle: { color: '#c0c0e0', fontSize: 18, fontWeight: '500', textAlign: 'center' },
  connectingHint: { color: '#555', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  card: { width: '100%', maxWidth: 480, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(124,124,240,0.18)', borderRadius: 20, overflow: 'hidden' },
  cardHeader: { alignItems: 'center', paddingTop: 28, paddingBottom: 20, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: 'rgba(124,124,240,0.12)', backgroundColor: 'rgba(91,91,214,0.04)', gap: 5 },
  cardEyebrow: { fontSize: 9, fontWeight: '600', letterSpacing: 2, color: '#7c7cf0', textTransform: 'uppercase' },
  cardTitle: { fontSize: 20, fontWeight: '300', color: '#e8e8f0' },

  formBody: { padding: 24, gap: 16 },

  stepIndicator: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: '#333', alignItems: 'center', justifyContent: 'center' },
  stepNumActive: { backgroundColor: '#5b5bd6', borderColor: '#5b5bd6' },
  stepNumDone: { backgroundColor: 'rgba(91,91,214,0.3)', borderColor: '#5b5bd6' },
  stepNumText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  stepLabel: { color: '#666', fontSize: 11 },
  stepLabelActive: { color: '#e0e0f0' },
  stepLine: { width: 28, height: 1, backgroundColor: 'rgba(124,124,240,0.2)', marginHorizontal: 6 },

  field: { gap: 7 },
  label: { color: '#aaa', fontSize: 12, fontWeight: '500', letterSpacing: 0.4 },
  input: { backgroundColor: '#0d0d1a', borderWidth: 1, borderColor: '#2a2a40', borderRadius: 10, color: '#e8e8f0', fontSize: 14, paddingVertical: 11, paddingHorizontal: 14 },
  row: { flexDirection: 'row', gap: 12 },

  genderRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  genderBtn: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a40', backgroundColor: '#0d0d1a' },
  genderBtnSel: { borderColor: '#5b5bd6', backgroundColor: 'rgba(91,91,214,0.15)' },
  genderText: { color: '#666', fontSize: 12 },
  genderTextSel: { color: '#a0a0f0', fontWeight: '600' },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#3a3a5a', backgroundColor: '#0d0d1a', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#5b5bd6', borderColor: '#5b5bd6' },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  checkLabel: { flex: 1, color: '#aaa', fontSize: 13, lineHeight: 18 },

  allergyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 100, borderWidth: 1, borderColor: '#2a2a40', backgroundColor: '#0d0d1a' },
  chipSel: { borderColor: '#5b5bd6', backgroundColor: 'rgba(91,91,214,0.15)' },
  chipText: { color: '#555', fontSize: 12 },
  chipTextSel: { color: '#a0a0f0', fontWeight: '600' },

  btn: { backgroundColor: '#5b5bd6', paddingVertical: 13, borderRadius: 100, alignItems: 'center', marginTop: 4, shadowColor: '#5b5bd6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6 },
  btnOff: { opacity: 0.35, shadowOpacity: 0 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600', letterSpacing: 0.4 },
  endBtn: { backgroundColor: '#c62828', shadowColor: '#c62828', marginTop: 20 },

  bigBtn: { width: '100%', paddingVertical: 16, backgroundColor: '#5b5bd6', borderRadius: 100, alignItems: 'center', shadowColor: '#5b5bd6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },
  bigBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  ghostBtn: { paddingVertical: 8 },
  ghostBtnText: { color: '#5b5bd6', fontSize: 13, textDecorationLine: 'underline' },

  back: { alignSelf: 'flex-start' },
  backText: { color: '#7c7cf0', fontSize: 13 },
  sectionHeading: { color: '#c0c0e0', fontSize: 14, fontWeight: '600' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 },
  loadingText: { color: '#666', fontSize: 13 },
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  emptyText: { color: '#666', fontSize: 13 },
  retryBtn: { paddingVertical: 7, paddingHorizontal: 18, borderRadius: 100, borderWidth: 1, borderColor: '#5b5bd6' },
  retryText: { color: '#7c7cf0', fontSize: 13 },

  assistantCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#1e1e30', backgroundColor: '#0d0d1a' },
  assistantCardSel: { borderColor: '#5b5bd6', backgroundColor: 'rgba(91,91,214,0.08)' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(91,91,214,0.2)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#a0a0f0', fontSize: 16, fontWeight: '700' },
  assistantName: { color: '#e0e0f0', fontSize: 13, fontWeight: '600' },
  assistantIdText: { color: '#555', fontSize: 11 },
  checkIcon: { color: '#5b5bd6', fontSize: 18, fontWeight: '700' },

  errorBox: { backgroundColor: 'rgba(204,51,51,0.1)', borderWidth: 1, borderColor: 'rgba(204,51,51,0.3)', borderRadius: 10, padding: 12 },
  errorText: { color: '#ff6666', fontSize: 12 },

  readyTitle: { fontSize: 24, fontWeight: '300', color: '#e8e8f0' },
  readyPatient: { fontSize: 13, color: '#a0a0c0', fontStyle: 'italic' },
  readyHint: { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  roomBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: 'rgba(91,91,214,0.1)', borderWidth: 1, borderColor: 'rgba(91,91,214,0.2)', borderRadius: 100 },
  roomLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: '#5b5bd6', textTransform: 'uppercase' },
  roomCodeText: { fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontWeight: '700', color: '#c0c0e0', letterSpacing: 1.3 },

  // ── Monitoring ───────────────────────────────────────────────────────────
  monitorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(124,124,240,0.12)', borderRadius: 12, marginBottom: 12 },
  monitorLabel: { color: '#555', fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  monitorValue: { color: '#c0c0e0', fontSize: 14, fontWeight: '600' },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  phasePill: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 100 },
  phaseText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  instructionBox: { backgroundColor: 'rgba(91,91,214,0.06)', borderWidth: 1, borderColor: 'rgba(91,91,214,0.15)', borderRadius: 12, padding: 14, marginBottom: 12, gap: 4 },
  instructionLabel: { color: '#5b5bd6', fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  instructionText: { color: '#c0c0e0', fontSize: 15, lineHeight: 22 },

  // ── Eye preview — NO duplicate keys ─────────────────────────────────────
  eyePreviewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginBottom: 12,
    // no paddingHorizontal — panels already fill (W - 38) / 2 each
  },
  eyePreviewCard: { alignItems: 'center', gap: 4 },
  eyePreviewLabel: {
    color: 'rgba(180,180,180,0.6)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  // Inner clip only — outer clip is inlined to avoid StyleSheet duplicate key issue
  eyePanelWrapper: {
    borderRadius: 6,
    overflow: 'hidden',
  },
  // Single definition — height injected inline as { height: EYE_H + 20 }
  eyeCentreDivider: {
    width: 2,
    backgroundColor: '#1a1a1a',
    marginTop: 22,
  },

  // ── Info rows ────────────────────────────────────────────────────────────
  infoRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 12, marginBottom: 8 },
  infoLabel: { color: '#555', fontSize: 11, fontWeight: '600' },
  infoVal: { color: '#c0c0e0', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontWeight: '700' },

  completeBox: { backgroundColor: 'rgba(76,175,80,0.1)', borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 8 },
  completeText: { color: '#81c784', fontSize: 16, fontWeight: '600' },
});