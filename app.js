/* =====================================================================
   Wasla Live — PeerJS + WebRTC chat / audio / video
   No database. No login. Messages live only in this tab's memory.
   ===================================================================== */

(() => {
  'use strict';

  // ── Config ──────────────────────────────────────────────
  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
      /* To add TURN (required on strict networks), uncomment and fill:
      ,{ urls:'turn:your.turn.host:3478',
         username:'REPLACE_ME', credential:'REPLACE_ME' }
      Never ship production TURN secrets in public frontend code.
      */
    ]
  };
  const MAX_MSG_LEN = 2000;
  const CONNECT_TIMEOUT_MS = 15000;
  const CALL_TIMEOUT_MS = 30000;

  // ── State ───────────────────────────────────────────────
  const state = {
    peer: null,
    conn: null,               // active DataConnection
    myId: null,
    remoteId: null,
    connected: false,
    currentCall: null,        // MediaConnection
    currentCallType: null,    // 'audio' | 'video'
    incomingCall: null,
    localStream: null,
    remoteStream: null,
    pendingOutgoing: false,
    connectTimer: null,
    callTimer: null,
    callStartTs: 0,
    micEnabled: true,
    camEnabled: true,
    lang: 'ar'
  };

  // ── DOM ─────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const el = {
    connBadge: $('connBadge'), myIdInput: $('myIdInput'),
    copyIdBtn: $('copyIdBtn'), copyLinkBtn: $('copyLinkBtn'),
    remoteIdInput: $('remoteIdInput'),
    connectBtn: $('connectBtn'), disconnectBtn: $('disconnectBtn'),
    statusMsg: $('statusMsg'),
    audioCallBtn: $('audioCallBtn'), videoCallBtn: $('videoCallBtn'),
    messages: $('messages'), emptyState: $('emptyState'),
    composer: $('composer'), msgInput: $('msgInput'), sendBtn: $('sendBtn'),
    incomingModal: $('incomingModal'), incomingFrom: $('incomingFrom'),
    acceptCallBtn: $('acceptCallBtn'), rejectCallBtn: $('rejectCallBtn'),
    callOverlay: $('callOverlay'),
    remoteVideo: $('remoteVideo'), localVideo: $('localVideo'),
    audioAvatar: $('audioAvatar'),
    muteBtn: $('muteBtn'), camBtn: $('camBtn'),
    endCallBtn: $('endCallBtn'), callTimer: $('callTimer'),
    toastHost: $('toastHost'), langToggle: $('langToggle')
  };

  // ── i18n ────────────────────────────────────────────────
  const T = {
    ar: {
      myId:'معرّفك', copy:'نسخ', copyLink:'نسخ رابط الدعوة',
      idHint:'شارك هذا المعرّف أو الرابط مع الطرف الآخر. ينتهي المعرّف عند إغلاق التبويب.',
      connectTo:'الاتصال بشخص', connect:'اتصال', disconnect:'قطع الاتصال',
      callPanel:'المكالمات', audioCall:'🎙️ مكالمة صوتية', videoCall:'📹 مكالمة فيديو',
      emptyChat:'ابدأ بالاتصال بشخص لبدء المحادثة',
      typeMsg:'اكتب رسالة…', send:'إرسال',
      accept:'قبول', reject:'رفض',
      mute:'كتم', camOff:'إيقاف الكاميرا', endCall:'إنهاء',
      idle:'غير متصل', ready:'جاهز', connecting:'جارٍ الاتصال…',
      connected:'متصل', disconnected:'انقطع الاتصال', failed:'فشل الاتصال',
      copied:'تم النسخ', copyFail:'فشل النسخ — انسخ يدويًا',
      invalidId:'معرّف غير صالح', selfConnect:'لا يمكنك الاتصال بنفسك',
      peerUnavailable:'الطرف الآخر غير متاح',
      incomingCall:'مكالمة واردة', callRejected:'تم رفض المكالمة',
      callTimeout:'لم يتم الرد', callEnded:'انتهت المكالمة',
      micDenied:'تم رفض إذن الميكروفون', camDenied:'تم رفض إذن الكاميرا',
      peerErr:'تعذّر الاتصال بخادم PeerJS', alreadyConnected:'أنت متصل بالفعل'
    },
    en: {
      myId:'Your ID', copy:'Copy', copyLink:'Copy invite link',
      idHint:'Share this ID or link with the other person. It expires when you close the tab.',
      connectTo:'Connect to someone', connect:'Connect', disconnect:'Disconnect',
      callPanel:'Calls', audioCall:'🎙️ Audio call', videoCall:'📹 Video call',
      emptyChat:'Connect to someone to start chatting',
      typeMsg:'Type a message…', send:'Send',
      accept:'Accept', reject:'Reject',
      mute:'Mute', camOff:'Camera off', endCall:'End',
      idle:'Offline', ready:'Ready', connecting:'Connecting…',
      connected:'Connected', disconnected:'Disconnected', failed:'Connection failed',
      copied:'Copied', copyFail:'Copy failed — copy manually',
      invalidId:'Invalid ID', selfConnect:"You can't connect to yourself",
      peerUnavailable:'Peer unavailable',
      incomingCall:'Incoming call', callRejected:'Call rejected',
      callTimeout:'No answer', callEnded:'Call ended',
      micDenied:'Microphone permission denied', camDenied:'Camera permission denied',
      peerErr:'Could not reach PeerJS server', alreadyConnected:'Already connected'
    }
  };
  const t = k => T[state.lang][k] || k;

  function applyLang(){
    document.documentElement.lang = state.lang;
    document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(n => n.textContent = t(n.dataset.i18n));
    document.querySelectorAll('[data-i18n-placeholder]').forEach(n => n.placeholder = t(n.dataset.i18nPlaceholder));
    el.langToggle.textContent = state.lang === 'ar' ? 'EN' : 'AR';
    setStatus(state.connected ? t('connected') : t('idle'), state.connected ? 'ok' : 'info');
  }
  el.langToggle.addEventListener('click', () => {
    state.lang = state.lang === 'ar' ? 'en' : 'ar';
    applyLang();
  });

  // ── UI helpers ──────────────────────────────────────────
  function toast(msg, kind='info'){
    const d = document.createElement('div');
    d.className = 'toast' + (kind === 'ok' ? ' toast--ok' : kind === 'err' ? ' toast--err' : '');
    d.textContent = msg;
    el.toastHost.appendChild(d);
    setTimeout(() => d.remove(), 3800);
  }
  function setStatus(msg, kind='info'){
    el.statusMsg.textContent = msg;
    el.statusMsg.className = 'status status--' + kind;
  }
  function setBadge(msg, kind='idle'){
    el.connBadge.textContent = msg;
    el.connBadge.className = 'badge badge--' + kind;
  }
  function fmtTime(ts){
    const d = new Date(ts);
    return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  }

  // ── Message rendering (safe: textContent only) ──────────
  function appendMessage(text, mine){
    // Guard: enforce max length & strip anything weird
    const safe = String(text).slice(0, MAX_MSG_LEN);
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (mine ? 'msg--me' : 'msg--them');
    const body = document.createElement('div');
    body.textContent = safe;                    // textContent → no HTML injection
    const time = document.createElement('span');
    time.className = 'msg__time';
    time.textContent = fmtTime(Date.now());
    wrap.append(body, time);
    el.messages.appendChild(wrap);
    el.messages.scrollTop = el.messages.scrollHeight;
    el.emptyState.classList.add('hidden');
  }
  function appendSystem(text){
    const d = document.createElement('div');
    d.className = 'msg msg--system';
    d.textContent = text;
    el.messages.appendChild(d);
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  // ── Clipboard with fallback ─────────────────────────────
  async function copyToClipboard(text){
    try {
      if (navigator.clipboard && window.isSecureContext){
        await navigator.clipboard.writeText(text);
        return true;
      }
      throw new Error('no clipboard API');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch { return false; }
    }
  }

  // ── PeerJS init ─────────────────────────────────────────
  function initPeer(){
    if (typeof Peer === 'undefined'){
      setBadge('PeerJS load failed', 'err');
      setStatus(t('peerErr'), 'err');
      return;
    }
    const peer = new Peer({ config: ICE_CONFIG, debug: 1 });
    state.peer = peer;

    peer.on('open', id => {
      state.myId = id;
      el.myIdInput.value = id;
      setBadge(t('ready'), 'on');
      setStatus(t('idHint'), 'info');
      // Auto-join via ?to=<id>
      const params = new URLSearchParams(location.search);
      const to = params.get('to');
      if (to && to !== id){
        el.remoteIdInput.value = to;
        setTimeout(() => startConnection(to), 200);
      }
    });

    peer.on('connection', conn => {
      if (state.conn && state.conn.open){
        // Reject duplicates politely
        conn.on('open', () => conn.close());
        return;
      }
      setupConnection(conn);
    });

    peer.on('call', call => {
      // If already in a call, reject
      if (state.currentCall){
        call.close();
        return;
      }
      state.incomingCall = call;
      el.incomingFrom.textContent = 'From: ' + call.peer;
      el.incomingModal.classList.remove('hidden');
    });

    peer.on('error', err => {
      console.warn('Peer error:', err);
      if (err.type === 'unavailable-id'){
        // Regenerate ID
        peer.destroy();
        initPeer();
        return;
      }
      if (err.type === 'peer-unavailable'){
        setStatus(t('peerUnavailable'), 'err');
        toast(t('peerUnavailable'), 'err');
        state.pendingOutgoing = false;
        clearTimeout(state.connectTimer);
      } else if (err.type === 'network' || err.type === 'server-error'){
        setBadge(t('failed'), 'err');
      }
    });

    peer.on('disconnected', () => {
      setBadge(t('disconnected'), 'err');
      try { peer.reconnect(); } catch {}
    });
  }

  // ── Connection management ───────────────────────────────
  function startConnection(remoteId){
    if (!state.peer || !state.myId) return toast(t('peerErr'), 'err');
    if (remoteId === state.myId) return toast(t('selfConnect'), 'err');
    if (!remoteId) return toast(t('invalidId'), 'err');
    if (state.connected) return toast(t('alreadyConnected'), 'err');

    state.pendingOutgoing = true;
    setStatus(t('connecting'), 'info');
    setBadge(t('connecting'), 'idle');

    const conn = state.peer.connect(remoteId, { reliable: true });
    setupConnection(conn, true);

    clearTimeout(state.connectTimer);
    state.connectTimer = setTimeout(() => {
      if (!state.connected && state.pendingOutgoing){
        setStatus(t('peerUnavailable'), 'err');
        setBadge(t('failed'), 'err');
        try { conn.close(); } catch {}
        state.pendingOutgoing = false;
      }
    }, CONNECT_TIMEOUT_MS);
  }

  function setupConnection(conn, outgoing=false){
    state.conn = conn;
    state.remoteId = conn.peer;

    conn.on('open', () => {
      clearTimeout(state.connectTimer);
      state.pendingOutgoing = false;
      state.connected = true;
      setBadge(t('connected'), 'on');
      setStatus(t('connected') + ' — ' + conn.peer, 'ok');
      appendSystem('✔ ' + t('connected'));
      el.connectBtn.disabled = true;
      el.disconnectBtn.disabled = false;
      el.remoteIdInput.disabled = true;
      el.msgInput.disabled = false;
      el.sendBtn.disabled = false;
      el.audioCallBtn.disabled = false;
      el.videoCallBtn.disabled = false;
      el.msgInput.focus();
    });

    conn.on('data', data => {
      try {
        if (!data || typeof data !== 'object') return;
        if (data.type === 'chat' && typeof data.text === 'string'){
          appendMessage(data.text.slice(0, MAX_MSG_LEN), false);
        } else if (data.type === 'bye'){
          appendSystem('✖ ' + t('disconnected'));
          cleanupConnection();
        }
      } catch (e){
        console.warn('Malformed peer message ignored:', e);
      }
    });

    conn.on('close', () => {
      if (state.connected){
        appendSystem('✖ ' + t('disconnected'));
      }
      cleanupConnection();
    });

    conn.on('error', err => {
      console.warn('Conn error:', err);
      setStatus(String(err), 'err');
    });
  }

  function cleanupConnection(){
    state.connected = false;
    state.conn = null;
    state.remoteId = null;
    setBadge(t('idle'), 'idle');
    setStatus(t('idle'), 'info');
    el.connectBtn.disabled = false;
    el.disconnectBtn.disabled = true;
    el.remoteIdInput.disabled = false;
    el.msgInput.disabled = true;
    el.sendBtn.disabled = true;
    el.audioCallBtn.disabled = true;
    el.videoCallBtn.disabled = true;
  }

  function disconnect(){
    if (state.conn){
      try { state.conn.send({ type:'bye' }); } catch {}
      try { state.conn.close(); } catch {}
    }
    cleanupConnection();
  }

  // ── Chat ────────────────────────────────────────────────
  el.composer.addEventListener('submit', e => {
    e.preventDefault();
    const text = el.msgInput.value.trim();
    if (!text || !state.conn || !state.conn.open) return;
    const clipped = text.slice(0, MAX_MSG_LEN);
    try {
      state.conn.send({ type:'chat', text: clipped });
      appendMessage(clipped, true);
      el.msgInput.value = '';
    } catch (err){
      toast('Send failed', 'err');
    }
  });

  // ── Calls ───────────────────────────────────────────────
  async function getMedia(video){
    const constraints = video
      ? { audio: true, video: { width:{ideal:1280}, height:{ideal:720} } }
      : { audio: true, video: false };
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err){
      if (err && err.name === 'NotAllowedError'){
        toast(video ? t('camDenied') : t('micDenied'), 'err');
      } else {
        toast('Media error: ' + err.message, 'err');
      }
      return null;
    }
  }

  async function startCall(video){
    if (!state.conn || !state.conn.open){
      return toast(t('peerUnavailable'), 'err');
    }
    if (state.currentCall) return;

    const stream = await getMedia(video);
    if (!stream) return;

    state.localStream = stream;
    state.currentCallType = video ? 'video' : 'audio';
    state.micEnabled = true;
    state.camEnabled = video;

    const call = state.peer.call(state.remoteId, stream, { metadata:{ type: state.currentCallType } });
    if (!call){
      releaseMedia();
      return toast('Call failed', 'err');
    }
    bindCall(call, true);
  }

  function bindCall(call, outgoing){
    state.currentCall = call;

    call.on('stream', remoteStream => {
      state.remoteStream = remoteStream;
      el.remoteVideo.srcObject = remoteStream;
      if (state.currentCallType === 'video'){
        el.remoteVideo.classList.remove('hidden');
        el.audioAvatar.classList.add('hidden');
        el.camBtn.classList.remove('hidden');
      } else {
        el.remoteVideo.classList.add('hidden');
        el.audioAvatar.classList.remove('hidden');
      }
      showCallUI();
    });

    call.on('close', () => endCall(false));
    call.on('error', err => {
      console.warn('Call error:', err);
      endCall(false);
    });

    // Outgoing: show overlay immediately with local preview
    if (outgoing){
      if (state.currentCallType === 'video'){
        el.localVideo.srcObject = state.localStream;
        el.localVideo.classList.remove('hidden');
      } else {
        el.localVideo.classList.add('hidden');
      }
      showCallUI();
    }
  }

  function showCallUI(){
    el.callOverlay.classList.remove('hidden');
    el.callStartTs = Date.now();
    clearInterval(state.callTimer);
    state.callTimer = setInterval(() => {
      const s = Math.floor((Date.now() - state.callStartTs)/1000);
      el.callTimer.textContent =
        String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
    }, 1000);
  }

  function endCall(sendSignal=true){
    try { state.currentCall && state.currentCall.close(); } catch {}
    state.currentCall = null;
    state.currentCallType = null;
    releaseMedia();
    el.callOverlay.classList.add('hidden');
    el.remoteVideo.srcObject = null;
    el.localVideo.srcObject = null;
    el.remoteVideo.classList.remove('hidden');
    el.audioAvatar.classList.add('hidden');
    el.camBtn.classList.add('hidden');
    clearInterval(state.callTimer);
    el.callTimer.textContent = '00:00';
    state.micEnabled = true;
    state.camEnabled = true;
    if (sendSignal) appendSystem('📞 ' + t('callEnded'));
  }

  function releaseMedia(){
    if (state.localStream){
      state.localStream.getTracks().forEach(tr => tr.stop());
      state.localStream = null;
    }
    if (state.remoteStream){
      state.remoteStream.getTracks().forEach(tr => tr.stop());
      state.remoteStream = null;
    }
  }

  // ── Incoming call handling ─────────────────────────────
  el.acceptCallBtn.addEventListener('click', async () => {
    const call = state.incomingCall;
    el.incomingModal.classList.add('hidden');
    state.incomingCall = null;
    if (!call) return;

    const meta = call.metadata || {};
    const video = meta.type === 'video';
    state.currentCallType = video ? 'video' : 'audio';

    const stream = await getMedia(video);
    if (!stream){
      try { call.close(); } catch {}
      return;
    }
    state.localStream = stream;
    state.micEnabled = true;
    state.camEnabled = video;

    call.answer(stream);
    bindCall(call, false);
  });

  el.rejectCallBtn.addEventListener('click', () => {
    const call = state.incomingCall;
    el.incomingModal.classList.add('hidden');
    state.incomingCall = null;
    if (call){ try { call.close(); } catch {} }
    if (state.conn && state.conn.open){
      try { state.conn.send({ type:'call-rejected' }); } catch {}
    }
    appendSystem('📞 ' + t('callRejected'));
  });

  // ── Call controls ──────────────────────────────────────
  el.muteBtn.addEventListener('click', () => {
    if (!state.localStream) return;
    state.micEnabled = !state.micEnabled;
    state.localStream.getAudioTracks().forEach(tr => tr.enabled = state.micEnabled);
    el.muteBtn.innerHTML = (state.micEnabled ? '🔇 ' : '🎙️ ') + t('mute');
  });

  el.camBtn.addEventListener('click', () => {
    if (!state.localStream) return;
    state.camEnabled = !state.camEnabled;
    state.localStream.getVideoTracks().forEach(tr => tr.enabled = state.camEnabled);
    el.camBtn.innerHTML = (state.camEnabled ? '📷 ' : '🚫 ') + t('camOff');
  });

  el.endCallBtn.addEventListener('click', () => endCall(true));

  // ── Buttons ─────────────────────────────────────────────
  el.copyIdBtn.addEventListener('click', async () => {
    if (!state.myId) return;
    const ok = await copyToClipboard(state.myId);
    toast(ok ? t('copied') : t('copyFail'), ok ? 'ok' : 'err');
  });

  el.copyLinkBtn.addEventListener('click', async () => {
    if (!state.myId) return;
    const link = location.origin + location.pathname + '?to=' + encodeURIComponent(state.myId);
    const ok = await copyToClipboard(link);
    toast(ok ? t('copied') : link, ok ? 'ok' : 'err');
  });

  el.connectBtn.addEventListener('click', () => {
    const id = el.remoteIdInput.value.trim();
    if (!id) return toast(t('invalidId'), 'err');
    startConnection(id);
  });

  el.disconnectBtn.addEventListener('click', disconnect);
  el.audioCallBtn.addEventListener('click', () => startCall(false));
  el.videoCallBtn.addEventListener('click', () => startCall(true));

  // ── Boot ───────────────────────────────────────────────
  applyLang();
  initPeer();

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    try { state.conn && state.conn.send({ type:'bye' }); } catch {}
    releaseMedia();
    try { state.peer && state.peer.destroy(); } catch {}
  });

})();