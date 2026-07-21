/* game.js — the live game view: game socket, board interaction, chat, voice. */
'use strict';

const R = () => globalThis.chessRules;

/** Rebuild a full rules state (castling/ep included) by replaying the view's moves. */
function replayMoves(moves) {
  const g = R().newGameState();
  for (const m of moves || []) {
    R().makeMove(g, { from: m.from, to: m.to, promo: m.promo || undefined }, m.at || 0);
  }
  return g;
}

/** Normalize a chat message from whichever field names the platform uses. */
function normMsg(m) {
  if (!m || typeof m !== 'object') return null;
  return {
    id: m.id || m.messageId || null,
    senderId: m.senderId || m.userId || m.authorId || m.from || null,
    content: m.content != null ? m.content : (m.text != null ? m.text : m.body),
    at: m.sentAt || m.createdAt || m.at || Date.now(),
    conversationId: m.conversationId || m.convId || null,
  };
}

class GameController {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.destroyed = false;
    this.ws = null;
    this.wsAttempts = 0;
    this.view = null;         // last server state view
    this.g = null;            // local rules state rebuilt from view.moves
    this.myColor = null;
    this.players = {};        // userId -> username
    this.oppId = null;
    this.selected = null;
    this.cands = [];
    this.finishedShown = false;
    this.chat = { convId: null, ws: null, pollTimer: null, seen: new Set(), msgs: [], wsOk: false };
    this.voice = new VoiceController(this);
    this.unTick = null;
    this._reconnectTimer = null;
  }

  async start() {
    $('game-over').hidden = true;
    $('draw-banner').hidden = true;
    $('promo-picker').hidden = true;
    $('conn-state').textContent = 'connecting…';
    UI.clear($('movesheet'));
    UI.clear($('chat-msgs'));
    $('chat-msgs').appendChild(UI.el('p', 'empty', 'Say hello.'));
    UI.renderBoard($('game-board'), R().START_BOARD, {});
    this.unTick = UI.onTick(() => this.tickClock());

    try {
      const s = await Net.api(Net.gamePath(`/sessions/${this.sessionId}`));
      for (const p of s.players || []) this.players[p.userId] = p.username;
      this.oppId = (s.players || []).map(p => p.userId).find(id => id !== Net.userId) || null;
      this.chat.convId = s.chatConversationId || null;
    } catch (e) {
      if (e.status !== 401) UI.toast(e.message, 'err');
    }
    if (this.destroyed) return;
    this.connect();
    this.initChat();
  }

  // ------------------------------------------------------------- game socket
  connect() {
    if (this.destroyed) return;
    const url = Net.wsUrl('/ws/v1/games', { sessionId: this.sessionId, access_token: Net.token });
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.wsAttempts = 0;
      $('conn-state').textContent = '';
      this.sendCmd({ type: 'sync' });
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      this.onFrame(msg);
    };
    ws.onclose = () => { if (this.ws === ws) this.scheduleReconnect(); };
    ws.onerror = () => { /* close will follow */ };
  }

  scheduleReconnect() {
    if (this.destroyed) return;
    this.ws = null;
    const delay = Math.min(30000, 1000 * Math.pow(2, this.wsAttempts++));
    $('conn-state').textContent = 'reconnecting…';
    this._reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  sendCmd(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'cmd', data }));
    } else {
      UI.toast('Not connected — retrying…', 'err');
    }
  }

  onFrame(msg) {
    if (msg.type === 'error') { UI.toast(msg.error || 'Command rejected.', 'err'); return; }
    if (msg.type === 'presence') {
      if (msg.userId === this.oppId && !(this.view && this.view.ai)) {
        $('g-opp-dot').classList.toggle('on', !!msg.online);
        $('g-opp-dot').title = msg.online ? 'online' : 'offline';
      }
      return;
    }
    if (msg.type !== 'game' || !msg.data) return;
    const d = msg.data;
    switch (d.type) {
      case 'state':
        this.setView(d);
        break;
      case 'moved':
        this.setView(d.view);
        break;
      case 'draw-offered':
        if (this.view) { this.view.drawOfferBy = d.by; this.render(); }
        if (d.by !== this.myColor) UI.toast(this.nameOf(this.oppId) + ' offers a draw.');
        break;
      case 'draw-declined':
        if (this.view) { this.view.drawOfferBy = null; this.render(); }
        if (d.by !== this.myColor) UI.toast('Draw declined.');
        break;
      case 'game-over':
        this.setView({ ...d.view, result: d.result });
        break;
    }
  }

  // ------------------------------------------------------------- state/render
  setView(v) {
    this.view = v;
    this.g = replayMoves(v.moves);
    this.myColor = v.white === Net.userId ? 'white' : (v.black === Net.userId ? 'black' : null);
    if (!this.oppId) this.oppId = this.myColor === 'white' ? v.black : v.white;
    this.selected = null;
    this.cands = [];
    this.render();
    if (v.status === 'finished' && v.result && !this.finishedShown) {
      this.finishedShown = true;
      this.showGameOver(v.result);
    }
  }

  nameOf(id) { return this.players[id] || (id ? String(id).slice(0, 8) : '—'); }

  myTurn() {
    return this.view && this.view.status === 'active' && this.view.turn === this.myColor;
  }

  render() {
    const v = this.view;
    if (!v) return;
    const flipped = this.myColor === 'black';
    const last = v.moves && v.moves.length
      ? { from: R().parseSquare(v.moves[v.moves.length - 1].from), to: R().parseSquare(v.moves[v.moves.length - 1].to) }
      : null;
    const check = v.status === 'active' && R().inCheck(v.board, v.turn);
    const dests = this.cands.map(c => ({ to: c.to, cap: v.board[c.to] !== '.' || c.isEp }));
    UI.renderBoard($('game-board'), v.board, {
      flipped,
      lastMove: last,
      selected: this.selected,
      dests,
      checkSquare: check ? UI.kingSquare(v.board, v.turn) : undefined,
      onSquare: (i) => this.clickSquare(i),
    });

    // seats
    const meId = this.myColor === 'black' ? v.black : v.white;
    const myColorName = this.myColor || 'white';
    const oppColorName = myColorName === 'white' ? 'black' : 'white';
    $('g-me-name').textContent = 'You — ' + this.nameOf(meId);
    $('g-me-color').textContent = myColorName;
    $('g-opp-name').textContent = this.nameOf(this.oppId);
    $('g-opp-color').textContent = oppColorName;
    $('g-check').hidden = !(check && v.turn === this.myColor);

    // practice game: the AI is always "online", never talks, never joins voice
    const vsAi = !!v.ai;
    if (vsAi) {
      $('g-opp-dot').classList.add('on');
      $('g-opp-dot').title = 'AI opponent';
      $('chat-input').disabled = true;
      $('chat-input').placeholder = "The House doesn't chat.";
    }
    $('voice-panel').hidden = vsAi;

    UI.renderSheet($('movesheet'), v.moves || []);
    this.renderDrawBanner();

    const over = v.status !== 'active';
    $('btn-resign').disabled = over;
    $('btn-draw').disabled = over || v.drawOfferBy === this.myColor;
    this.tickClock();
  }

  renderDrawBanner() {
    const v = this.view;
    const banner = $('draw-banner');
    if (!v || !v.drawOfferBy || v.status !== 'active') { banner.hidden = true; return; }
    banner.hidden = false;
    const mine = v.drawOfferBy === this.myColor;
    $('draw-text').textContent = mine
      ? 'Draw offered — waiting for ' + this.nameOf(this.oppId)
      : this.nameOf(this.oppId) + ' offers a draw';
    $('draw-accept').hidden = mine;
    $('draw-decline').hidden = mine;
  }

  tickClock() {
    const v = this.view;
    const turnEl = $('g-turn'), clockEl = $('g-clock'), fuse = $('g-fuse');
    if (!v) { turnEl.textContent = '—'; clockEl.textContent = ''; return; }
    if (v.status !== 'active') {
      turnEl.textContent = 'Game over';
      clockEl.textContent = '';
      fuse.style.width = '0%';
      return;
    }
    const left = (v.deadline || 0) - Date.now();
    const urgent = left < 3600000;
    turnEl.textContent = v.turn === this.myColor ? 'Your move' : this.nameOf(this.oppId) + ' to move';
    clockEl.textContent = UI.fmtLeft(left) + ' left';
    clockEl.classList.toggle('urgent', urgent);
    fuse.style.width = Math.max(0, Math.min(100, (left / 86400000) * 100)) + '%';
    fuse.classList.toggle('urgent', urgent);
  }

  // ------------------------------------------------------------- interaction
  clickSquare(i) {
    if (!this.myTurn()) return;
    const v = this.view;
    // a destination of the current selection?
    const matches = this.cands.filter(c => c.to === i);
    if (this.selected != null && matches.length) {
      const from = this.selected;
      if (matches.some(c => c.promo)) {
        this.showPromoPicker((promo) => this.sendMove(from, i, promo));
      } else {
        this.sendMove(from, i, null);
      }
      return;
    }
    // (re)select one of my pieces
    if (v.board[i] !== '.' && R().pieceColor(v.board[i]) === this.myColor && i !== this.selected) {
      this.selected = i;
      this.cands = R().legalMovesFrom(this.g, i);
    } else {
      this.selected = null;
      this.cands = [];
    }
    this.render();
  }

  sendMove(from, to, promo) {
    const cmd = { type: 'move', from: R().algebraic(from), to: R().algebraic(to) };
    if (promo) cmd.promo = promo;
    this.selected = null;
    this.cands = [];
    this.render();
    this.sendCmd(cmd);
  }

  showPromoPicker(pick) {
    const box = $('promo-picker');
    UI.clear(box);
    for (const p of ['q', 'r', 'n', 'b']) {
      const b = UI.el('button', null, UI.GLYPH[p]);
      b.style.color = this.myColor === 'white' ? '#f6ecd8' : '#26190f';
      b.style.textShadow = this.myColor === 'white' ? '0 1px 1px rgba(0,0,0,.85)' : '0 1px 1px rgba(246,236,216,.4)';
      b.title = { q: 'Queen', r: 'Rook', n: 'Knight', b: 'Bishop' }[p];
      b.addEventListener('click', () => { box.hidden = true; pick(p); });
      box.appendChild(b);
    }
    box.hidden = false;
  }

  async resign() {
    if (await UI.confirm('Resign this game?', 'Resign', true)) this.sendCmd({ type: 'resign' });
  }

  async offerDraw() {
    if (await UI.confirm('Offer a draw to ' + this.nameOf(this.oppId) + '?', 'Offer draw')) {
      this.sendCmd({ type: 'offer-draw' });
    }
  }

  // ------------------------------------------------------------- game over
  async showGameOver(result) {
    const iWon = result.kind === this.myColor;
    const drew = result.kind === 'draw';
    $('go-title').textContent = drew ? 'Drawn' : (iWon ? 'You won' : 'You lost');
    const reasons = {
      'checkmate': 'by checkmate', 'stalemate': 'by stalemate',
      'threefold-repetition': 'by threefold repetition', 'fifty-move-rule': 'by the fifty-move rule',
      'insufficient-material': 'insufficient material', 'resignation': 'by resignation',
      'agreement': 'by agreement', 'timeout': 'on time', 'timeout-no-moves': 'no moves were played',
    };
    $('go-reason').textContent = reasons[result.reason] || result.reason || '';
    $('go-elo').textContent = '';
    $('game-over').hidden = false;
    this.tickClock();
    if (this.view && this.view.ai) {
      $('go-elo').textContent = 'Practice game — unrated.';
      return;
    }
    // fresh elo after the platform applies the result
    try {
      const info = await Net.api(Net.gamePath());
      const newElo = info && info.me ? info.me.elo : null;
      if (newElo != null) {
        const old = App.lastElo;
        let deltaTxt = '';
        if (old != null && newElo !== old) {
          const d = newElo - old;
          deltaTxt = ' (' + (d > 0 ? '+' : '') + d + ')';
        }
        $('go-elo').textContent = 'Rating: ' + newElo + deltaTxt;
        App.lastElo = newElo;
        App.updateEloChip(newElo);
      }
    } catch (e) { /* menu will refresh anyway */ }
  }

  // ------------------------------------------------------------- chat
  async initChat() {
    if (!this.chat.convId) return;
    await this.loadChatHistory();
    this.connectChatWs();
  }

  async loadChatHistory() {
    if (!this.chat.convId || this.destroyed) return;
    try {
      const j = await Net.api(`/api/v1/chat/conversations/${this.chat.convId}/messages?page=1&pageSize=50`);
      const arr = Array.isArray(j) ? j : (j && (j.messages || j.items || j.entries)) || [];
      for (const raw of arr) this.addChatMsg(normMsg(raw), false);
      this.renderChat();
    } catch (e) { /* silent; polling may pick it up */ }
  }

  connectChatWs() {
    if (this.destroyed) return;
    let ws;
    try { ws = new WebSocket(Net.wsUrl('/ws/v1/chat', { access_token: Net.token })); }
    catch (e) { this.startChatPolling(); return; }
    this.chat.ws = ws;
    ws.onopen = () => { this.chat.wsOk = true; this.chat.wsFails = 0; this.stopChatPolling(); };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      const t = msg.type || msg.event;
      if (t !== 'new_message' && t !== 'chat.new_message') return;
      const payload = msg.data || msg.message || msg.payload || msg;
      const raw = payload.message || payload;
      const convId = payload.conversationId || (raw && raw.conversationId);
      if (convId && convId !== this.chat.convId) return;
      const m = normMsg(raw);
      if (m && this.addChatMsg(m, true)) this.renderChat();
    };
    ws.onclose = () => {
      if (this.destroyed || this.chat.ws !== ws) return;
      this.chat.ws = null;
      this.startChatPolling();               // fall back while the socket is down
      // Game-scoped tokens are fenced off the chat push socket entirely (it streams all of
      // the user's conversations) — after repeated immediate failures, settle on polling.
      this.chat.wsFails = (this.chat.wsFails || 0) + 1;
      if (this.chat.wsFails <= 2)
        setTimeout(() => { if (!this.destroyed) this.connectChatWs(); }, 8000);
    };
    ws.onerror = () => { /* close follows */ };
  }

  startChatPolling() {
    if (this.chat.pollTimer || this.destroyed) return;
    this.chat.pollTimer = setInterval(() => this.loadChatHistory(), 5000);
  }

  stopChatPolling() {
    if (this.chat.pollTimer) { clearInterval(this.chat.pollTimer); this.chat.pollTimer = null; }
  }

  /** Returns true if the message was new. */
  addChatMsg(m, sort) {
    if (!m || m.content == null) return false;
    const key = m.id || (m.senderId + '|' + m.at + '|' + m.content);
    if (this.chat.seen.has(key)) return false;
    this.chat.seen.add(key);
    this.chat.msgs.push(m);
    if (sort !== false) this.chat.msgs.sort((a, b) => (a.at || 0) - (b.at || 0));
    return true;
  }

  renderChat() {
    const box = $('chat-msgs');
    UI.clear(box);
    if (!this.chat.msgs.length) { box.appendChild(UI.el('p', 'empty', 'Say hello.')); return; }
    for (const m of this.chat.msgs) {
      const div = UI.el('div', 'msg' + (m.senderId === Net.userId ? ' mine' : ''));
      const meta = UI.el('span', 'msg-meta', this.nameOf(m.senderId) + ' · ' + UI.fmtTime(m.at));
      div.appendChild(meta);
      div.appendChild(document.createTextNode(m.content));
      box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
  }

  async sendChat(text) {
    if (!this.chat.convId || !text.trim()) return;
    try {
      const j = await Net.api(`/api/v1/chat/conversations/${this.chat.convId}/messages`, {
        method: 'POST', body: { content: text.trim() },
      });
      const m = normMsg(j && (j.message || j));
      if (m && m.content != null) { if (this.addChatMsg(m)) this.renderChat(); }
      else this.loadChatHistory();
    } catch (e) {
      UI.toast('Message not sent: ' + e.message, 'err');
    }
  }

  // ------------------------------------------------------------- teardown
  destroy() {
    this.destroyed = true;
    if (this.unTick) this.unTick();
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.ws) { try { this.ws.close(); } catch (e) { } this.ws = null; }
    if (this.chat.ws) { try { this.chat.ws.close(); } catch (e) { } this.chat.ws = null; }
    this.stopChatPolling();
    this.voice.disable(true);
  }
}

/* =========================================================================
   Voice — opt-in per game. Room per chat conversation; WebRTC audio with the
   voice WebSocket used for rtc signaling, mute + speaking indicators.
   ========================================================================= */
class VoiceController {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.muted = false;
    this.roomId = null;
    this.ws = null;
    this.stream = null;
    this.peers = new Map();       // userId -> { pc, audio, makingOffer, polite, speaking, muted }
    this.audioCtx = null;
    this.levelTimer = null;
    this.speakingSelf = false;
  }

  async enable() {
    const convId = this.game.chat.convId;
    if (!convId) { UI.toast('Voice needs the session chat — try again shortly.', 'err'); return; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      UI.toast('Microphone access was refused — voice stays off.', 'err');
      return;
    }
    try {
      let room = null;
      try {
        const j = await Net.api('/api/v1/voice/rooms?conversationId=' + encodeURIComponent(convId));
        const arr = Array.isArray(j) ? j : (j && (j.rooms || j.items)) || (j && j.roomId ? [j] : []);
        room = arr[0] || null;
      } catch (e) { if (e.status !== 404) throw e; }
      if (!room) {
        room = await Net.api('/api/v1/voice/rooms', { method: 'POST', body: { conversationId: convId } });
      }
      this.roomId = room.roomId || room.id;
      await Net.api(`/api/v1/voice/rooms/${this.roomId}/join`, { method: 'POST' });
    } catch (e) {
      UI.toast('Could not join the voice room: ' + e.message, 'err');
      this.stopStream();
      return;
    }
    this.enabled = true;
    this.muted = false;
    this.connectWs();
    this.startLevelMeter();
    this.renderUi();
  }

  connectWs() {
    if (!this.enabled) return;
    let ws;
    try { ws = new WebSocket(Net.wsUrl('/ws/v1/voice', { roomId: this.roomId, access_token: Net.token })); }
    catch (e) { return; }
    this.ws = ws;
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      this.onEvent(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws || !this.enabled) return;
      this.ws = null;
      setTimeout(() => { if (this.enabled) this.connectWs(); }, 3000);
    };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  onEvent(msg) {
    const t = msg.type || msg.event;
    const data = msg.data || msg;
    switch (t) {
      case 'voice.roster': {
        const list = data.participants || data.users || data.roster || [];
        for (const p of list) {
          const id = p.userId || p.id || p;
          if (id === Net.userId) continue;
          // I just joined: I initiate the offer to everyone already present.
          this.ensurePeer(id, true);
        }
        this.renderUi();
        break;
      }
      case 'voice.participant_joined': {
        const id = data.userId || (data.participant && data.participant.userId);
        if (id && id !== Net.userId) this.ensurePeer(id, false); // they will offer to us
        this.renderUi();
        break;
      }
      case 'voice.participant_left': {
        const id = data.userId || (data.participant && data.participant.userId);
        if (id) this.dropPeer(id);
        this.renderUi();
        break;
      }
      case 'voice.mute_changed': {
        const id = data.userId; const peer = this.peers.get(id);
        if (peer) { peer.muted = !!data.muted; this.renderUi(); }
        break;
      }
      case 'voice.speaking': {
        const id = data.userId; const peer = this.peers.get(id);
        if (peer) { peer.speaking = !!data.speaking; this.renderUi(); }
        break;
      }
      case 'voice.rtc':
      case 'rtc': {
        const from = data.from || msg.from;
        const payload = data.payload || msg.payload;
        if (from && payload) this.onSignal(from, payload);
        break;
      }
    }
  }

  ensurePeer(id, initiate) {
    if (this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: [] });
    const audio = new Audio();
    audio.autoplay = true;
    const peer = {
      pc, audio, makingOffer: false, ignoreOffer: false, initiator: !!initiate,
      polite: String(Net.userId) < String(id),
      speaking: false, muted: false,
    };
    this.peers.set(id, peer);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.ontrack = (ev) => { audio.srcObject = ev.streams[0] || new MediaStream([ev.track]); };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.send({ type: 'rtc', to: id, payload: { ice: ev.candidate } });
    };
    pc.onnegotiationneeded = async () => {
      // The joiner (who saw the peer in the roster) sends the first offer; the
      // existing member waits for it. Renegotiation flows freely afterwards.
      if (!peer.initiator && pc.remoteDescription == null) return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ type: 'rtc', to: id, payload: { sdp: pc.localDescription } });
      } catch (e) { /* renegotiation will retry */ }
      finally { peer.makingOffer = false; }
    };
    return peer;
  }

  async onSignal(from, payload) {
    const peer = this.ensurePeer(from, false);
    const pc = peer.pc;
    try {
      const sdp = payload.sdp || payload.description;
      const ice = payload.ice || payload.candidate;
      if (sdp) {
        const collision = sdp.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        if (collision) await pc.setLocalDescription({ type: 'rollback' });
        await pc.setRemoteDescription(sdp);
        if (sdp.type === 'offer') {
          await pc.setLocalDescription();
          this.send({ type: 'rtc', to: from, payload: { sdp: pc.localDescription } });
        }
      } else if (ice) {
        try { await pc.addIceCandidate(ice); }
        catch (e) { if (!peer.ignoreOffer) throw e; }
      }
    } catch (e) { /* signaling hiccup; next negotiation recovers */ }
  }

  dropPeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    try { peer.pc.close(); } catch (e) { }
    peer.audio.srcObject = null;
    this.peers.delete(id);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.stream) for (const t of this.stream.getAudioTracks()) t.enabled = !this.muted;
    this.send({ type: 'mute', muted: this.muted });
    this.renderUi();
  }

  startLevelMeter() {
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.audioCtx.createMediaStreamSource(this.stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      this.levelTimer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        const speaking = !this.muted && peak > 14;
        if (speaking !== this.speakingSelf) {
          this.speakingSelf = speaking;
          this.send({ type: 'speaking', speaking });
          this.renderUi();
        }
      }, 250);
    } catch (e) { /* meter is optional */ }
  }

  stopStream() {
    if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; }
    if (this.levelTimer) { clearInterval(this.levelTimer); this.levelTimer = null; }
    if (this.audioCtx) { try { this.audioCtx.close(); } catch (e) { } this.audioCtx = null; }
  }

  disable(silent) {
    const wasEnabled = this.enabled;
    this.enabled = false;
    if (this.ws) { try { this.ws.close(); } catch (e) { } this.ws = null; }
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.stopStream();
    this.roomId = null;
    this.muted = false;
    this.speakingSelf = false;
    if (!silent && wasEnabled) this.renderUi();
  }

  renderUi() {
    const btn = $('btn-voice');
    btn.textContent = this.enabled ? 'Disable voice' : 'Enable voice';
    btn.classList.toggle('on', this.enabled);
    $('voice-body').hidden = !this.enabled;
    if (!this.enabled) return;
    $('btn-mute').textContent = this.muted ? 'Unmute' : 'Mute';
    $('btn-mute').classList.toggle('on', this.muted);
    const peersBox = $('voice-peers');
    UI.clear(peersBox);
    const me = UI.el('span', 'vpeer' + (this.speakingSelf ? ' speaking' : '') + (this.muted ? ' muted' : ''), 'You');
    peersBox.appendChild(me);
    for (const [id, peer] of this.peers) {
      const el = UI.el('span', 'vpeer' + (peer.speaking ? ' speaking' : '') + (peer.muted ? ' muted' : ''),
        this.game.nameOf(id));
      peersBox.appendChild(el);
    }
    $('voice-status').textContent = this.peers.size === 0 ? 'Waiting for opponent to enable voice' : '';
  }
}
