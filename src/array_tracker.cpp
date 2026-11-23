#include "array_tracker.h"

#include <string.h>

static int popCount(unsigned v) {
  int c = 0;
  while (v) {
    c += (int)(v & 1u);
    v >>= 1;
  }
  return c;
}

ArrayTracker::ArrayTracker(ArrayRf* rf, int numReaders)
    : rf_(rf), n_(numReaders > MAX_READERS ? MAX_READERS : numReaders) {
  reset();
}

void ArrayTracker::reset() {
  memset(obs_, 0, sizeof(obs_));
  memset(lastSeq_, 0, sizeof(lastSeq_));
  memset(present_, 0, sizeof(present_));
  memset(uids_, 0, sizeof(uids_));
  memset(&arb_, 0, sizeof(arb_));
  seq_ = 0;
  next_ = 0;
  qHead_ = 0;
  qCount_ = 0;
  noteHead_ = 0;
  noteCount_ = 0;
  scans_ = 0;
  arbitrations_ = 0;
  rfOps_ = 0;
  verdicts_ = 0;
  memset(&lastVerdict_, 0, sizeof(lastVerdict_));
  memset(garbled_, 0, sizeof(garbled_));
  memset(clean_, 0, sizeof(clean_));
  memset(burst_, 0, sizeof(burst_));
  memset(quickTurn_, 0, sizeof(quickTurn_));
  memset(stats_, 0, sizeof(stats_));
  memset(&rescue_, 0, sizeof(rescue_));
  memset(recent_, 0, sizeof(recent_));
  recentCount_ = 0;
  memset(guessIdx_, 0, sizeof(guessIdx_));
  rescued_ = 0;
  lastRfMs_ = 0;
  haveRf_ = false;
}

void ArrayTracker::forgetMisses() {
  for (int r = 0; r < n_; r++) {
    for (int k = 0; k < MAX_OBS; k++) {
      Obs& o = obs_[r][k];
      if (o.used && o.miss > 0) o.miss = 0;
    }
  }
}

// ------------------------------------------------------------
// 記録の検索
// ------------------------------------------------------------
bool ArrayTracker::same(const TagUid& a, const TagUid& b) {
  return a.size == b.size && memcmp(a.bytes, b.bytes, a.size) == 0;
}

ArrayTracker::Obs* ArrayTracker::findObs(int reader, const TagUid& u) {
  for (int k = 0; k < MAX_OBS; k++) {
    Obs& o = obs_[reader][k];
    if (o.used && same(o.uid, u)) return &o;
  }
  return nullptr;
}

const ArrayTracker::Obs* ArrayTracker::findObs(int reader, const TagUid& u) const {
  for (int k = 0; k < MAX_OBS; k++) {
    const Obs& o = obs_[reader][k];
    if (o.used && same(o.uid, u)) return &o;
  }
  return nullptr;
}

int ArrayTracker::ownerIndex(int reader) const {
  for (int k = 0; k < MAX_OBS; k++) {
    if (obs_[reader][k].used && obs_[reader][k].role == ROLE_OWNER) return k;
  }
  return -1;
}

ArrayTracker::Obs* ArrayTracker::freeObs(int reader) {
  for (int k = 0; k < MAX_OBS; k++) {
    if (!obs_[reader][k].used) return &obs_[reader][k];
  }
  // 空きがなければ、いま読めなくなっている「持ち主でない記録」を1つ捨てる
  for (int k = 0; k < MAX_OBS; k++) {
    Obs& o = obs_[reader][k];
    if (o.role != ROLE_OWNER && o.miss > 0) {
      o.used = false;
      return &o;
    }
  }
  return nullptr;
}

void ArrayTracker::wakeWaiters(int reader) {
  for (int k = 0; k < MAX_OBS; k++) {
    Obs& o = obs_[reader][k];
    if (o.used && o.role == ROLE_WAIT) {
      o.role = ROLE_NEW;
      o.born = seq_;
    }
  }
}

int ArrayTracker::shadowOwner(int reader) const {
  if (reader < 0 || reader >= n_) return -1;
  for (int k = 0; k < MAX_OBS; k++) {
    const Obs& o = obs_[reader][k];
    if (!o.used || o.role != ROLE_SHADOW || o.miss != 0) continue;
    for (int r = 0; r < n_; r++) {
      const Obs* p = findObs(r, o.uid);
      if (p != nullptr && p->role == ROLE_OWNER) return r;
    }
  }
  return -1;
}

bool ArrayTracker::busy() const {
  if (arb_.active || rescue_.active || qCount_ > 0) return true;
  for (int r = 0; r < n_; r++) {
    for (int k = 0; k < MAX_OBS; k++) {
      const Obs& o = obs_[r][k];
      if (!o.used) continue;
      if (o.role == ROLE_NEW) return true;                     // 新しく見えた駒の確認中
      if (o.role == ROLE_OWNER && o.miss > 0) return true;     // 持ち主の駒が読めなくなった: 外れたかどうか、確かめ中
    }
  }
  return false;
}

bool ArrayTracker::consistent() const {
  if (qCount_ != 0) return true;
  for (int r = 0; r < n_; r++) {
    int owners = 0;
    for (int k = 0; k < MAX_OBS; k++) {
      if (obs_[r][k].used && obs_[r][k].role == ROLE_OWNER) owners++;
    }
    if (owners > 1) return false;            // 1つのリーダーに、持ち主の駒が2枚
    int k = ownerIndex(r);
    if ((k >= 0) != present_[r]) return false;
    if (k >= 0 && !same(obs_[r][k].uid, uids_[r])) return false;
    // 同じ駒の持ち主が、ほかのリーダーにもいないか
    for (int r2 = r + 1; r2 < n_; r2++) {
      int k2 = ownerIndex(r2);
      if (k >= 0 && k2 >= 0 && same(obs_[r][k].uid, obs_[r2][k2].uid)) return false;
    }
  }
  return true;
}

// ------------------------------------------------------------
// イベント
// ------------------------------------------------------------
void ArrayTracker::pushNote(ReaderEventType type, int reader, const TagUid& uid, EventCause cause, uint8_t miss, uint32_t missMs) {
  // 原因の記録（診断用）。あふれたら、古いほうを捨てる
  if (noteCount_ >= QUEUE_SIZE) {
    noteHead_ = (noteHead_ + 1) % QUEUE_SIZE;
    noteCount_--;
  }
  EventNote& n = notes_[(noteHead_ + noteCount_) % QUEUE_SIZE];
  n.type = type;
  n.reader = (int8_t)reader;
  n.uid = uid;
  n.cause = cause;
  n.miss = miss;
  n.missMs = missMs;
  noteCount_++;
}

void ArrayTracker::enqueue(ReaderEventType type, int reader, const TagUid& uid, EventCause cause, uint8_t miss, uint32_t missMs) {
  pushNote(type, reader, uid, cause, miss, missMs);
  if (qCount_ >= QUEUE_SIZE) return;   // いっぱい（ふつうは起きない。1回の判定で出るイベントは3つまで）
  ReaderEvent& e = queue_[(qHead_ + qCount_) % QUEUE_SIZE];
  e.type = type;
  e.reader = reader;
  e.uid = uid;
  qCount_++;
}

bool ArrayTracker::takeNote(EventNote* out) {
  if (noteCount_ == 0) return false;
  *out = notes_[noteHead_];
  noteHead_ = (noteHead_ + 1) % QUEUE_SIZE;
  noteCount_--;
  return true;
}

// 渡すときに、「知らせ済みの状態」を更新する（盤面は、知らせたイベントと同じ状態を見る）
bool ArrayTracker::popEvent(ReaderEvent* event) {
  if (qCount_ == 0) return false;
  *event = queue_[qHead_];
  qHead_ = (qHead_ + 1) % QUEUE_SIZE;
  qCount_--;
  switch (event->type) {
    case READER_EVENT_PLACED:
    case READER_EVENT_CHANGED:
      present_[event->reader] = true;
      uids_[event->reader] = event->uid;
      break;
    case READER_EVENT_REMOVED:
      present_[event->reader] = false;
      break;
  }
  return true;
}

// ------------------------------------------------------------
// 1回の巡回読み取り（標準の感度）
// ------------------------------------------------------------
bool ArrayTracker::probe(int reader, int level, int sub, const TagUid& u) {
  TagUid tmp[MAX_SCAN];
  rf_->hint(reader, &u, true); // 探す駒の UID が分かっているので、直接呼びかける（読めるかだけを見る。ほかの駒は探さない）
  int cnt = rf_->scan(reader, level, sub, tmp, MAX_SCAN);
  rfOps_++;
  if (cnt < 0) return false;   // 返事はあったのに読めなかった: この感度では読めなかったものとして扱う（比べ読みの点にならない）
  if (cnt > MAX_SCAN) cnt = MAX_SCAN;
  for (int i = 0; i < cnt; i++) {
    if (same(tmp[i], u)) return true;
  }
  return false;
}

void ArrayTracker::scanNext() {
  int q = -1;
  for (int k = 0; k < n_; k++) {
    int c = (next_ + k) % n_;
    if (rf_->alive(c)) {
      q = c;
      break;
    }
  }
  if (q < 0) return;   // 応答するリーダーがない
  next_ = (q + 1) % n_;

  TagUid found[MAX_SCAN];
  // 持ち主の駒の UID を教える（直接呼びかけて、確かめられる）。持ち主がいなくて、衝突回避が失敗し続けているリーダーは、候補の UID を1つ教える
  TagUid guess;
  bool guessing = false;
  {
    int ok = ownerIndex(q);
    const TagUid* h = ok >= 0 ? &obs_[q][ok].uid : nullptr;
    if (h == nullptr && garbled_[q] > 0 && pickGuess(q, &guess)) { h = &guess; guessing = true; }
    bool confirm = false;   // 持ち主の確認は、ふだんは確かめるだけ（ほかの駒を探す待ち時間を省く）。FULL_SCAN_EVERY 回に1回は、ふつうに読む（隣の駒・滑らせた駒を見つけるため）
    if (h != nullptr && !guessing) {
      bool onlyOwner = true;   // このリーダーで、判定の途中の駒（新しく見えた駒・影）があるときは、ふつうに読む（確かめるだけにすると、その駒の記録が途切れる）
      for (int k = 0; k < MAX_OBS; k++) if (obs_[q][k].used && k != ok) onlyOwner = false;
      if (!onlyOwner) quickTurn_[q] = 0;
      else if (++quickTurn_[q] >= FULL_SCAN_EVERY) quickTurn_[q] = 0;
      else confirm = true;
    }
    rf_->hint(q, h, confirm);
  }
  int cnt = rf_->scan(q, -1, 0, found, MAX_SCAN);
  rfOps_++;
  scans_++;
  if (guessing) {
    stats_[q].guesses++;
    for (int j = 0; j < cnt && j < MAX_SCAN; j++) if (same(found[j], guess)) { stats_[q].guessHits++; break; }
  }
  if (cnt < 0) {   // 返事はあったのに、読めなかった（電波の乱れ・衝突）。駒が、ある・ないは、分からない → 数えない
    stats_[q].garbled++;
    if (garbled_[q] < 255) garbled_[q]++;
    if (garbled_[q] == 1) burst_[q] = clean_[q] >= BURST_MIN_CLEAN;   // 「読めない」が始まったとき: 直前まで、きれいに読めていたなら、置かれたばかりらしい
    clean_[q] = 0;
    if (burst_[q] && garbled_[q] <= GUESS_BURST) next_ = q;   // 続けて、同じリーダーを読む（候補を、次々に試す）。何回かで、ふつうの巡回にもどる
    if (garbled_[q] < GARBLED_LIMIT) return;     // 持ち主の記録も、確認の周回も、そのまま（この読み取りは、なかったことにする）
    cnt = 0;   // あまりに長く続くときは、読めなかったものとして数える
  } else {
    if (garbled_[q] >= 3) {   // 乱れが続いていたのが、おさまった: 診断用に記録する
      TagUid none;
      memset(&none, 0, sizeof(none));
      pushNote(READER_EVENT_CHANGED, q, none, CAUSE_GARBLED, garbled_[q], 0);
    }
    garbled_[q] = 0;
    if (clean_[q] < 255) clean_[q]++;
  }
  if (cnt > MAX_SCAN) cnt = MAX_SCAN;
  uint32_t now = rf_->nowMs();
  seq_++;
  lastSeq_[q] = seq_;

  bool seen[MAX_SCAN];
  for (int j = 0; j < MAX_SCAN; j++) seen[j] = false;

  // すでに覚えている駒: 読めたか、読めなかったか
  for (int k = 0; k < MAX_OBS; k++) {
    Obs& o = obs_[q][k];
    if (!o.used) continue;
    int hit = -1;
    for (int j = 0; j < cnt; j++) {
      if (same(found[j], o.uid)) {
        hit = j;
        break;
      }
    }
    if (hit >= 0) {
      seen[hit] = true;
      if (o.role == ROLE_OWNER) {
        stats_[q].hits++;
        if (o.miss > 0) {   // 読めなくなっていた持ち主の駒が、「外れた」と決める前に、また読めた（猶予で、ちらつきを吸収した）
          uint32_t ms = (uint32_t)(now - o.missSince);
          stats_[q].absorbed++;
          if (ms > stats_[q].longestMs) stats_[q].longestMs = ms;
          if (o.miss >= RESCUE_AT_MISS) pushNote(READER_EVENT_CHANGED, q, o.uid, CAUSE_ABSORBED, o.miss, ms);
        }
      }
      // 持ち主の駒が、2回以上続けて読めなくなったあとで戻ってきた: 持ち上げて、置き直したのかもしれない。
      // 隣のリーダーが影として読んでいる駒なら、置き直した先が隣かもしれないので、持ち主をすぐ確かめ直す
      if (o.role == ROLE_OWNER && o.miss >= 2) o.suspect = true;
      // 持ち主が決まっていない駒が、いったん読めなくなってから、また見えた: 新しく見えたのと同じなので、確認の周回をやり直す
      // （前の周回の記録のまま決めると、本当の持ち主のリーダーが、まだこの駒を読み直していないのに、隣のリーダーに決めてしまう）
      if (o.role == ROLE_NEW && o.miss > 0) o.born = seq_;
      o.miss = 0;
    } else {
      if (o.role == ROLE_OWNER) stats_[q].misses++;
      if (o.miss == 0) o.missSince = now;
      if (o.miss < 255) o.miss++;
    }
  }

  // 新しく見えた駒: まだ持ち主かどうか決めない（ほかのリーダーが全員読まれたあとで決める）
  for (int j = 0; j < cnt; j++) {
    if (seen[j]) continue;
    Obs* o = freeObs(q);
    if (o == nullptr) continue;   // 覚える場所がない（ふつうは起きない）
    o->used = true;
    o->role = ROLE_NEW;
    o->uid = found[j];
    o->miss = 0;
    o->missSince = 0;
    o->born = seq_;
    o->checkedAt = now;
    o->suspect = false;
    o->tied = false;
  }

  // 読めなくなった駒を片づける
  bool quickRetry = false;
  for (int k = 0; k < MAX_OBS; k++) {
    Obs& o = obs_[q][k];
    if (!o.used || o.miss == 0) continue;
    if (o.role == ROLE_OWNER) {
      if (o.miss >= MISS_LIMIT && (uint32_t)(now - o.missSince) >= MISS_MIN_MS) {
        // 外れたと決める前の、最後の確かめ: 高い感度で読み直して、読めなければ「外れた」にする（stepRescue の中で）
        if (!rescue_.active) startRescue(q, o, true);
      } else {
        if (o.miss == RESCUE_AT_MISS && !rescue_.active) startRescue(q, o, false);   // 早めの救済
        if (o.miss < QUICK_RETRY) quickRetry = true;
      }
    } else if (o.miss >= SHADOW_MISS_LIMIT) {
      dropObs(q, k, 0, 0);
    }
  }
  // 1回読めなかっただけなら、次の周回を待たず、同じリーダーを、すぐ読み直す（2回目以降は、ふつうの巡回。ほかのリーダーを待たせない）
  if (quickRetry) next_ = q;
}

// この駒を、いま、どこかのリーダーが持ち主として持っているか
bool ArrayTracker::ownedAnywhere(const TagUid& u) const {
  for (int r = 0; r < n_; r++) {
    for (int k = 0; k < MAX_OBS; k++) {
      const Obs& o = obs_[r][k];
      if (o.used && o.role == ROLE_OWNER && same(o.uid, u)) return true;
    }
  }
  return false;
}

// 持ち主のいないリーダー reader に、いま載ったはずの駒の候補を、1つ選ぶ。
//   最近外れた駒（置き直されることが多い）→ 登録済みの駒、の順に、読み取りごとに1つずつ進める。
//   すでに、ほかのリーダーの持ち主になっている駒は、候補にしない（同時に2か所には、ない）
bool ArrayTracker::pickGuess(int reader, TagUid* out) {
  int known = rf_->knownCount();
  int total = recentCount_ + known;
  if (total <= 0) return false;
  for (int tries = 0; tries < total; tries++) {
    int i = (int)(guessIdx_[reader] % (uint8_t)(total > 255 ? 255 : total));
    guessIdx_[reader] = (uint8_t)(guessIdx_[reader] + 1);
    TagUid cand;
    memset(&cand, 0, sizeof(cand));
    if (i < recentCount_) cand = recent_[i];
    else if (!rf_->knownAt(i - recentCount_, &cand)) continue;
    if (cand.size == 0 || ownedAnywhere(cand)) continue;
    *out = cand;
    return true;
  }
  return false;
}

bool ArrayTracker::forgetOwner(int reader, TagUid* uidOut) {
  if (reader < 0 || reader >= n_) return false;
  int k = ownerIndex(reader);
  if (k < 0) return false;
  if (uidOut != nullptr) *uidOut = obs_[reader][k].uid;
  obs_[reader][k].used = false;
  present_[reader] = false;
  garbled_[reader] = 0;
  return true;
}

// ------------------------------------------------------------
// 救済: 持ち主の駒が読めなくなったとき、高い感度で読み直す（電波が弱くて、受信が追いつかないだけなら、これで読める）
// ------------------------------------------------------------
void ArrayTracker::startRescue(int reader, const Obs& o, bool last) {
  int avail = rf_->levelCount() - 1 - rf_->defaultLevel();    // 標準より上の段の数
  if (avail <= 0) {
    if (last) {   // 試せる段がない: そのまま「外れた」にする
      for (int k = 0; k < MAX_OBS; k++) {
        if (obs_[reader][k].used && obs_[reader][k].role == ROLE_OWNER && same(obs_[reader][k].uid, o.uid)) {
          dropObs(reader, k, o.miss, (uint32_t)(rf_->nowMs() - o.missSince));
          break;
        }
      }
    }
    return;
  }
  rescue_.active = true;
  rescue_.last = last;
  rescue_.reader = (int8_t)reader;
  rescue_.uid = o.uid;
  rescue_.step = 0;
}

void ArrayTracker::stepRescue() {
  Rescue& r = rescue_;
  int reader = r.reader;
  int k = -1;
  for (int j = 0; j < MAX_OBS; j++) {
    if (obs_[reader][j].used && obs_[reader][j].role == ROLE_OWNER && same(obs_[reader][j].uid, r.uid)) k = j;
  }
  if (k < 0 || obs_[reader][k].miss == 0) {   // そのあいだに、持ち主でなくなった・標準の感度で読めた
    r.active = false;
    return;
  }
  Obs& o = obs_[reader][k];
  int avail = rf_->levelCount() - 1 - rf_->defaultLevel();
  int probes = avail < (int)RESCUE_PROBES ? avail : (int)RESCUE_PROBES;
  int level = rf_->levelCount() - 1 - (int)r.step;    // 一番高い感度から順に
  bool hit = probe(reader, level, 0, r.uid);
  stats_[reader].rescueTries++;
  r.step++;
  uint32_t now = rf_->nowMs();
  if (hit) {   // 高い感度なら読めた: 駒はある。読めなかった数え方を、最初からやり直す
    uint32_t ms = (uint32_t)(now - o.missSince);
    stats_[reader].rescued++;
    rescued_++;
    pushNote(READER_EVENT_CHANGED, reader, o.uid, CAUSE_RESCUED, o.miss, ms);
    if (o.miss >= 2) o.suspect = true;
    o.miss = 0;
    o.missSince = 0;
    r.active = false;
    return;
  }
  if (r.step >= probes) {
    r.active = false;
    if (r.last) dropObs(reader, k, o.miss, (uint32_t)(now - o.missSince));   // どの感度でも読めない: 外された
  }
}

void ArrayTracker::dropObs(int reader, int k, uint8_t miss, uint32_t missMs) {
  if (obs_[reader][k].role == ROLE_OWNER) {
    releaseOwner(reader, k, true, miss, missMs);
  } else {
    obs_[reader][k].used = false;
  }
}

// 持ち主の記録を消す。emitRemoved が true なら、「外れた」を知らせる（原因は、続けて読めなくなったこと）
void ArrayTracker::releaseOwner(int reader, int k, bool emitRemoved, uint8_t miss, uint32_t missMs) {
  TagUid u = obs_[reader][k].uid;
  {   // 最近外れた駒を覚えておく（新しいものが先頭。同じ駒は、1つにまとめる）
    int at = -1;
    for (int i = 0; i < recentCount_; i++) if (same(recent_[i], u)) { at = i; break; }
    if (at < 0) { at = recentCount_ < RECENT_N ? recentCount_++ : RECENT_N - 1; }
    for (int i = at; i > 0; i--) recent_[i] = recent_[i - 1];
    recent_[0] = u;
  }
  if (emitRemoved) {
    stats_[reader].removedByMiss++;
    enqueue(READER_EVENT_REMOVED, reader, u, CAUSE_MISS, miss, missMs);
  }
  obs_[reader][k].used = false;
  // この駒の影だった記録は、持ち主がいなくなったので、確かめ直す（本当に、その隣へ移ってきたのかもしれない）
  for (int r = 0; r < n_; r++) {
    for (int j = 0; j < MAX_OBS; j++) {
      Obs& p = obs_[r][j];
      if (p.used && p.role == ROLE_SHADOW && same(p.uid, u)) {
        p.role = ROLE_NEW;
        p.born = seq_;
      }
    }
  }
  wakeWaiters(reader);
}

// ------------------------------------------------------------
// 持ち主を決める
// ------------------------------------------------------------

// 駒 u を、最初に読んだ読み取りより後に、応答するリーダーが全員（その駒を最初に読んだリーダーも）1回ずつ読まれたか。
// 「最初に読んだ」のは、いま読めている記録（miss が 0）だけで数える。読めなくなっている古い記録を基準にすると、
// 駒を持ち上げて置き直したときに、隣のリーダーが先に読んだだけで、本当の持ち主のリーダーを待たずに決めてしまう
bool ArrayTracker::probationDone(const TagUid& u) const {
  bool any = false;
  uint32_t earliest = 0;
  for (int r = 0; r < n_; r++) {
    for (int k = 0; k < MAX_OBS; k++) {
      const Obs& o = obs_[r][k];
      if (!o.used || o.role != ROLE_NEW || o.miss != 0 || !same(o.uid, u)) continue;
      if (!any || o.born < earliest) earliest = o.born;
      any = true;
    }
  }
  if (!any) return false;
  for (int r = 0; r < n_; r++) {
    if (rf_->alive(r) && lastSeq_[r] <= earliest) return false;
  }
  return true;
}

bool ArrayTracker::hasActiveShadow(const TagUid& u) const {
  for (int r = 0; r < n_; r++) {
    for (int k = 0; k < MAX_OBS; k++) {
      const Obs& o = obs_[r][k];
      if (o.used && o.role == ROLE_SHADOW && o.miss == 0 && same(o.uid, u)) return true;
    }
  }
  return false;
}

// 判定が必要な駒を探して、判定を始める（競争相手がいなければ、RF を使わずに決める）
void ArrayTracker::beginPending() {
  // 1. 新しく見えた駒
  for (int r = 0; r < n_; r++) {
    for (int k = 0; k < MAX_OBS; k++) {
      Obs& o = obs_[r][k];
      if (!o.used || o.role != ROLE_NEW || o.miss != 0) continue;
      TagUid u = o.uid;
      if (!probationDone(u)) continue;
      decide(u, false);
      return;
    }
  }
  // 2. 影のリーダーがいるときは、ときどき（駒が動かされたかもしれないときは、すぐ）持ち主を確かめ直す
  uint32_t now = rf_->nowMs();
  for (int r = 0; r < n_; r++) {
    for (int k = 0; k < MAX_OBS; k++) {
      Obs& o = obs_[r][k];
      if (!o.used || o.role != ROLE_OWNER || o.miss != 0) continue;
      if (!o.suspect && (uint32_t)(now - o.checkedAt) < RECHECK_MS) continue;
      o.suspect = false;
      o.checkedAt = now;
      TagUid u = o.uid;
      if (!hasActiveShadow(u)) continue;
      decide(u, true);
      return;
    }
  }
}

// 駒 u を読んでいるリーダーの中から、持ち主を決める
void ArrayTracker::decide(const TagUid& u, bool recheck) {
  Arb& a = arb_;
  memset(&a, 0, sizeof(a));
  a.u = u;
  a.recheck = recheck;
  a.fineWinner = -1;
  a.incumbent = -1;
  for (int r = 0; r < n_; r++) {
    Obs* o = findObs(r, u);
    if (o == nullptr) continue;
    bool take = false;
    if (o->role == ROLE_OWNER) {
      take = true;   // いまの持ち主は、読めなくなっていても候補に入れる（本当にいなくなったかは、比べ読みで分かる）
      a.incumbent = (int8_t)r;
    } else if ((o->role == ROLE_NEW || o->role == ROLE_SHADOW) && o->miss == 0) {
      take = true;   // 影と決めたリーダーも、状況が変わったので、もう一度候補に入れる
    }
    if (take) a.cand[a.n++] = (int8_t)r;
  }
  if (a.n == 0) return;
  if (a.n == 1) {   // 競争相手がいない: 比べ読みはいらない
    finishArbitration();
    return;
  }
  int top = rf_->defaultLevel() + 1;   // 標準の感度の、1つ上の段まで調べる
  if (top > rf_->levelCount() - 1) top = rf_->levelCount() - 1;
  if (top < 0) top = 0;
  a.active = true;
  a.stage = ARB_ASC;
  a.level = 0;
  a.top = (uint8_t)top;
  arbitrations_++;
}

// 比べ読みを1回進める（RF の読み取り1回）
void ArrayTracker::stepArbitration() {
  Arb& a = arb_;
  if (a.stage == ARB_FINE || a.stage == ARB_FINE_CONFIRM) {
    stepFine();
    return;
  }
  int level = a.level;
  int weight = 1;
  if (a.stage == ARB_CONFIRM) {
    level = a.foundLevel;
  } else if (a.stage == ARB_EXTRA) {
    if (a.pass < EXTRA_PASSES) {
      level = a.foundLevel;
    } else {
      level = a.foundLevel - 1;   // 1つ下の段で読めるのは、より近い証拠なので、2点
      weight = 2;
    }
  }
  if (probe(a.cand[a.idx], level, 0, a.u)) {
    a.mask |= (uint8_t)(1u << a.idx);
    a.score[a.idx] = (uint8_t)(a.score[a.idx] + weight);
  }
  a.idx++;
  if (a.idx < a.n) return;

  // 候補を全員、1回ずつ読み終えた
  uint8_t mask = a.mask;
  a.mask = 0;
  a.idx = 0;
  switch (a.stage) {
    case ARB_ASC:
      if (mask != 0) {   // この段で、はじめて読めた
        a.found = true;
        a.foundLevel = a.level;
        a.firstMask = mask;
        if (popCount(mask) >= 2 && a.level >= 1) {   // 同じ段で複数が読めた: 受信のしきい値を細かく動かして見分ける
          a.stage = ARB_FINE;
          a.fineMask = mask;
          a.fineSub = 1;
          a.fineRan = true;
        } else {
          a.stage = ARB_CONFIRM;
        }
        return;
      }
      if (a.level >= a.top) {   // 上の段まで調べても、誰も読めなかった: 決め手がない（いまの持ち主、なければ先に見つけたほう）
        finishArbitration();
        return;
      }
      a.level++;
      return;
    case ARB_CONFIRM:
      if (mask == a.firstMask && popCount(mask) == 1) {   // 同じ1人だけが、2回続けて読めた
        finishArbitration();
        return;
      }
      a.stage = ARB_EXTRA;   // 結果が割れた: 何回か読んで、読めた回数で決める
      a.pass = 0;
      return;
    case ARB_EXTRA: {
      a.pass++;
      int total = (a.foundLevel > 0) ? 2 * EXTRA_PASSES : EXTRA_PASSES;
      if (a.pass >= total) finishArbitration();
      return;
    }
    default:   // ARB_FINE・ARB_FINE_CONFIRM は、stepFine() が扱う
      return;
  }
}

// 細かい比べを1回進める（RF の読み取り1回）。
//   同じ段 L で複数のリーダーが読めたとき、1つ下の段 L-1 で、受信のしきい値（MinLevel）を標準の 8 から少しずつ下げていく。
//   駒に近いリーダーほど信号が強いので、しきい値が高いうち（感度が低いうち）から読める。先に読めたリーダーを持ち主にする。
//   （2026-10-19 の実機: 駒をリーダー7 に置くと、リーダー6 も 33dB で同じように読めたが、23dB でしきい値を 5 まで下げると、
//     リーダー7 だけが読めた。リーダー6 は 3 まで下げないと読めなかった）
void ArrayTracker::stepFine() {
  Arb& a = arb_;
  while (a.idx < a.n && !(a.fineMask & (1u << a.idx))) a.idx++;
  if (a.idx < a.n) {
    if (probe(a.cand[a.idx], a.foundLevel - 1, a.fineSub, a.u)) a.mask |= (uint8_t)(1u << a.idx);
    a.idx++;
    while (a.idx < a.n && !(a.fineMask & (1u << a.idx))) a.idx++;
    if (a.idx < a.n) return;   // この条件で、まだ読む候補が残っている
  }
  // 対象の候補を全員、この条件で1回ずつ読み終えた
  uint8_t mask = a.mask;
  a.mask = 0;
  a.idx = 0;
  if (a.stage == ARB_FINE_CONFIRM) {
    if (mask == a.fineHit && popCount(mask) == 1) {   // 同じ1人だけが、2回続けて読めた: 決まり
      int w = 0;
      while (!(mask & (1u << w))) w++;
      a.fineWinner = (int8_t)w;
      a.fineWinSub = a.fineSub;
      a.score[w] = (uint8_t)(a.score[w] + 20);   // 細かい比べの勝ちは、ほかの得点より重い
      finishArbitration();
      return;
    }
    a.stage = ARB_FINE;   // 確かめで割れた: もう少し感度を上げて続ける
  } else if (mask != 0) {
    if (popCount(mask) >= 2) {   // 全員読めた: この細かさでは、決め手がない
      a.stage = ARB_EXTRA;
      a.pass = 0;
      return;
    }
    a.fineHit = mask;            // 1人だけ読めた: 同じ条件でもう一度読んで確かめる
    a.stage = ARB_FINE_CONFIRM;
    return;
  }
  a.fineSub++;
  if (a.fineSub > FINE_MAX_SUB) {   // しきい値を下げ切っても、決まらなかった
    a.stage = ARB_EXTRA;
    a.pass = 0;
  }
}

// 候補 i が、候補 j より有力か。得点が高いほう。同点なら、いまの持ち主、次に先に見つけたほう、最後にリーダー番号の小さいほう
bool ArrayTracker::better(int i, int j) const {
  const Arb& a = arb_;
  if (a.score[i] != a.score[j]) return a.score[i] > a.score[j];
  if (a.cand[i] == a.incumbent) return true;
  if (a.cand[j] == a.incumbent) return false;
  const Obs* oi = findObs(a.cand[i], a.u);
  const Obs* oj = findObs(a.cand[j], a.u);
  if (oi != nullptr && oj != nullptr && oi->born != oj->born) return oi->born < oj->born;
  return a.cand[i] < a.cand[j];
}

// リーダー reader の持ち主 v（occ 番目の記録）に、判定が同点だった別のリーダーへ移ってもらって、場所を空ける。移れたら true
bool ArrayTracker::tryBump(int reader, int occ) {
  Obs& ob = obs_[reader][occ];
  TagUid v = ob.uid;
  for (int x = 0; x < n_; x++) {
    if (x == reader) continue;
    Obs* ax = findObs(x, v);
    if (ax == nullptr || ax->role != ROLE_SHADOW || !ax->tied || ax->miss != 0) continue;
    if (ownerIndex(x) >= 0) continue;   // そちらにも、別の駒が載っている
    enqueue(READER_EVENT_REMOVED, reader, v, CAUSE_BUMP_OUT);
    ob.role = ROLE_SHADOW;
    ax->role = ROLE_OWNER;
    ax->checkedAt = rf_->nowMs();
    enqueue(READER_EVENT_PLACED, x, v, CAUSE_BUMP_IN);
    return true;
  }
  return false;
}

void ArrayTracker::finishArbitration() {
  arb_.active = false;
  applyVerdict();
}

// 比べ読みの結果を、記録とイベントに反映する
//   候補を有力な順に並べて、上から順に、持ち主になれるリーダーを探す。
//   別の駒が（読めている状態で）載っているリーダーは、持ち主になれない（1つのリーダーに載せられる駒は1枚）。
void ArrayTracker::applyVerdict() {
  const Arb& a = arb_;
  TagUid u = a.u;
  uint32_t now = rf_->nowMs();

  int order[MAX_READERS];
  for (int i = 0; i < a.n; i++) order[i] = i;
  for (int i = 1; i < a.n; i++) {
    int x = order[i];
    int j = i - 1;
    while (j >= 0 && better(x, order[j])) {
      order[j + 1] = order[j];
      j--;
    }
    order[j + 1] = x;
  }

  // 確かめた時刻を残す（同じ判定を何度も繰り返さない）。一番有力な候補と同点だった候補には、印をつける
  int topScore = a.score[order[0]];
  int tiedCount = 0;
  for (int i = 0; i < a.n; i++) {
    if (a.score[i] == topScore) tiedCount++;
  }
  for (int i = 0; i < a.n; i++) {
    Obs* o = findObs(a.cand[i], u);
    if (o == nullptr) continue;
    if (o->role == ROLE_OWNER) o->checkedAt = now;
    o->suspect = false;
    o->tied = tiedCount >= 2 && a.score[i] == topScore;
  }

  int chosen = -1;      // order の何番目が持ち主になるか
  bool stale = false;   // 持ち主になるリーダーに、読めなくなった古い駒が残っている（入れ替わり）
  int staleIdx = -1;
  for (int p = 0; p < a.n; p++) {
    int r = a.cand[order[p]];
    Obs* oc = findObs(r, u);
    if (oc == nullptr) continue;
    int occ = ownerIndex(r);
    if (oc->role == ROLE_OWNER || occ < 0) {
      chosen = p;
      break;
    }
    if (obs_[r][occ].miss > 0) {
      chosen = p;
      stale = true;
      staleIdx = occ;
      break;
    }
    // 別の駒 v が載っている。v の持ち主の判定が同点だった（決め手がなかった）なら、v には同点の別のリーダーへ移ってもらう
    if (obs_[r][occ].tied && tryBump(r, occ)) {
      chosen = p;
      break;
    }
  }
  if (a.n >= 2) {   // 診断用の記録（比べ読みをしたときだけ）
    VerdictInfo& v = lastVerdict_;
    memset(&v, 0, sizeof(v));
    v.uid = u;
    v.n = a.n;
    for (int i = 0; i < a.n; i++) {
      v.reader[i] = a.cand[order[i]];
      v.score[i] = a.score[order[i]];
    }
    v.foundLevel = a.found ? (int8_t)a.foundLevel : (int8_t)-1;
    v.winner = chosen >= 0 ? a.cand[order[chosen]] : (int8_t)-1;
    v.recheck = a.recheck;
    v.fineRan = a.fineRan;
    v.fineSub = a.fineWinner >= 0 ? (int8_t)a.fineWinSub : (int8_t)0;
    v.fineWinner = a.fineWinner >= 0 ? a.cand[a.fineWinner] : (int8_t)-1;
    verdicts_++;
  }
  if (chosen < 0) {
    // どの候補も、別の駒に邪魔されている: 場所が空くのを待つ
    for (int i = 0; i < a.n; i++) {
      Obs* o = findObs(a.cand[i], u);
      if (o != nullptr) o->role = ROLE_WAIT;
    }
    return;
  }

  int winner = a.cand[order[chosen]];
  Obs* w = findObs(winner, u);

  // 2枚がお互いの場所へ移っていて、どちらも相手に邪魔されているなら、場所を交換する。
  // （放っておくと、どちらも場所が空くのを待ったまま、ずっと間違った状態が続く）
  if (w->role == ROLE_OWNER) {
    for (int p = 0; p < chosen; p++) {
      int blockedReader = a.cand[order[p]];
      int occ = ownerIndex(blockedReader);
      if (occ < 0) continue;
      Obs& vo = obs_[blockedReader][occ];
      if (vo.miss != 0 || same(vo.uid, u)) continue;
      TagUid v = vo.uid;
      Obs* vWait = findObs(winner, v);
      Obs* uAtBlocked = findObs(blockedReader, u);
      if (vWait == nullptr || uAtBlocked == nullptr || vWait->role != ROLE_WAIT || vWait->miss != 0) continue;
      enqueue(READER_EVENT_REMOVED, winner, u, CAUSE_SWAP_OUT);
      enqueue(READER_EVENT_REMOVED, blockedReader, v, CAUSE_SWAP_OUT);
      w->role = ROLE_SHADOW;
      vo.role = ROLE_SHADOW;
      uAtBlocked->role = ROLE_OWNER;
      uAtBlocked->checkedAt = now;
      vWait->role = ROLE_OWNER;
      vWait->checkedAt = now;
      enqueue(READER_EVENT_PLACED, blockedReader, u, CAUSE_SWAP_IN);
      enqueue(READER_EVENT_PLACED, winner, v, CAUSE_SWAP_IN);
      for (int i = 0; i < a.n; i++) {   // u のほかの候補は、影にする
        Obs* o = findObs(a.cand[i], u);
        if (o != nullptr && o->role != ROLE_OWNER) o->role = ROLE_SHADOW;
      }
      return;
    }
  }

  // ほかの候補の整理: 持ち主だったなら外れたことにして影にする。
  // 勝った候補より有力なのに、別の駒に邪魔されて持ち主になれなかった候補は、場所が空いたら確かめ直す（WAIT）。それ以外は影
  for (int p = 0; p < a.n; p++) {
    if (p == chosen) continue;
    int r = a.cand[order[p]];
    Obs* o = findObs(r, u);
    if (o == nullptr) continue;
    if (o->role == ROLE_OWNER) {
      enqueue(READER_EVENT_REMOVED, r, u, CAUSE_LOST);
      o->role = ROLE_SHADOW;
      wakeWaiters(r);
      continue;
    }
    int occ = ownerIndex(r);
    bool blocked = occ >= 0 && obs_[r][occ].miss == 0;
    o->role = (blocked && p < chosen) ? ROLE_WAIT : ROLE_SHADOW;
  }

  if (w->role != ROLE_OWNER) {
    if (stale) releaseOwner(winner, staleIdx, false, 0, 0);   // 古い駒を片づける（「外れた」は出さず、「交換された」で知らせる）
    w->role = ROLE_OWNER;
    w->checkedAt = now;
    enqueue(stale ? READER_EVENT_CHANGED : READER_EVENT_PLACED, winner, u, stale ? CAUSE_STALE : (a.n >= 2 ? CAUSE_WON : CAUSE_NEW));
  }
}

// ------------------------------------------------------------
// 1回の呼び出し
// ------------------------------------------------------------
bool ArrayTracker::poll(ReaderEvent* event) {
  if (popEvent(event)) return true;                // まだ渡していないイベントを先に渡す（RF は使わない）
  if (haveRf_ && (uint32_t)(rf_->nowMs() - lastRfMs_) > GAP_FORGET_MS) forgetMisses();   // 読み取りが止まっていた: 途中経過は、あてにならない
  uint32_t opsBefore = rfOps_;
  if (!arb_.active && !rescue_.active) beginPending();   // 新しい駒の確認が終わっていれば、持ち主を決める
  if (arb_.active) {
    stepArbitration();                             // 比べ読みを1回
  } else if (rescue_.active) {
    stepRescue();                                  // 持ち主の駒が読めなくなった: 高い感度で読み直す（1回）
  } else if (qCount_ == 0) {
    scanNext();                                    // リーダーを1台読む
  }
  if (rfOps_ != opsBefore) {                       // RF を使った: 読み取りの時刻を覚える
    lastRfMs_ = rf_->nowMs();
    haveRf_ = true;
  }
  return popEvent(event);
}
