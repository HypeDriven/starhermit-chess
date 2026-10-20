/* app.js — boot/auth, main menu (matchmaking, sessions, leaderboard, replays,
   invites) and the replay viewer. Views are plain sections toggled here. */
'use strict';

const PT = () => Net.platformText(); // StarHermit UI strings in the game's language

const App = {
  info: null,            // GET /games/<slug> payload
  lastElo: null,
  currentView: null,
  game: null,            // active GameController
  replay: null,          // replay viewer state
  _menuTimers: [],
  _listSigs: {},         // what #sessions-list / #invites-list last showed
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
    const art = $('auth-art');
    if (art) art.hidden = name !== 'auth' || !!art.dataset.failed;
  },

  isHal(player) {
    return !!player && player.username === 'The House';
  },

  updateEloChip(elo) {
    const chip = $('top-elo');
    if (elo == null) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.dataset.elo = elo;
    chip.textContent = T('Elo {n}', { n: elo });
  },

  // ------------------------------------------------------------- boot/auth
  init() {
    Net.onAuthLost = (msg, reason) => {
      if (App.game) { App.game.destroy(); App.game = null; }
      App.showAuth(msg, reason === 'expired');
    };

    // StarHermit.init() (index.html) already read #game_token=<jwt> (library
    // launch) or #access_token=<jwt> (sign-in return) and stripped it. An
    // optional session_id jumps straight into that game (invite accept flows).
    if (Net.token) {
      this.enterClub();
      if (SH.launchSessionId) this.openGame(SH.launchSessionId);
      return;
    }
    this.showAuth();
  },

  /**
   * Landing card; `expired` adds "Back to StarHermit" (StarHermit.relaunch()) under the message.
   * `msg` may be a thunk so the message follows a language change.
   */
  showAuth(msg, expired = false) {
    this._auth = { msg, expired };
    this.renderAuthText();
    $('auth-base').value = Net.base;
    if (!$('auth-slug').value) $('auth-slug').value = Net.slug || '';
    // On <slug>.starhermit.com without a token: one-click platform sign-in.
    $('btn-signin').hidden = !SH.canSignIn();
    this.updateEloChip(null);
    this.showView('auth');
  },

  renderAuthText() {
    const { msg, expired } = this._auth || {};
    const text = txt(msg);
    const box = $('auth-msg');
    box.hidden = !text;
    if (text) box.textContent = text;
    const relaunch = $('btn-relaunch');
    relaunch.textContent = PT().relaunch;
    relaunch.hidden = !expired;
    $('btn-signin').textContent = PT().signIn;
  },

  async authSubmit() {
    const jwt = $('auth-jwt').value.trim();
    const base = $('auth-base').value.trim(); // blank = same origin
    const slug = $('auth-slug').value.trim();
    if (!jwt) { this.showAuth(() => T('Paste a user token first.')); return; }
    if (!slug) { this.showAuth(() => T('Enter the game slug to launch.')); return; }
    Net.setBase(base);
    const btn = $('auth-go');
    btn.disabled = true; btn.textContent = T('Signing in…');
    try {
      await Net.launchToken(jwt, slug);
      this.enterClub();
    } catch (e) {
      this.showAuth(e.message);
    } finally {
      btn.disabled = false; btn.textContent = T('Enter the club');
    }
  },

  enterClub() {
    Net.loadBindings();
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
      this.info = await Net.api(Net.gamePath()) || {};
      // Replays exist only when the platform keeps them for this game.
      $('replays-section').hidden = this.info.replaysEnabled === false;
      const me = this.info.me || {};
      this.lastElo = me.elo != null ? me.elo : this.lastElo;
      this.updateEloChip(me.elo);
      const body = $('lb-me');
      UI.clear(body);
      const elo = UI.el('div', 'rating-elo', String(me.elo != null ? me.elo : '—'));
      const rec = UI.el('div', 'rating-rec',
        T('{wins} won · {losses} lost · {draws} drawn', { wins: me.wins || 0, losses: me.losses || 0, draws: me.draws || 0 }));
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
      sessions = await SH.mySessions();
    } catch (e) {
      if (e.status !== 401) { this._listSigs.sessions = null; $('sessions-list').replaceChildren(UI.el('p', 'empty', T('Could not load games — {error}', { error: e.message }))); }
      return;
    }
    const active = sessions.filter(s => s.status === 'active');
    const cap = (this.info && this.info.maxConcurrentSessionsPerPlayer) || 20;
    $('sessions-count').textContent = T('{n} of {cap} seats', { n: active.length, cap });
    const list = $('sessions-list');
    active.sort((a, b) => (b.myTurn === true) - (a.myTurn === true) || (a.deadline || 0) - (b.deadline || 0));
    const opponents = active.map(s => (s.players || []).find(p => p.userId !== Net.userId));
    const opponentProfiles = await Promise.all(opponents.map(p => this.profileFor(p && p.userId)));
    // The 30 s refresh rebuilds the cards only when what they show changed: a
    // card replaced between press and release loses its click.
    const sig = JSON.stringify([UI.locale(), active.map((s, i) => [s.sessionId, s.myTurn === true, s.deadline || '',
      this.isHal(opponents[i]) ? 'hal' : opponentProfiles[i].name])]);
    if (sig === this._listSigs.sessions) { this.tickSessionCards(); return; }
    this._listSigs.sessions = sig;
    UI.clear(list);
    if (!active.length) {
      list.appendChild(UI.el('p', 'empty', T('No games yet — hit Play, or invite a friend.')));
      return;
    }
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
        s.myTurn === true ? T('your move') : T('their move'));
      card.appendChild(turn);
      card.addEventListener('click', () => this.openGame(s.sessionId));
      list.appendChild(card);
    }
    this.tickSessionCards();
  },

  // Every second; the countdown nodes are updated in place, since a node
  // replaced while it is pressed swallows the card's click.
  tickSessionCards() {
    document.querySelectorAll('#sessions-list .card-sub').forEach(el => {
      const dl = Number(el.dataset.deadline);
      if (!dl) { if (el.firstChild) el.textContent = ''; return; }
      const left = dl - Date.now();
      const whose = el.dataset.myturn ? T('your move') : T('their move');
      let lead = el.firstChild, span = el.lastChild;
      if (!lead || lead.nodeType !== Node.TEXT_NODE || !span || span.nodeType !== Node.ELEMENT_NODE) {
        UI.clear(el);
        lead = el.appendChild(document.createTextNode(''));
        span = el.appendChild(UI.el('span'));
      }
      const head = whose + ' — ', cls = left < 3600000 ? 'urgent' : '', text = UI.fmtRemaining(left);
      if (lead.data !== head) lead.data = head;
      if (span.className !== cls) span.className = cls;
      if (span.textContent !== text) span.textContent = text;
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
  async resumeMatchmaking(force) {
    if (this._mmTimer) return true;
    // GET /matchmaking is a 404 with no ticket, which the browser logs as a
    // console error: only ask when this device queued (startMatchmaking keeps
    // the marker until the ticket resolves).
    let saved = null;
    try { saved = localStorage.getItem(this.matchmakingStorageKey()); } catch (e) { /* ignore */ }
    if (!saved && !force) return false;
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
      const r = await SH.joinQueue() || {};
      if (r.status === 'matched' && r.sessionId) {
        this.forgetMatchmaking();
        Sfx.play('matchFound');
        this.openGame(r.sessionId);
        return;
      }
      this.startSearchingUi(this.rememberMatchmaking(r, Date.now()));
    } catch (e) {
      if (e.status === 409) {
        // Possibly "already queued" (e.g. a race with resume): reflect the
        // queue instead of erroring if that's what this is.
        if (await this.resumeMatchmaking(true)) return;
        UI.toast(T('Cannot queue: {error}', { error: e.message }), 'err');
      } else if (e.status !== 401) UI.toast(e.message, 'err');
    }
  },

  async pollMatchmaking() {
    try {
      const r = await Net.api(Net.gamePath('/matchmaking'));   // null = 404: no ticket
      if (r && r.status === 'matched' && r.sessionId) {
        this.stopMatchmakingUi(false);
        this.forgetMatchmaking();
        UI.toast(T('Opponent found — good luck.'), 'ok');
        Sfx.play('matchFound');
        this.openGame(r.sessionId);
      } else if (!r || (r.status && r.status !== 'queued')) {
        throw { status: 404 };
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
    await SH.cancelMatch();   // soft: an already-gone ticket is fine
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
      const r = await SH.startAiSession();
      if (r && r.sessionId) this.openGame(r.sessionId);
    } catch (e) {
      UI.toast(T('Could not start a game against hal: {error}', { error: e.message }), 'err');
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
      if (!entries.length) { holder.appendChild(UI.el('p', 'empty', T('No rated friends yet.'))); return; }
      const table = UI.el('table', 'lb');
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const row = UI.el('tr', e.userId === Net.userId ? 'me' : null);
        row.appendChild(UI.el('td', 'lb-rank', String(e.rank != null ? e.rank : '')));
        row.appendChild(UI.el('td', null, profiles[i].name));
        row.appendChild(UI.el('td', 'lb-score', String(e.score)));
        table.appendChild(row);
      }
      holder.appendChild(table);
    } catch (e) {
      if (e.status !== 401) holder.replaceChildren(UI.el('p', 'empty', T('Table unavailable.')));
    }
  },

  // ---- replays
  async loadReplays() {
    const list = $('replays-list');
    let replays;
    try {
      replays = await SH.myReplays(10);
    } catch (e) {
      if (e.status !== 401) list.replaceChildren(UI.el('p', 'empty', T('No archive available.')));
      return;
    }
    UI.clear(list);
    if (!replays.length) {
      list.appendChild(UI.el('p', 'empty', T('Finished games will be filed here.')));
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
      const resTxt = kind === 'draw' ? T('draw') : (kind === 'white' ? T('White won') : (kind === 'black' ? T('Black won') : ''));
      const sub = UI.el('span', 'card-sub',
        [resTxt, r.result && UI.reasonText(r.result.reason), UI.fmtDate(r.finishedAt)].filter(Boolean).join(' · '));
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
    if (!userId) return Promise.resolve({ name: T('Player'), avatarUrl: null });
    if (!this._profiles.has(userId)) {
      this._profiles.set(userId, (async () => {
        // SDK: nickname first, 'Player <id>' fallback; avatar as an object URL.
        const p = await SH.profile(userId);
        const avatarUrl = await SH.avatarUrl(userId);
        return { name: (p && p.displayName) || T('Player {id}', { id: String(userId).slice(0, 6) }), avatarUrl };
      })());
    }
    return this._profiles.get(userId);
  },

  // ---- invites
  async loadInvites() {
    let j;
    try { j = await SH.invites(); }
    catch (e) { return; }
    const incoming = (j && j.incoming) || [];
    const outgoing = ((j && j.outgoing) || []).filter(o => o.status === 'pending');
    const profOf = (u) => this.profileFor(u && u.userId);
    const [inProfs, outProfs] = await Promise.all([
      Promise.all(incoming.map(inv => profOf(inv.from))),
      Promise.all(outgoing.map(inv => profOf(inv.to))),
    ]);
    const list = $('invites-list');
    // Polled every 10 s: the list is rebuilt only when the invitations change,
    // so Accept / Decline are never replaced between press and release.
    const sig = JSON.stringify([UI.locale(), incoming.map((inv, i) => [inv.inviteId, inProfs[i].name, inProfs[i].avatarUrl || '']),
      outgoing.map((inv, i) => [inv.inviteId, outProfs[i].name, outProfs[i].avatarUrl || ''])]);
    if (sig === this._listSigs.invites) return;
    this._listSigs.invites = sig;
    UI.clear(list);
    if (!incoming.length && !outgoing.length) {
      list.appendChild(UI.el('p', 'empty', T('No invitations.')));
      return;
    }
    incoming.forEach((inv, i) => {
      const card = UI.el('div', 'card card-static');
      card.appendChild(UI.avatar(inProfs[i]));
      card.appendChild(UI.el('span', 'card-name', inProfs[i].name));
      card.appendChild(UI.el('span', 'card-sub', T('invites you to a game')));
      card.appendChild(UI.el('span', 'spacer'));
      const acc = UI.el('button', 'btn btn-small btn-primary', T('Accept'));
      acc.addEventListener('click', async () => {
        try {
          const r = await SH.acceptInvite(inv.inviteId);
          if (r && r.sessionId) this.openGame(r.sessionId);
        } catch (e) { UI.toast(T('Could not accept: {error}', { error: e.message }), 'err'); this.loadInvites(); }
      });
      const dec = UI.el('button', 'btn btn-small', T('Decline'));
      dec.addEventListener('click', async () => {
        await SH.declineInvite(inv.inviteId);
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
      card.appendChild(UI.el('span', 'card-sub', T('invited — waiting')));
      list.appendChild(card);
    });
  },

  async inviteFriend() {
    let friends;
    try {
      const j = await SH.friends();
      friends = Array.isArray(j) ? j : (j && (j.friends || j.items)) || [];
    } catch (e) {
      UI.toast(T('Could not load friends: {error}', { error: e.message }), 'err');
      return;
    }
    const profiles = await Promise.all(
      friends.map(f => this.profileFor(f.userId || f.id)));
    await UI.picker(() => T('Invite a friend to a game'), (body, close) => {
      if (!friends.length) {
        body.appendChild(UI.el('p', 'empty', T('No friends on the platform yet.')));
        return;
      }
      friends.forEach((f, i) => {
        const id = f.userId || f.id;
        const card = UI.el('button', 'card');
        card.appendChild(UI.avatar(profiles[i]));
        card.appendChild(UI.el('span', 'card-name', profiles[i].name));
        card.appendChild(UI.el('span', 'spacer'));
        card.appendChild(UI.el('span', 'card-sub', T('Invite')));
        card.addEventListener('click', async () => {
          close(null);
          try {
            await SH.sendInvite(id);
            UI.toast(T('Invitation sent to {name}.', { name: profiles[i].name }), 'ok');
            this.loadInvites();
          } catch (e) {
            UI.toast(T('Could not invite: {error}', { error: e.message }), 'err');
          }
        });
        body.appendChild(card);
      });
    });
  },

  // ---- share link
  /**
   * Copy a dashboard game-invite URL to the clipboard. Anyone who opens it is
   * signed in on the web dashboard, walked through friending this player (and
   * picking a nickname), dropped into this game — and a play invitation comes
   * back automatically, so the new opponent shows up in Invitations above.
   * Reference implementation of the platform's /game-invite/ share URLs.
   */
  shareInviteLink() {
    const url = SH.inviteLink();
    if (!url) return;
    // navigator.clipboard is undefined on plain http (non-secure context);
    // a missing API takes the same manual-copy path as a refused write
    Promise.resolve().then(() => navigator.clipboard.writeText(url)).then(
      () => UI.toast(PT().inviteCopied, 'ok'),
      () => UI.picker(() => T('Copy this invite link'), (body) => {
        const input = UI.el('input', 'share-url');
        input.value = url;
        input.readOnly = true;
        input.addEventListener('focus', () => input.select());
        body.appendChild(input);
        input.focus();
      }));
  },

  // ------------------------------------------------------------- game
  openGame(sessionId) {
    this.showView('game');
    if (this.game) this.game.destroy();
    this.game = new GameController(sessionId);
    this._onLeave = () => { if (this.game) { this.game.destroy(); this.game = null; } };
    this.game.start();
  },

  /** Offline practice against hal — no platform, no sign-in (see local.js). */
  playLocal() {
    this.showView('game');
    if (this.game) this.game.destroy();
    this.game = new LocalGame();
    this._onLeave = () => { if (this.game) { this.game.destroy(); this.game = null; } };
    this.game.start();
  },

  /** "Back to the club" lands on the menu when signed in, on the sign-in screen otherwise. */
  leaveToHome() {
    if (Net.token) this.showMenu(); else this.showAuth();
  },

  // ------------------------------------------------------------- replay viewer
  async openReplay(sessionId) {
    const raw = await SH.getReplay(sessionId);
    if (!raw) {
      UI.toast(T('Could not open the replay.'), 'err');
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
    $('r-top-name').textContent = names[topId] || '?';
    $('r-elo').textContent = eloAfter
      ? (data.players || []).map(p => (names[p.userId] || '?') + ' ' + (eloAfter[p.userId] != null ? eloAfter[p.userId] : '—')).join(' · ')
      : '';
    this.renderReplayText();

    this.showView('replay');
    this._onLeave = () => { this.replay = null; };
    this.renderReplay();
  },

  /** Replay header text that depends on the language. */
  renderReplayText() {
    const rp = this.replay;
    if (!rp) return;
    const { data, names, flipped } = rp;
    $('r-bot-color').textContent = UI.colorName(flipped ? 'black' : 'white');
    $('r-top-color').textContent = UI.colorName(flipped ? 'white' : 'black');
    const res = data.result || {};
    const winnerName = res.kind === 'white' ? names[data.white] : (res.kind === 'black' ? names[data.black] : null);
    $('r-result').textContent = res.kind
      ? (res.kind === 'draw' ? T('Drawn') : T('{name} won', { name: winnerName || UI.colorName(res.kind) })) + ' — ' + UI.reasonText(res.reason)
      : T('In progress');
  },

  // ------------------------------------------------------------- language
  /**
   * The game language changed (Settings › Language, or the account preference
   * arriving): re-render every visible string in place. A game keeps its
   * socket and position; the menu re-renders from a REST refresh.
   */
  onLanguage() {
    const chip = $('top-elo');
    if (!chip.hidden && chip.dataset.elo) chip.textContent = T('Elo {n}', { n: chip.dataset.elo });
    this.renderAuthText();
    if (!$('auth-go').disabled) $('auth-go').textContent = T('Enter the club');
    UI.relocalizeModal();
    UI.relocalizePromo();
    if (this.game) this.game.relocalize();
    if (this.currentView === 'menu') {
      this.loadGameInfo().then(() => this.loadLeaderboard());
      this.loadSessions();
      this.loadReplays();
      this.loadInvites();
    }
    if (this.replay) { this.renderReplayText(); this.renderReplay(); }
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
    const prev = rp.idx;
    rp.idx = Math.max(0, Math.min(rp.states.length - 1, rp.idx + delta));
    if (rp.idx > prev) Sfx.forMove(rp.data.moves[rp.idx - 1].san);   // stepping forward sounds the move
    this.renderReplay();
  },
};

// ---------------------------------------------------------------- wiring
$('auth-go').addEventListener('click', () => App.authSubmit());
$('btn-play-local').addEventListener('click', () => App.playLocal());
$('btn-practice').addEventListener('click', () => App.playLocal());
$('btn-play').addEventListener('click', () => App.startMatchmaking());
$('mm-cancel').addEventListener('click', () => App.cancelMatchmaking());
$('btn-play-ai').addEventListener('click', () => App.playAi());
$('btn-invite').addEventListener('click', () => App.inviteFriend());
$('btn-share').addEventListener('click', () => App.shareInviteLink());

$('btn-back').addEventListener('click', () => App.leaveToHome());
$('btn-resign').addEventListener('click', () => App.game && App.game.resign());
$('btn-draw').addEventListener('click', () => App.game && App.game.offerDraw());
$('draw-accept').addEventListener('click', () => App.game && App.game.sendCmd({ type: 'accept-draw' }));
$('draw-decline').addEventListener('click', () => App.game && App.game.sendCmd({ type: 'decline-draw' }));
$('go-menu').addEventListener('click', () => App.leaveToHome());
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
  const act = Net.actionFor(e);
  if (act === 'left') { e.preventDefault(); App.replayStep(-1); }
  else if (act === 'right') { e.preventDefault(); App.replayStep(1); }
  else if (act === 'row_start') { e.preventDefault(); App.replayStep(-Infinity); }
  else if (act === 'row_end') { e.preventDefault(); App.replayStep(Infinity); }
});
$('btn-signin').addEventListener('click', () => SH.signIn());
$('btn-relaunch').addEventListener('click', () => SH.relaunch());
document.addEventListener('ch-language', () => App.onLanguage());

App.init();
