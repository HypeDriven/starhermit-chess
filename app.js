/* app.js — boot/auth, main menu (matchmaking, sessions, leaderboard, replays,
   invites) and the replay viewer. Views are plain sections toggled here. */
'use strict';

const App = {
  info: null,            // GET /games/<slug> payload
  lastElo: null,
  currentView: null,
  game: null,            // active GameController
  replay: null,          // replay viewer state
  _menuTimers: [],
  _mmTimer: null,
  _mmAiTimer: null,
  _mmStartedAt: null,
  _onLeave: null,

  // ------------------------------------------------------------- views
  showView(name) {
    if (this._onLeave) { this._onLeave(); this._onLeave = null; }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $('view-' + name).classList.add('active');
    this.currentView = name;
  },

  isHal(player) {
    return !!player && player.username === 'The House';
  },

  updateEloChip(elo) {
    const chip = $('top-elo');
    if (elo == null) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = 'Elo ' + elo;
  },

  // ------------------------------------------------------------- boot/auth
  init() {
    Net.onAuthLost = (msg) => {
      if (App.game) { App.game.destroy(); App.game = null; }
      App.showAuth(msg);
    };

    // #game_token=<jwt> from the platform launcher — read once, strip from URL.
    // An optional &session_id= jumps straight into that game (invite accept flows).
    const m = location.hash.match(/[#&]game_token=([^&]+)/);
    if (m) {
      const sm = location.hash.match(/[#&]session_id=([^&]+)/);
      history.replaceState(null, '', location.pathname + location.search);
      Net.setToken(decodeURIComponent(m[1]));
      this.enterClub();
      if (sm) this.openGame(decodeURIComponent(sm[1]));
      return;
    }
    if (Net.token) {
      const claims = Net.decodeJwt(Net.token);
      if (claims && (!claims.exp || claims.exp * 1000 > Date.now() + 60000)) {
        Net.setToken(Net.token); // populates userId
        this.enterClub();
        return;
      }
      Net.clearToken();
    }
    this.showAuth();
  },

  showAuth(msg) {
    const box = $('auth-msg');
    box.hidden = !msg;
    if (msg) box.textContent = msg;
    $('auth-base').value = Net.base;
    if (!$('auth-slug').value) $('auth-slug').value = Net.slug || '';
    this.updateEloChip(null);
    this.showView('auth');
  },

  async authSubmit() {
    const jwt = $('auth-jwt').value.trim();
    const base = $('auth-base').value.trim(); // blank = same origin
    const slug = $('auth-slug').value.trim();
    if (!jwt) { this.showAuth('Paste a user token first.'); return; }
    if (!slug) { this.showAuth('Enter the game slug to launch.'); return; }
    Net.setBase(base);
    const btn = $('auth-go');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await Net.launchToken(jwt, slug);
      this.enterClub();
    } catch (e) {
      this.showAuth(e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Enter the club';
    }
  },

  enterClub() {
    Net.startRefresh();
    this.showMenu();
  },

  // ------------------------------------------------------------- menu
  showMenu() {
    if (this.game) { this.game.destroy(); this.game = null; }
    this.showView('menu');
    this._onLeave = () => this.stopMenuTimers();
    this.refreshMenu();
    this._menuTimers.push(setInterval(() => this.loadInvites(), 10000));
    this._menuTimers.push(setInterval(() => this.loadSessions(), 30000));
    this._menuTimers.push({ untick: UI.onTick(() => this.tickSessionCards()) });
  },

  stopMenuTimers() {
    for (const t of this._menuTimers) {
      if (t && t.untick) t.untick(); else clearInterval(t);
    }
    this._menuTimers = [];
    this.stopMatchmakingUi(false);
  },

  refreshMenu() {
    this.loadGameInfo().then(() => this.loadLeaderboard());
    this.loadSessions();
    this.loadReplays();
    this.loadInvites();
    this.resumeMatchmaking();
  },

  async loadGameInfo() {
    try {
      this.info = await Net.api(Net.gamePath());
      const me = this.info.me || {};
      this.lastElo = me.elo != null ? me.elo : this.lastElo;
      this.updateEloChip(me.elo);
      const body = $('lb-me');
      UI.clear(body);
      const elo = UI.el('div', 'rating-elo', String(me.elo != null ? me.elo : '—'));
      const rec = UI.el('div', 'rating-rec',
        (me.wins || 0) + ' won · ' + (me.losses || 0) + ' lost · ' + (me.draws || 0) + ' drawn');
      body.appendChild(elo);
      body.appendChild(rec);
    } catch (e) {
      if (e.status !== 401) UI.toast(e.message, 'err');
    }
  },

  // ---- sessions
  async loadSessions() {
    let sessions;
    try {
      sessions = await Net.api(Net.gamePath('/sessions/mine')) || [];
    } catch (e) {
      if (e.status !== 401) $('sessions-list').replaceChildren(UI.el('p', 'empty', 'Could not load games — ' + e.message));
      return;
    }
    const active = sessions.filter(s => s.status === 'active');
    const cap = (this.info && this.info.maxConcurrentSessionsPerPlayer) || 20;
    $('sessions-count').textContent = active.length + ' of ' + cap + ' seats';
    const list = $('sessions-list');
    UI.clear(list);
    if (!active.length) {
      list.appendChild(UI.el('p', 'empty', 'No games yet — hit Play, or invite a friend.'));
      return;
    }
    active.sort((a, b) => (b.myTurn === true) - (a.myTurn === true) || (a.deadline || 0) - (b.deadline || 0));
    const opponents = active.map(s => (s.players || []).find(p => p.userId !== Net.userId));
    const opponentProfiles = await Promise.all(opponents.map(p => this.profileFor(p && p.userId)));
    for (let i = 0; i < active.length; i++) {
      const s = active[i];
      const opp = opponents[i];
      const oppName = this.isHal(opp) ? 'hal' : opponentProfiles[i].name;
      const card = UI.el('button', 'card');
      card.appendChild(UI.el('span', 'card-name', oppName));
      const sub = UI.el('span', 'card-sub');
      sub.dataset.deadline = s.deadline || '';
      sub.dataset.myturn = s.myTurn === true ? '1' : '';
      card.appendChild(sub);
      card.appendChild(UI.el('span', 'spacer'));
      const turn = UI.el('span', 'card-turn' + (s.myTurn === true ? ' mine' : ''),
        s.myTurn === true ? 'your move' : 'their move');
      card.appendChild(turn);
      card.addEventListener('click', () => this.openGame(s.sessionId));
      list.appendChild(card);
    }
    this.tickSessionCards();
  },

  tickSessionCards() {
    document.querySelectorAll('#sessions-list .card-sub').forEach(el => {
      const dl = Number(el.dataset.deadline);
      if (!dl) { el.textContent = ''; return; }
      const left = dl - Date.now();
      const whose = el.dataset.myturn ? 'your move' : 'their move';
      UI.clear(el);
      const span = UI.el('span', left < 3600000 ? 'urgent' : null, UI.fmtLeft(left) + ' left');
      el.appendChild(document.createTextNode(whose + ' — '));
      el.appendChild(span);
    });
  },

  // ---- matchmaking
  matchmakingStorageKey() {
    return 'chess.matchmaking.' + (Net.slug || '') + '.' + (Net.userId || '');
  },

  rememberMatchmaking(ticket, fallbackStartedAt) {
    let startedAt = Number(fallbackStartedAt) || 0;
    // Use a server timestamp when available; accept common field names/casing
    // while remaining compatible with the original timestamp-free response.
    const serverStartedAt = ticket && (ticket.createdAt || ticket.CreatedAt || ticket.queuedAt || ticket.QueuedAt);
    if (serverStartedAt) startedAt = Number(serverStartedAt) || Date.parse(serverStartedAt) || startedAt;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(this.matchmakingStorageKey())); } catch (e) { /* ignore */ }
    if (!startedAt && saved && saved.ticketId === ticket.ticketId) startedAt = Number(saved.startedAt) || 0;
    // A ticket with no timestamp or local marker predates this frontend. It has
    // survived a relaunch, so do not make that player wait another 30 seconds.
    if (!startedAt) startedAt = Date.now() - 30000;
    this._mmStartedAt = startedAt;
    try {
      localStorage.setItem(this.matchmakingStorageKey(), JSON.stringify({
        ticketId: ticket.ticketId, startedAt,
      }));
    } catch (e) { /* storage can be disabled */ }
    return startedAt;
  },

  forgetMatchmaking() {
    this._mmStartedAt = null;
    try { localStorage.removeItem(this.matchmakingStorageKey()); } catch (e) { /* ignore */ }
  },

  startSearchingUi(startedAt) {
    if (this._mmTimer) return; // already searching
    this._mmStartedAt = Number(startedAt) || this._mmStartedAt || Date.now();
    this.showMatchmakingUi(true);
    this._mmTimer = setInterval(() => this.pollMatchmaking(), 3000);
    // The 30 seconds belongs to the queue ticket, not this page load. That
    // matters when the player relaunches while their existing ticket waits.
    const aiDelay = Math.max(0, 30000 - (Date.now() - this._mmStartedAt));
    if (aiDelay === 0) $('btn-play-ai').hidden = false;
    else this._mmAiTimer = setTimeout(() => { $('btn-play-ai').hidden = false; }, aiDelay);
  },

  /**
   * The queue outlives the page: relaunching the game while a ticket is still
   * queued must come back up in the searching state, not on the Play button.
   * Returns true when a queued ticket was found and the UI resumed.
   */
  async resumeMatchmaking() {
    if (this._mmTimer) return true;
    let r = null;
    try { r = await Net.api(Net.gamePath('/matchmaking')); }
    catch (e) { return false; } // 404: not queued
    // Only a *queued* ticket resumes. A stale "matched" ticket's session is
    // already in My games — jumping into it here would hijack every menu load.
    if (!r || r.status !== 'queued' || this.currentView !== 'menu') return false;
    this.startSearchingUi(this.rememberMatchmaking(r));
    return true;
  },

  async startMatchmaking() {
    try {
      const r = await Net.api(Net.gamePath('/matchmaking'), { method: 'POST' });
      if (r.status === 'matched' && r.sessionId) {
        this.forgetMatchmaking();
        this.openGame(r.sessionId);
        return;
      }
      this.startSearchingUi(this.rememberMatchmaking(r, Date.now()));
    } catch (e) {
      if (e.status === 409) {
        // Possibly "already queued" (e.g. a race with resume): reflect the
        // queue instead of erroring if that's what this is.
        if (await this.resumeMatchmaking()) return;
        UI.toast('Cannot queue: ' + e.message, 'err');
      } else if (e.status !== 401) UI.toast(e.message, 'err');
    }
  },

  async pollMatchmaking() {
    try {
      const r = await Net.api(Net.gamePath('/matchmaking'));
      if (r && r.status === 'matched' && r.sessionId) {
        this.stopMatchmakingUi(false);
        this.forgetMatchmaking();
        UI.toast('Opponent found — good luck.', 'ok');
        this.openGame(r.sessionId);
      }
    } catch (e) {
      if (e.status === 404) {
        this.stopMatchmakingUi(false);
        this.forgetMatchmaking();
        this.loadSessions();
      }
    }
  },

  async cancelMatchmaking() {
    this.stopMatchmakingUi(false);
    try { await Net.api(Net.gamePath('/matchmaking'), { method: 'DELETE' }); }
    catch (e) { /* already gone */ }
    this.forgetMatchmaking();
  },

  showMatchmakingUi(on) {
    $('play-idle').hidden = on;
    $('play-searching').hidden = !on;
  },

  stopMatchmakingUi(keepUi) {
    if (this._mmTimer) { clearInterval(this._mmTimer); this._mmTimer = null; }
    if (this._mmAiTimer) { clearTimeout(this._mmAiTimer); this._mmAiTimer = null; }
    $('btn-play-ai').hidden = true;
    if (!keepUi) this.showMatchmakingUi(false);
  },

  /** Leave the queue and start a rated game against the server AI. */
  async playAi() {
    await this.cancelMatchmaking();
    try {
      const r = await Net.api(Net.gamePath('/sessions/ai'), { method: 'POST' });
      if (r && r.sessionId) this.openGame(r.sessionId);
    } catch (e) {
      UI.toast('Could not start a game against hal: ' + e.message, 'err');
    }
  },

  // ---- leaderboard
  async loadLeaderboard() {
    const holder = $('lb-table');
    if (!this.info || !this.info.leaderboardId) return;
    try {
      const j = await Net.api(`/api/v1/leaderboards/${this.info.leaderboardId}/entries?friendsOnly=true&page=1&pageSize=10`);
      const entries = (j && (j.entries || j.items)) || (Array.isArray(j) ? j : []);
      const profiles = await Promise.all(entries.map(e => this.profileFor(e.userId)));
      UI.clear(holder);
      if (!entries.length) { holder.appendChild(UI.el('p', 'empty', 'No rated friends yet.')); return; }
      const table = UI.el('table', 'lb');
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const tr = UI.el('tr', e.userId === Net.userId ? 'me' : null);
        tr.appendChild(UI.el('td', 'lb-rank', String(e.rank != null ? e.rank : '')));
        tr.appendChild(UI.el('td', null, profiles[i].name));
        tr.appendChild(UI.el('td', 'lb-score', String(e.score)));
        table.appendChild(tr);
      }
      holder.appendChild(table);
    } catch (e) {
      if (e.status !== 401) holder.replaceChildren(UI.el('p', 'empty', 'Table unavailable.'));
    }
  },

  // ---- replays
  async loadReplays() {
    const list = $('replays-list');
    let replays;
    try {
      replays = await Net.api(Net.gamePath('/replays/mine?limit=10')) || [];
    } catch (e) {
      if (e.status !== 401) list.replaceChildren(UI.el('p', 'empty', 'No archive available.'));
      return;
    }
    UI.clear(list);
    if (!replays.length) {
      list.appendChild(UI.el('p', 'empty', 'Finished games will be filed here.'));
      return;
    }
    replays.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    const replayOpponents = replays.map(r => (r.players || []).find(p => p.userId !== Net.userId));
    const replayOpponentProfiles = await Promise.all(replayOpponents.map(p => this.profileFor(p && p.userId)));
    for (let i = 0; i < replays.length; i++) {
      const r = replays[i];
      // The result record carries the rating change directly (eloBefore/eloAfter by userId).
      const res = r.result || {};
      const myAfter = res.eloAfter ? res.eloAfter[Net.userId] : null;
      const myBefore = res.eloBefore ? res.eloBefore[Net.userId] : null;
      const delta = (myAfter != null && myBefore != null) ? myAfter - myBefore : null;
      const opp = replayOpponents[i];
      const oppName = this.isHal(opp) ? 'hal' : replayOpponentProfiles[i].name;
      const card = UI.el('button', 'card');
      const name = UI.el('span', 'card-name', oppName);
      const kind = r.result ? r.result.kind : null;
      const resTxt = kind === 'draw' ? 'draw' : (kind ? kind + ' won' : '');
      const sub = UI.el('span', 'card-sub',
        [resTxt, r.result && r.result.reason, UI.fmtDate(r.finishedAt)].filter(Boolean).join(' · '));
      card.appendChild(name);
      card.appendChild(sub);
      card.appendChild(UI.el('span', 'spacer'));
      if (delta != null) {
        card.appendChild(UI.el('span', 'card-sub ' + (delta >= 0 ? 'delta-up' : 'delta-down'),
          (delta >= 0 ? '+' : '') + delta));
      } else if (myAfter != null) {
        card.appendChild(UI.el('span', 'card-sub', String(myAfter)));
      }
      card.addEventListener('click', () => this.openReplay(r.sessionId));
      list.appendChild(card);
    }
  },

  // ---- friend identity (profile nickname + picture, never the username)
  _profiles: new Map(),

  /**
   * Resolve a user's display identity from their public profile: nickname and
   * avatar (as an object URL, null if they have none). Cached per session so
   * repeated game/menu renders do not refetch. Usernames are deliberately not
   * accepted as a fallback: player-facing UI must display profile nicknames.
   */
  profileFor(userId) {
    if (!userId) return Promise.resolve({ name: 'Player', avatarUrl: null });
    if (!this._profiles.has(userId)) {
      this._profiles.set(userId, (async () => {
        let name = 'Player ' + String(userId).slice(0, 8);
        let avatarUrl = null;
        try {
          const p = await Net.api(`/api/v1/users/${encodeURIComponent(userId)}/profile`);
          if (p && p.nickname) name = p.nickname;
        } catch (e) { /* keep fallback */ }
        const blob = await Net.apiBlob(`/api/v1/users/${encodeURIComponent(userId)}/avatar`);
        if (blob) avatarUrl = URL.createObjectURL(blob);
        return { name, avatarUrl };
      })());
    }
    return this._profiles.get(userId);
  },

  // ---- invites
  async loadInvites() {
    let j;
    try { j = await Net.api(Net.gamePath('/invites')); }
    catch (e) { return; }
    const incoming = (j && j.incoming) || [];
    const outgoing = ((j && j.outgoing) || []).filter(o => o.status === 'pending');
    const profOf = (u) => this.profileFor(u && u.userId);
    const [inProfs, outProfs] = await Promise.all([
      Promise.all(incoming.map(inv => profOf(inv.from))),
      Promise.all(outgoing.map(inv => profOf(inv.to))),
    ]);
    const list = $('invites-list');
    UI.clear(list);
    if (!incoming.length && !outgoing.length) {
      list.appendChild(UI.el('p', 'empty', 'No invitations.'));
      return;
    }
    incoming.forEach((inv, i) => {
      const card = UI.el('div', 'card card-static');
      card.appendChild(UI.avatar(inProfs[i]));
      card.appendChild(UI.el('span', 'card-name', inProfs[i].name));
      card.appendChild(UI.el('span', 'card-sub', 'invites you to a game'));
      card.appendChild(UI.el('span', 'spacer'));
      const acc = UI.el('button', 'btn btn-small btn-primary', 'Accept');
      acc.addEventListener('click', async () => {
        try {
          const r = await Net.api(Net.gamePath(`/invites/${inv.inviteId}/accept`), { method: 'POST' });
          if (r && r.sessionId) this.openGame(r.sessionId);
        } catch (e) { UI.toast('Could not accept: ' + e.message, 'err'); this.loadInvites(); }
      });
      const dec = UI.el('button', 'btn btn-small', 'Decline');
      dec.addEventListener('click', async () => {
        try { await Net.api(Net.gamePath(`/invites/${inv.inviteId}/decline`), { method: 'POST' }); }
        catch (e) { /* gone */ }
        this.loadInvites();
      });
      card.appendChild(acc);
      card.appendChild(dec);
      list.appendChild(card);
    });
    outgoing.forEach((inv, i) => {
      const card = UI.el('div', 'card card-static');
      card.appendChild(UI.avatar(outProfs[i]));
      card.appendChild(UI.el('span', 'card-name', outProfs[i].name));
      card.appendChild(UI.el('span', 'card-sub', 'invited — waiting'));
      list.appendChild(card);
    });
  },

  async inviteFriend() {
    let friends;
    try {
      const j = await Net.api('/api/v1/me/friends');
      friends = Array.isArray(j) ? j : (j && (j.friends || j.items)) || [];
    } catch (e) {
      UI.toast('Could not load friends: ' + e.message, 'err');
      return;
    }
    const profiles = await Promise.all(
      friends.map(f => this.profileFor(f.userId || f.id)));
    await UI.picker('Invite a friend to a game', (body, close) => {
      if (!friends.length) {
        body.appendChild(UI.el('p', 'empty', 'No friends on the platform yet.'));
        return;
      }
      friends.forEach((f, i) => {
        const id = f.userId || f.id;
        const card = UI.el('button', 'card');
        card.appendChild(UI.avatar(profiles[i]));
        card.appendChild(UI.el('span', 'card-name', profiles[i].name));
        card.appendChild(UI.el('span', 'spacer'));
        card.appendChild(UI.el('span', 'card-sub', 'Invite'));
        card.addEventListener('click', async () => {
          close(null);
          try {
            await Net.api(Net.gamePath('/invites'), { method: 'POST', body: { toUserId: id } });
            UI.toast('Invitation sent to ' + profiles[i].name + '.', 'ok');
            this.loadInvites();
          } catch (e) {
            UI.toast('Could not invite: ' + e.message, 'err');
          }
        });
        body.appendChild(card);
      });
    });
  },

  // ------------------------------------------------------------- game
  openGame(sessionId) {
    this.showView('game');
    if (this.game) this.game.destroy();
    this.game = new GameController(sessionId);
    this._onLeave = () => { if (this.game) { this.game.destroy(); this.game = null; } };
    this.game.start();
  },

  // ------------------------------------------------------------- replay viewer
  async openReplay(sessionId) {
    let raw;
    try {
      raw = await Net.api(Net.gamePath(`/replays/${sessionId}`));
    } catch (e) {
      UI.toast('Could not open the replay: ' + e.message, 'err');
      return;
    }
    // The platform archives the script-owned session state verbatim under `state`;
    // unpack the chess shape (white/black/moves) from it.
    const st = raw.state || {};
    const data = {
      players: raw.players || [],
      result: raw.result || st.result || null,
      white: st.white,
      black: st.black,
      aiId: st.aiId || null,
      moves: (st.game && st.game.moves) || [],
    };
    const eloAfter = data.result && data.result.eloAfter;

    const Rules = R();
    const states = [{ board: Rules.START_BOARD, turn: 'white', check: false, lastMove: null }];
    const g = Rules.newGameState();
    for (const m of data.moves || []) {
      Rules.makeMove(g, { from: m.from, to: m.to, promo: m.promo || undefined }, m.at || 0);
      states.push({
        board: g.board, turn: g.turn,
        check: Rules.inCheck(g.board, g.turn),
        lastMove: { from: Rules.parseSquare(m.from), to: Rules.parseSquare(m.to) },
      });
    }
    const names = {};
    const replayPlayers = data.players || [];
    const replayProfiles = await Promise.all(replayPlayers.map(p => this.profileFor(p.userId)));
    replayPlayers.forEach((p, i) => {
      names[p.userId] = p.userId === data.aiId ? 'hal' : replayProfiles[i].name;
    });
    const flipped = data.black === Net.userId;
    this.replay = { data, states, idx: states.length - 1, flipped, names, eloAfter };

    // seats: bottom = my side (or white when spectating)
    const botId = flipped ? data.black : data.white;
    const topId = flipped ? data.white : data.black;
    $('r-bot-name').textContent = names[botId] || '?';
    $('r-bot-color').textContent = flipped ? 'black' : 'white';
    $('r-top-name').textContent = names[topId] || '?';
    $('r-top-color').textContent = flipped ? 'white' : 'black';

    const res = data.result || {};
    const winnerName = res.kind === 'white' ? names[data.white] : (res.kind === 'black' ? names[data.black] : null);
    $('r-result').textContent = res.kind
      ? (res.kind === 'draw' ? 'Drawn' : (winnerName || res.kind) + ' won') + ' — ' + (res.reason || '')
      : 'In progress';
    $('r-elo').textContent = eloAfter
      ? (data.players || []).map(p => (names[p.userId] || '?') + ' ' + (eloAfter[p.userId] != null ? eloAfter[p.userId] : '—')).join(' · ')
      : '';

    this.showView('replay');
    this._onLeave = () => { this.replay = null; };
    this.renderReplay();
  },

  renderReplay() {
    const rp = this.replay;
    if (!rp) return;
    const st = rp.states[rp.idx];
    UI.renderBoard($('r-board'), st.board, {
      flipped: rp.flipped,
      lastMove: st.lastMove,
      checkSquare: st.check ? UI.kingSquare(st.board, st.turn) : undefined,
    });
    UI.renderSheet($('r-moves'), rp.data.moves || [], {
      current: rp.idx,
      onJump: (ply) => { rp.idx = ply; this.renderReplay(); },
    });
    $('r-plies').textContent = rp.idx + ' / ' + (rp.states.length - 1);
    $('r-first').disabled = $('r-prev').disabled = rp.idx === 0;
    $('r-next').disabled = $('r-last').disabled = rp.idx === rp.states.length - 1;
  },

  replayStep(delta) {
    const rp = this.replay;
    if (!rp) return;
    rp.idx = Math.max(0, Math.min(rp.states.length - 1, rp.idx + delta));
    this.renderReplay();
  },
};

// ---------------------------------------------------------------- wiring
$('auth-go').addEventListener('click', () => App.authSubmit());
$('btn-play').addEventListener('click', () => App.startMatchmaking());
$('mm-cancel').addEventListener('click', () => App.cancelMatchmaking());
$('btn-play-ai').addEventListener('click', () => App.playAi());
$('btn-invite').addEventListener('click', () => App.inviteFriend());

$('btn-back').addEventListener('click', () => App.showMenu());
$('btn-resign').addEventListener('click', () => App.game && App.game.resign());
$('btn-draw').addEventListener('click', () => App.game && App.game.offerDraw());
$('draw-accept').addEventListener('click', () => App.game && App.game.sendCmd({ type: 'accept-draw' }));
$('draw-decline').addEventListener('click', () => App.game && App.game.sendCmd({ type: 'decline-draw' }));
$('go-menu').addEventListener('click', () => App.showMenu());
$('go-replay').addEventListener('click', () => {
  const id = App.game && App.game.sessionId;
  if (id) App.openReplay(id);
});
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  if (App.game && input.value.trim()) { App.game.sendChat(input.value); input.value = ''; }
});
$('btn-voice').addEventListener('click', () => {
  const v = App.game && App.game.voice;
  if (!v) return;
  if (v.enabled) v.disable(false); else v.enable();
});
$('btn-mute').addEventListener('click', () => App.game && App.game.voice.toggleMute());

$('r-back').addEventListener('click', () => App.showMenu());
$('r-first').addEventListener('click', () => App.replayStep(-Infinity));
$('r-prev').addEventListener('click', () => App.replayStep(-1));
$('r-next').addEventListener('click', () => App.replayStep(1));
$('r-last').addEventListener('click', () => App.replayStep(Infinity));

document.addEventListener('keydown', (e) => {
  if (App.currentView !== 'replay' || !$('modal').hidden) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); App.replayStep(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); App.replayStep(1); }
  else if (e.key === 'Home') { e.preventDefault(); App.replayStep(-Infinity); }
  else if (e.key === 'End') { e.preventDefault(); App.replayStep(Infinity); }
});

App.init();
