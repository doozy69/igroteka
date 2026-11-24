/**
 * Игровой движок «100 к одному».
 * Один экземпляр = одна комната. Состояние хранится в памяти.
 *
 * Ведущий не вводит текст ответа: он открывает нужную карточку
 * (или отмечает «мимо»), а движок считает фонд, страйки и контроль.
 */
class GameEngine {
  constructor(config) {
    this.config = config;
    this.resetAll();
  }

  resetAll() {
    this.pack = null;
    this.roundIndex = -1;
    this.phase = 'lobby';
    this.questionVisible = false;
    this.teams = (this.config.game.defaultTeams || []).map((t) => ({
      id: t.id,
      name: t.name,
      score: 0,
      strikes: 0
    }));
    this.activeTeamId = null;
    this.controlTeamId = null;
    this.round = null;
    this.faceoff = null;
    this.reverse = null;
    this.big = null;
    this.steal = null;
    this.log = [];
    this.winner = null;
    this.mainWinner = null;
    this.mainWinnerSet = false;
    this.history = [];
  }

  loadPack(pack) {
    this.resetAll();
    this.pack = pack;
    this.logEvent('PACK_LOADED', { title: pack.title, rounds: pack.rounds.length });
  }

  resetGame() {
    this.resetAll();
  }

  /** Сохраняем итоги завершённого раунда для финальной таблицы. */
  captureCurrentRound() {
    if (!this.round || this.round.historySaved) return;
    this.round.historySaved = true;
    const q = this.round.question;
    if (!q || q.type === 'big') return;

    const table = this.config.game.reversePointsByRank || [15, 30, 60, 120, 180, 240];
    const answers = (q.answers || []).map((a, i) => ({
      text: a.text,
      points: q.type === 'reverse'
        ? (table[i] ?? a.points ?? 0)
        : (a.points || 0) * this.round.multiplier,
      revealed: !!this.round.revealed[i]
    }));

    const record = {
      index: this.roundIndex,
      type: q.type,
      text: q.text || '',
      multiplier: this.round.multiplier,
      answers,
      scores: this.teams.map((t) => ({ id: t.id, name: t.name, score: t.score }))
    };

    if (q.type === 'reverse' && this.reverse) {
      record.reverse = {
        firstTeamId: this.reverse.firstTeamId,
        choices: { ...this.reverse.choices },
        i1: this.reverse.i1,
        i2: this.reverse.i2,
        p1: this.reverse.p1,
        p2: this.reverse.p2
      };
    }

    this.history.push(record);
  }

  /** Завершаем игру и фиксируем итоговые данные. */
  finishGame() {
    this.captureCurrentRound();
    this.phase = 'finished';
    this.winner = this.getWinner();
    if (!this.mainWinnerSet) {
      this.mainWinner = this.winner;
      this.mainWinnerSet = true;
    }
    this.logEvent('GAME_FINISHED', { winner: this.winner, mainWinner: this.mainWinner });
  }

  get currentQuestion() {
    return this.round ? this.round.question : null;
  }

  setTeamName(teamId, name) {
    const t = this.teams.find((x) => x.id === teamId);
    if (t) t.name = String(name || t.name).slice(0, 40);
  }

  setTeamScore(teamId, score) {
    const t = this.teams.find((x) => x.id === teamId);
    if (t) t.score = Number(score) || 0;
  }

  startRound() {
    if (!this.pack) throw new Error('Пак не загружен');
    this.captureCurrentRound();
    this.roundIndex += 1;
    if (this.roundIndex >= this.pack.rounds.length) {
      this.finishGame();
      return;
    }

    const q = this.pack.rounds[this.roundIndex];
    const multiplier = q.type === 'double' ? 2 : q.type === 'triple' ? 3 : 1;
    this.round = {
      question: q,
      multiplier,
      revealed: Array(q.type === 'big' ? 5 : 6).fill(false),
      fund: 0,
      historySaved: false
    };
    this.questionVisible = false;
    this.faceoff = null;
    this.reverse = null;
    this.big = null;
    this.steal = null;
    this.activeTeamId = null;
    this.controlTeamId = null;
    this.teams.forEach((t) => { t.strikes = 0; });

    if (q.type === 'big') {
      this.phase = 'big';
      this.questionVisible = true;
      if (!this.mainWinnerSet) {
        this.mainWinner = this.getWinner();
        this.mainWinnerSet = true;
      }
      this.big = this.createBigState();
    } else if (q.type === 'reverse') {
      this.phase = 'reverse';
      this.reverse = {
        stage: 'prepare', // prepare | discussion | locked | resolved
        choices: { team1: -1, team2: -1 },
        timerEndsAt: null,
        resolved: false,
        scored1: false,
        scored2: false,
        i1: -1,
        i2: -1,
        p1: 0,
        p2: 0,
        firstTeamId: this.getReverseFirstTeam()
      };
    } else {
      this.phase = 'faceoff';
      this.faceoff = {
        participants: { team1: null, team2: null },
        stage: 'prepare', // prepare | buzz | answer | second | repeat | done
        buzzedTeamId: null,
        buzzedPlayerId: null,
        firstTeamId: null,
        firstIndex: null,
        firstText: '',
        secondTeamId: null,
        secondIndex: null,
        secondText: '',
        controlPlayerId: null
      };
    }

    this.logEvent('ROUND_STARTED', { index: this.roundIndex, type: q.type });
  }

  getReverseFirstTeam() {
    const [a, b] = this.teams;
    if (!a) return null;
    if (!b) return a.id;
    if (a.score < b.score) return a.id;
    if (b.score < a.score) return b.id;
    return a.id;
  }

  otherTeam(teamId) {
    return this.teams.find((t) => t.id !== teamId)?.id || null;
  }

  /** Ведущий прочитал вопрос и показывает его игрокам / запускает таймер. */
  showQuestion() {
    if (this.phase === 'faceoff' && this.faceoff) {
      if (this.faceoff.stage !== 'prepare') return { ok: false, reason: 'Вопрос уже показан.' };
      this.faceoff.stage = 'buzz';
      this.questionVisible = true;
      this.logEvent('QUESTION_SHOWN', { type: 'faceoff' });
      return { ok: true };
    }
    if (this.phase === 'reverse' && this.reverse) {
      if (this.reverse.stage !== 'prepare') return { ok: false, reason: 'Вопрос уже показан.' };
      const seconds = this.config.game.timers?.reverseDiscussionSec || 20;
      this.reverse.stage = 'discussion';
      this.reverse.timerEndsAt = Date.now() + seconds * 1000;
      this.questionVisible = true;
      this.logEvent('REVERSE_DISCUSSION_STARTED', { seconds });
      return { ok: true };
    }
    return { ok: false, reason: 'Сейчас нет вопроса для показа.' };
  }

  setFaceoffParticipants(participants = {}) {
    if (!this.faceoff) return;
    if (participants.team1 !== undefined) this.faceoff.participants.team1 = participants.team1 || null;
    if (participants.team2 !== undefined) this.faceoff.participants.team2 = participants.team2 || null;
    this.logEvent('FACEOFF_PARTICIPANTS', { ...this.faceoff.participants });
  }

  resetFaceoffBuzz(log = true) {
    if (!this.faceoff) return;
    const wasPrepare = this.faceoff.stage === 'prepare';
    this.faceoff.stage = wasPrepare ? 'prepare' : 'buzz';
    this.faceoff.buzzedTeamId = null;
    this.faceoff.buzzedPlayerId = null;
    this.faceoff.firstTeamId = null;
    this.faceoff.firstIndex = null;
    this.faceoff.firstText = '';
    this.faceoff.secondTeamId = null;
    this.faceoff.secondIndex = null;
    this.faceoff.secondText = '';
    this.faceoff.controlPlayerId = null;
    if (log) this.logEvent('FACEOFF_RESET', {});
  }

  buzz(teamId, playerId) {
    if (this.phase !== 'faceoff' || !this.faceoff) {
      return { ok: false, reason: 'Сейчас не розыгрыш.' };
    }
    if (this.faceoff.stage !== 'buzz') {
      return { ok: false, reason: 'Нажатие уже принято.' };
    }
    if (!this.faceoff.participants[teamId] || this.faceoff.participants[teamId] !== playerId) {
      return { ok: false, reason: 'Вы не участвуете в этом розыгрыше.' };
    }
    if (this.faceoff.buzzedTeamId) {
      return { ok: false, reason: 'Первым уже нажал соперник.' };
    }
    this.faceoff.buzzedTeamId = teamId;
    this.faceoff.buzzedPlayerId = playerId;
    this.faceoff.stage = 'answer';
    this.logEvent('BUZZ', { teamId, playerId });
    return { ok: true };
  }

  /**
   * Ведущий открывает карточку, которую назвал участник, или -1 («мимо»).
   * Возвращает stage: 'second' | 'repeat' | 'done'.
   */
  submitFaceoffChoice(index) {
    const q = this.currentQuestion;
    if (!q || !this.faceoff) return { ok: false, reason: 'Сейчас нет розыгрыша.' };
    const choice = this.normalizeChoice(index, q.answers ? q.answers.length : 0);

    if (this.faceoff.stage === 'answer') {
      const teamId = this.faceoff.buzzedTeamId;
      if (!teamId) return { ok: false, reason: 'Никто ещё не нажал кнопку.' };
      const playerId = this.faceoff.buzzedPlayerId;
      this.revealAnswerByIndex(choice);
      this.faceoff.firstTeamId = teamId;
      this.faceoff.firstIndex = choice;
      this.faceoff.firstText = choice >= 0 ? q.answers[choice].text : '';

      if (choice === 0) {
        this.faceoff.stage = 'done';
        this.faceoff.controlPlayerId = playerId;
        this.controlTeamId = teamId;
        this.activeTeamId = teamId;
        this.phase = 'play';
        this.logEvent('FACEOFF_WON', { teamId, firstIdx: choice, immediately: true });
        return { ok: true, matchIndex: choice, stage: 'done', controlTeamId: teamId };
      }

      this.faceoff.stage = 'second';
      this.faceoff.secondTeamId = this.otherTeam(teamId);
      this.logEvent('FACEOFF_FIRST', { teamId, idx: choice });
      return { ok: true, matchIndex: choice, stage: 'second', secondTeamId: this.faceoff.secondTeamId };
    }

    if (this.faceoff.stage === 'second') {
      const firstTeam = this.faceoff.firstTeamId;
      const secondTeam = this.faceoff.secondTeamId || this.otherTeam(firstTeam);
      const secondPlayer = this.faceoff.participants[secondTeam];
      this.revealAnswerByIndex(choice);
      this.faceoff.secondIndex = choice;
      this.faceoff.secondText = choice >= 0 ? q.answers[choice].text : '';

      const firstIdx = this.faceoff.firstIndex;
      let control = null;
      if (firstIdx < 0) {
        control = choice >= 0 ? secondTeam : null;
      } else if (choice < 0) {
        control = firstTeam;
      } else if (choice < firstIdx) {
        control = secondTeam;
      } else {
        control = firstTeam;
      }

      if (!control) {
        this.faceoff.stage = 'repeat';
        this.logEvent('FACEOFF_REPEAT', { firstTeam, secondTeam, firstIdx, secondIdx: choice });
        return { ok: true, matchIndex: choice, stage: 'repeat' };
      }

      this.faceoff.stage = 'done';
      this.faceoff.controlPlayerId = control === firstTeam
        ? this.faceoff.buzzedPlayerId
        : secondPlayer;
      this.controlTeamId = control;
      this.activeTeamId = control;
      this.phase = 'play';
      this.logEvent('FACEOFF_WON', { teamId: control, firstIdx, secondIdx: choice });
      return { ok: true, matchIndex: choice, stage: 'done', controlTeamId: control };
    }

    return { ok: false, reason: 'Сейчас не время отвечать.' };
  }

  normalizeChoice(index, length) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= length) return -1;
    return i;
  }

  setActiveTeam(teamId) {
    if (!this.teams.some((t) => t.id === teamId)) return;
    this.activeTeamId = teamId;
    this.controlTeamId = teamId;
    if (this.phase === 'faceoff') {
      this.phase = 'play';
      this.questionVisible = true;
      if (this.faceoff) this.faceoff.stage = 'done';
    }
    this.logEvent('ACTIVE_TEAM', { teamId });
  }

  revealAnswerByIndex(idx) {
    const q = this.currentQuestion;
    if (!q || !q.answers) return 0;
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0 || i >= q.answers.length) return 0;
    if (this.round.revealed[i]) return 0;
    this.round.revealed[i] = true;
    const pts = (q.answers[i].points || 0) * this.round.multiplier;
    this.round.fund += pts;
    this.logEvent('ANSWER_REVEALED', { idx: i, text: q.answers[i].text, pts });
    return pts;
  }

  /** Открыть карточку в основной игре (без текстового ввода). */
  revealIndex(idx) {
    const q = this.currentQuestion;
    if (!q || q.type === 'big' || q.type === 'reverse') return 0;
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0 || i >= 6) return 0;
    const pts = this.revealAnswerByIndex(i);
    this.checkBoardComplete();
    return pts;
  }

  addStrike(teamId) {
    const team = this.teams.find((t) => t.id === teamId);
    if (!team) return;
    const max = this.config.game.maxStrikes || 3;
    team.strikes = Math.min(max, team.strikes + 1);
    this.logEvent('STRIKE', { teamId, strikes: team.strikes });

    if (team.strikes >= max && this.phase === 'play') {
      const stealingTeam = this.otherTeam(teamId);
      this.phase = 'steal';
      this.steal = {
        byTeamId: teamId,
        teamId: stealingTeam,
        resolved: false,
        success: null,
        index: -1
      };
      this.logEvent('STEAL_START', { controlTeamId: teamId, stealingTeamId: stealingTeam });
    }
  }

  clearStrike(teamId) {
    const team = this.teams.find((t) => t.id === teamId);
    if (!team) return;
    const max = this.config.game.maxStrikes || 3;
    team.strikes = Math.max(0, team.strikes - 1);
    if (this.phase === 'steal' && this.steal && this.steal.byTeamId === teamId && team.strikes < max) {
      this.phase = 'play';
      this.steal = null;
    }
  }

  awardFund(teamId) {
    const team = this.teams.find((t) => t.id === teamId);
    if (!team || !this.round) return 0;
    const amount = this.round.fund || 0;
    team.score += amount;
    this.round.fund = 0;
    this.logEvent('FUND_AWARDED', { teamId, amount });
    return amount;
  }

  checkBoardComplete() {
    if (!this.round || !this.round.revealed.every(Boolean)) return;
    const winner = this.controlTeamId || this.activeTeamId;
    if (winner) {
      this.awardFund(winner);
      this.controlTeamId = winner;
    }
    this.phase = 'intro';
    this.logEvent('BOARD_COMPLETE', { teamId: winner });
  }

  /** Блиц-опрос: открываем карточку, которую выбрал капитан, или -1 («мимо»). */
  resolveStealChoice(index) {
    if (!this.steal || !this.round) {
      return { ok: false, reason: 'Сейчас нет блиц-опроса.' };
    }
    const q = this.round.question;
    const choice = this.normalizeChoice(index, q.answers ? q.answers.length : 0);
    this.steal.index = choice;
    let winner;
    if (choice >= 0) {
      this.revealAnswerByIndex(choice);
      winner = this.steal.teamId;
    } else {
      winner = this.steal.byTeamId;
    }
    this.awardFund(winner);
    this.steal.resolved = true;
    this.steal.success = choice >= 0;
    this.phase = 'intro';
    this.logEvent('STEAL_RESOLVED', { winner, success: choice >= 0 });
    return { ok: true, success: choice >= 0, winner, idx: choice };
  }

  setReverseChoice(teamId, index) {
    if (!this.reverse || (teamId !== 'team1' && teamId !== 'team2')) return { ok: false };
    if (this.reverse.stage !== 'discussion' && this.reverse.stage !== 'locked') {
      return { ok: false, reason: 'Версии можно выбирать только во время совещания.' };
    }
    const q = this.currentQuestion;
    const choice = this.normalizeChoice(index, q && q.answers ? q.answers.length : 0);
    this.reverse.choices[teamId] = choice;
    return { ok: true, choice };
  }

  /** Считаем очки за версии, не открывая карточки. */
  computeReverseScores() {
    const q = this.round.question;
    const c1 = this.reverse.choices.team1;
    const c2 = this.reverse.choices.team2;
    const table = this.config.game.reversePointsByRank || [15, 30, 60, 120, 180, 240];
    const p1 = c1 >= 0 ? (table[c1] ?? q.answers[c1].points ?? 0) : 0;
    const p2 = c2 >= 0 ? (table[c2] ?? q.answers[c2].points ?? 0) : 0;
    return { c1, c2, p1, p2 };
  }

  /** Ведущий зафиксировал версии. Ответы и очки ещё скрыты от зала. */
  lockReverseChoices() {
    if (!this.reverse || !this.round) {
      return { ok: false, reason: 'Сейчас нет игры наоборот.' };
    }
    if (this.reverse.stage !== 'discussion' && this.reverse.stage !== 'locked') {
      return { ok: false, reason: 'Сначала покажите вопрос и дождитесь совещания.' };
    }
    const { c1, c2, p1, p2 } = this.computeReverseScores();
    if (c1 >= 0 && c2 >= 0 && c1 === c2) {
      return { ok: false, reason: 'Версии команд не должны совпадать.' };
    }

    this.reverse.stage = 'locked';
    this.reverse.timerEndsAt = null;
    this.reverse.i1 = c1;
    this.reverse.i2 = c2;
    this.reverse.p1 = p1;
    this.reverse.p2 = p2;
    // «Мимо» не требует открытия карточки — очки за него уже 0.
    this.reverse.scored1 = c1 < 0;
    this.reverse.scored2 = c2 < 0;
    this.logEvent('REVERSE_LOCKED', { p1, p2, i1: c1, i2: c2 });
    return { ok: true, p1, p2, i1: c1, i2: c2, resolved: false };
  }

  /** Завершаем игру наоборот после открытия всех карточек. */
  finishReverse() {
    if (!this.reverse) return;
    this.reverse.resolved = true;
    this.reverse.stage = 'resolved';
    this.reverse.timerEndsAt = null;
    this.phase = 'intro';
    this.mainWinner = this.getWinner();
    this.mainWinnerSet = true;
    this.logEvent('REVERSE_RESOLVED', {
      p1: this.reverse.p1,
      p2: this.reverse.p2,
      i1: this.reverse.i1,
      i2: this.reverse.i2,
      mainWinner: this.mainWinner
    });
  }

  /**
   * Ведущий сам открывает карточку после фиксации версий.
   * Очки начисляются, когда открыта карточка выбранной версии команды.
   */
  revealReverseCard(index) {
    if (!this.reverse || !this.round) {
      return { ok: false, reason: 'Сейчас нет игры наоборот.' };
    }
    if (this.reverse.stage !== 'locked') {
      return { ok: false, reason: 'Сначала зафиксируйте версии команд.' };
    }
    const q = this.round.question;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= (q.answers?.length || 0)) {
      return { ok: false, reason: 'Неверная карточка.' };
    }
    if (this.round.revealed[i]) return { ok: true, index: i, already: true };

    this.round.revealed[i] = true;
    const c1 = this.reverse.i1;
    const c2 = this.reverse.i2;
    let awarded = 0;
    if (i === c1 && !this.reverse.scored1) {
      const team = this.teams.find((t) => t.id === 'team1');
      if (team) team.score += this.reverse.p1;
      this.reverse.scored1 = true;
      awarded += this.reverse.p1;
    }
    if (i === c2 && !this.reverse.scored2) {
      const team = this.teams.find((t) => t.id === 'team2');
      if (team) team.score += this.reverse.p2;
      this.reverse.scored2 = true;
      awarded += this.reverse.p2;
    }

    this.logEvent('REVERSE_CARD_OPENED', { index: i, awarded });
    const allRevealed = this.round.revealed.every(Boolean);
    if (allRevealed) this.finishReverse();
    return {
      ok: true,
      index: i,
      awarded,
      allRevealed,
      resolved: this.reverse.resolved
    };
  }

  createBigState() {
    const timers = this.config.game.timers || {};
    return {
      player1: '',
      player2: '',
      player1Id: null,
      player2Id: null,
      stage: 'player1',
      choices1: Array(5).fill(-1),
      choices2: Array(5).fill(-1),
      answers1: Array(5).fill(''),
      answers2: Array(5).fill(''),
      points1: Array(5).fill(null),
      points2: Array(5).fill(null),
      duplicates2: Array(5).fill(false),
      checked1: false,
      checked2: false,
      total1: 0,
      total2: 0,
      total: 0,
      revealed: false,
      seconds1: timers.bigGamePlayer1Sec || 20,
      seconds2: timers.bigGamePlayer2Sec || 30,
      timerEndsAt: null,
      timerPlayer: null,
      result: null
    };
  }

  setBigPlayers(player1, player2, player1Id = null, player2Id = null) {
    if (!this.big) return;
    const new1 = String(player1 || '').slice(0, 40);
    const new2 = String(player2 || '').slice(0, 40);
    const newId1 = player1Id ? String(player1Id) : null;
    const newId2 = player2Id ? String(player2Id) : null;
    const changed = new1 !== this.big.player1 || new2 !== this.big.player2
      || newId1 !== this.big.player1Id || newId2 !== this.big.player2Id;
    this.big.player1 = new1;
    this.big.player2 = new2;
    this.big.player1Id = newId1;
    this.big.player2Id = newId2;
    if (changed) {
      this.big.stage = 'player1';
      this.big.checked1 = false;
      this.big.checked2 = false;
      this.big.choices1 = Array(5).fill(-1);
      this.big.choices2 = Array(5).fill(-1);
      this.big.answers1 = Array(5).fill('');
      this.big.answers2 = Array(5).fill('');
      this.big.points1 = Array(5).fill(null);
      this.big.points2 = Array(5).fill(null);
      this.big.duplicates2 = Array(5).fill(false);
      this.big.total1 = 0;
      this.big.total2 = 0;
      this.big.total = 0;
      this.big.revealed = false;
      this.big.result = null;
      this.big.timerEndsAt = null;
      this.big.timerPlayer = null;
    }
  }

  startBigTimer(player, seconds) {
    if (!this.big) return { ok: false, reason: 'Сейчас нет большой игры.' };
    if (this.big.stage === 'done') return { ok: false, reason: 'Большая игра уже завершена.' };
    const p = Number(player) === 2 ? 2 : 1;
    const fallback = p === 2 ? this.big.seconds2 : this.big.seconds1;
    const sec = Math.max(5, Math.min(300, Math.round(Number(seconds) || fallback)));
    if (p === 2) this.big.seconds2 = sec;
    else this.big.seconds1 = sec;
    this.big.timerEndsAt = Date.now() + sec * 1000;
    this.big.timerPlayer = p;
    this.logEvent('BIG_TIMER_STARTED', { player: p, seconds: sec });
    return { ok: true, player: p, seconds: sec };
  }

  stopBigTimer() {
    if (!this.big) return { ok: false, reason: 'Сейчас нет большой игры.' };
    this.big.timerEndsAt = null;
    this.big.timerPlayer = null;
    this.logEvent('BIG_TIMER_STOPPED', {});
    return { ok: true };
  }

  submitBigChoice(step, qIndex, choice) {
    if (!this.big) return { ok: false, reason: 'Сейчас нет большой игры.' };
    const i = Number(qIndex);
    if (!Number.isInteger(i) || i < 0 || i >= 5) return { ok: false, reason: 'Неверный вопрос.' };
    const qs = this.round.question.questions || [];
    const opts = (qs[i] && qs[i].answers) || [];
    const value = this.normalizeChoice(choice, opts.length);
    if (Number(step) === 1) {
      this.big.choices1[i] = value;
    } else {
      if (this.big.checked1 && value >= 0 && this.big.choices1[i] === value) {
        return {
          ok: false,
          duplicate: true,
          reason: 'Этот ответ уже назвал игрок 1 — повтор не засчитывается.'
        };
      }
      this.big.choices2[i] = value;
    }
    return { ok: true, choice: value };
  }

  checkBig1() {
    if (!this.big || !this.round) {
      return { ok: false, reason: 'Сейчас нет большой игры.' };
    }
    const qs = this.round.question.questions || [];
    let total = 0;
    for (let i = 0; i < 5; i++) {
      const opts = (qs[i] && qs[i].answers) || [];
      const choice = this.big.choices1[i];
      const p = choice >= 0 ? (opts[choice]?.points || 0) : 0;
      this.big.points1[i] = p;
      this.big.answers1[i] = choice >= 0 ? (opts[choice]?.text || '') : '';
      total += p;
    }
    this.big.checked1 = true;
    this.big.checked2 = false;
    this.big.points2 = Array(5).fill(null);
    this.big.answers2 = Array(5).fill('');
    this.big.duplicates2 = Array(5).fill(false);
    // Если ответ второго уже совпадал с первым, сбрасываем его:
    // выбрать повтор после проверки первого игрока нельзя.
    for (let i = 0; i < 5; i++) {
      if (this.big.choices1[i] >= 0 && this.big.choices2[i] === this.big.choices1[i]) {
        this.big.choices2[i] = -1;
      }
    }
    this.big.total1 = total;
    this.big.total2 = 0;
    this.big.total = total;
    this.big.stage = 'player2';
    this.big.revealed = false;
    this.big.timerEndsAt = null;
    this.big.timerPlayer = null;
    this.big.result = null;
    this.logEvent('BIG_PLAYER1_CHECKED', { total });
    return { ok: true, total };
  }

  checkBig2() {
    if (!this.big || !this.round) {
      return { ok: false, reason: 'Сейчас нет большой игры.' };
    }
    if (!this.big.checked1) {
      return { ok: false, reason: 'Сначала проверьте ответы игрока 1.' };
    }
    const qs = this.round.question.questions || [];
    let total2 = 0;
    for (let i = 0; i < 5; i++) {
      const opts = (qs[i] && qs[i].answers) || [];
      const c1 = this.big.choices1[i];
      const c2 = this.big.choices2[i];
      let p2 = c2 >= 0 ? (opts[c2]?.points || 0) : 0;
      const duplicate = c1 >= 0 && c1 === c2;
      if (duplicate) p2 = 0;
      this.big.answers2[i] = c2 >= 0 ? (opts[c2]?.text || '') : '';
      this.big.duplicates2[i] = duplicate;
      this.big.points2[i] = p2;
      total2 += p2;
    }
    this.big.checked2 = true;
    this.big.total2 = total2;
    this.big.total = this.big.total1 + total2;
    this.big.stage = 'done';
    this.big.revealed = true;
    this.big.timerEndsAt = null;
    this.big.timerPlayer = null;
    const target = this.config.game.bigGameTarget || 200;
    this.big.result = this.big.total >= target ? 'win' : 'lose';
    this.logEvent('BIG_SCORED', {
      total: this.big.total,
      total1: this.big.total1,
      total2,
      result: this.big.result
    });
    return { ok: true, total: this.big.total, total1: this.big.total1, total2, result: this.big.result };
  }

  scoreBig() {
    if (!this.big || !this.round) return { ok: false, reason: 'Сейчас нет большой игры.' };
    const first = this.checkBig1();
    if (!first.ok) return first;
    return this.checkBig2();
  }

  getWinner() {
    const sorted = [...this.teams].sort((a, b) => b.score - a.score);
    if (sorted.length > 1 && sorted[0].score === sorted[1].score) return null;
    return sorted[0] ? sorted[0].id : null;
  }

  logEvent(type, data) {
    this.log.unshift({ t: Date.now(), type, data });
    if (this.log.length > 60) this.log.pop();
  }

  /**
   * Состояние для клиента. Скрытые ответы и вопрос не уходят на ТВ и телефоны,
   * пока ведущий не нажмёт «Показать вопрос».
   */
  getState(role = 'admin') {
    const isAdmin = role === 'admin';
    const isDisplay = role === 'display';
    const q = this.currentQuestion;
    const showQuestion = isAdmin || this.questionVisible;

    let round = null;
    if (this.round && q) {
      round = {
        type: q.type,
        text: showQuestion ? q.text : null,
        multiplier: this.round.multiplier,
        fund: this.round.fund,
        answers: q.answers
          ? q.answers.map((a, i) => ({
              i,
              revealed: !!this.round.revealed[i],
              text: isAdmin || this.round.revealed[i] ? a.text : null,
              points: isAdmin || this.round.revealed[i] ? a.points : null,
              aliases: isAdmin ? (a.aliases || []) : undefined
            }))
          : null,
        bigQuestions: q.type === 'big' && (isAdmin || (isDisplay && this.phase === 'finished'))
          ? q.questions.map((qq, i) => ({
              i,
              text: qq.text,
              answers: qq.answers
            }))
          : null
      };
    }

    let faceoff = null;
    if (this.faceoff) {
      faceoff = {
        participants: { ...this.faceoff.participants },
        stage: this.faceoff.stage,
        buzzedTeamId: this.faceoff.buzzedTeamId,
        buzzedPlayerId: this.faceoff.buzzedPlayerId,
        firstTeamId: this.faceoff.firstTeamId,
        firstIndex: this.faceoff.firstIndex,
        secondTeamId: this.faceoff.secondTeamId,
        secondIndex: this.faceoff.secondIndex,
        controlPlayerId: this.faceoff.controlPlayerId
      };
    }

    let steal = null;
    if (this.steal) {
      steal = {
        byTeamId: this.steal.byTeamId,
        teamId: this.steal.teamId,
        resolved: this.steal.resolved,
        success: this.steal.success,
        index: isAdmin || this.steal.resolved ? this.steal.index : null
      };
    }

    let big = null;
    if (this.big) {
      // На ТВ после первого игрока видны только его очки. Ответы обоих
      // и очки второго открываются после проверки второго игрока.
      const showPoints1 = isAdmin || (isDisplay && this.big.checked1);
      const showSecond = isAdmin || (isDisplay && this.big.checked2);
      big = {
        player1: this.big.player1,
        player2: this.big.player2,
        player1Id: this.big.player1Id,
        player2Id: this.big.player2Id,
        stage: this.big.stage,
        checked1: this.big.checked1,
        checked2: this.big.checked2,
        revealed: this.big.revealed,
        total: this.big.total,
        total1: this.big.total1,
        total2: this.big.total2,
        result: this.big.result,
        choices1: isAdmin ? this.big.choices1 : undefined,
        choices2: isAdmin ? this.big.choices2 : undefined,
        answers1: showSecond ? this.big.answers1 : this.big.answers1.map(() => ''),
        answers2: showSecond ? this.big.answers2 : this.big.answers2.map(() => ''),
        points1: showPoints1 ? this.big.points1 : null,
        points2: showSecond ? this.big.points2 : null,
        duplicates2: showSecond ? this.big.duplicates2 : null,
        seconds1: this.big.seconds1,
        seconds2: this.big.seconds2,
        timerEndsAt: this.big.timerEndsAt,
        timerPlayer: this.big.timerPlayer
      };
    }

    let reverse = null;
    if (this.reverse) {
      const resolved = !!this.reverse.resolved;
      reverse = {
        stage: this.reverse.stage,
        choices: isAdmin ? { ...this.reverse.choices } : undefined,
        timerEndsAt: this.reverse.timerEndsAt,
        resolved,
        firstTeamId: this.reverse.firstTeamId,
        i1: resolved || isAdmin ? this.reverse.i1 : null,
        i2: resolved || isAdmin ? this.reverse.i2 : null,
        p1: resolved || isAdmin ? this.reverse.p1 : null,
        p2: resolved || isAdmin ? this.reverse.p2 : null,
        scored1: isAdmin ? !!this.reverse.scored1 : undefined,
        scored2: isAdmin ? !!this.reverse.scored2 : undefined
      };
    }

    return {
      pack: this.pack ? { title: this.pack.title, total: this.pack.rounds.length } : null,
      roundIndex: this.roundIndex,
      phase: this.phase,
      questionVisible: this.questionVisible,
      teams: this.teams,
      activeTeamId: this.activeTeamId,
      controlTeamId: this.controlTeamId,
      round,
      faceoff,
      steal,
      reverse,
      big,
      winner: this.winner,
      mainWinner: this.mainWinnerSet ? this.mainWinner : null,
      mainWinnerSet: this.mainWinnerSet,
      history: this.history,
      log: isAdmin ? this.log.slice(0, 30) : undefined,
      settings: {
        bigGameTarget: this.config.game.bigGameTarget,
        maxStrikes: this.config.game.maxStrikes,
        timers: this.config.game.timers,
        reversePointsByRank: this.config.game.reversePointsByRank,
        sound: this.config.sound
      }
    };
  }
}

module.exports = { GameEngine };
