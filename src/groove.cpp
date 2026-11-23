#include "groove.h"

#include <string.h>

#include "voicing.h"

namespace {
// これより古いティックのマスは、遅れすぎなので、音を出さない（長く止まったあとに、音が一度に出るのを防ぐ）
const uint32_t STALE_TICKS = GROOVE_TICKS_PER_SLOT;
}  // namespace

Groove::Groove(int numSteps, GrooveListener* listener, const GrooveSettings& settings)
    : numSteps_(numSteps < 1 ? 1 : (numSteps > GROOVE_MAX_STEPS ? GROOVE_MAX_STEPS : numSteps)),
      listener_(listener),
      settings_(settings),
      bpm_(BPM_DEFAULT),
      key_(KEY_C),
      octaveForTriads_(true),
      voiceLeading_(true),
      drum_(nullptr),
      backing_(nullptr),
      playing_(false),
      lastMs_(0),
      acc_(0),
      nowTick_(0),
      nextTick_(0),
      lastPlayedRoot_(-1),
      prevRootBeforeStep_(-1),
      keyDirty_(false),
      queueCount_(0),
      maxLateMs_(0) {
  memset(&cur_, 0, sizeof(cur_));
  cur_.root = -1;
  lastHit_.valid = false;
  lastHit_.shape = BK_NONE;
  lastHit_.soft = false;
  lastHit_.endTick = 0;
}

// ------------------------------------------------------------
// 時計
// ------------------------------------------------------------

// 前の時刻から、いままでに進んだ分を、ティックに足す。
// 進み = 経過ms × BPM × 48 / 60000 ティック。端数は acc_ に取っておくので、ずれが溜まらない
void Groove::advanceClock(uint32_t nowMs) {
  uint32_t dt = nowMs - lastMs_;
  if ((int32_t)dt < 0) dt = 0;  // 時計が戻ることはないはずだが、念のため
  lastMs_ = nowMs;
  uint64_t add = (uint64_t)dt * unitsPerMs() + acc_;
  nowTick_ += (uint32_t)(add / 60000u);
  acc_ = (uint32_t)(add % 60000u);
}

// targetTick のティックになるまで、あと何msか（nowMs の時点から）
uint32_t Groove::msUntilTick(uint32_t targetTick, uint32_t nowMs) const {
  uint32_t dt = nowMs - lastMs_;
  if ((int32_t)dt < 0) dt = 0;
  uint64_t units = unitsPerMs();
  uint64_t cur = (uint64_t)nowTick_ * 60000u + acc_ + (uint64_t)dt * units;
  uint64_t target = (uint64_t)targetTick * 60000u;
  if (cur >= target) return 0;
  return (uint32_t)((target - cur + units - 1) / units);
}

bool Groove::setBpm(int bpm, uint32_t nowMs) {
  if (bpm < BPM_MIN || bpm > BPM_MAX) return false;
  if (playing_) {
    update(nowMs);  // 古い BPM で、いままでの分の時間を進めてから、変える（すぐに、正確に反映される）
  }
  bpm_ = bpm;
  return true;
}

void Groove::setKey(const Key& key) {
  key_ = key;
  if (playing_) keyDirty_ = true;  // 鳴らし直しは、次の update で
}

void Groove::setBaseC(uint8_t baseC) {
  int delta = (int)baseC - (int)settings_.baseC;
  if (delta == 0) return;
  settings_.baseC = baseC;
  // 「前のコードの高さ」の記憶も、同じだけ動かす（動かさないと、記憶の高さに引き戻されて、高さの変更が打ち消される）
  if (lastPlayedRoot_ >= 0) lastPlayedRoot_ += delta;
  if (prevRootBeforeStep_ >= 0) prevRootBeforeStep_ += delta;
  if (playing_) keyDirty_ = true;  // 鳴らし直しは、次の update で
}

// ------------------------------------------------------------
// 再生・停止
// ------------------------------------------------------------

void Groove::start(uint32_t nowMs) {
  stop();  // 念のため。鳴っているものがあれば止める
  queueCount_ = 0;
  nowTick_ = 0;
  nextTick_ = 0;
  acc_ = 0;
  lastMs_ = nowMs;
  lastPlayedRoot_ = -1;
  prevRootBeforeStep_ = -1;
  lastHit_.valid = false;
  keyDirty_ = false;
  maxLateMs_ = 0;
  memset(&cur_, 0, sizeof(cur_));
  cur_.root = -1;
  playing_ = true;
  processDue();  // ティック0（位置1の先頭）
}

void Groove::stop() {
  if (!playing_) return;
  // 予定している「止める」指示を、すぐに全部出す（鳴りっぱなしの音を残さない）
  MidiEvent batch[GROOVE_QUEUE_SIZE];
  int n = 0;
  for (int i = 0; i < queueCount_; i++) {
    if (!queue_[i].ev.on) batch[n++] = queue_[i].ev;
  }
  queueCount_ = 0;
  playing_ = false;
  keyDirty_ = false;
  if (n > 0) listener_->emit(batch, n);
}

// ------------------------------------------------------------
// 進める
// ------------------------------------------------------------

void Groove::update(uint32_t nowMs) {
  if (!playing_) return;
  advanceClock(nowMs);
  if (keyDirty_) restrikeForKeyChange();
  processDue();
}

void Groove::processDue() {
  // 1回の呼び出しで処理するティックに上限をつけておく（暴走の防止）
  for (int guard = 0; playing_ && nextTick_ <= nowTick_ && guard < 4096; guard++) {
    processTick(nextTick_);
    nextTick_++;
  }
}

void Groove::processTick(uint32_t tick) {
  bool stepBegan = false;
  if (tick % GROOVE_TICKS_PER_STEP == 0) {
    beginStep((int)((tick / GROOVE_TICKS_PER_STEP) % (uint32_t)numSteps_));
    stepBegan = true;
  }
  // 遅れすぎたマスの音は出さない（止める指示は、ふつうに出す）
  bool stale = (nowTick_ - tick) > STALE_TICKS;
  if (tick % GROOVE_TICKS_PER_SLOT == 0 && !stale) scheduleSlot(tick);

  emitDue(tick);
  if (stepBegan) listener_->stepStarted(cur_);  // 音を出してから、表示する
}

// ------------------------------------------------------------
// ステップの始まり: コードを決める
// ------------------------------------------------------------
uint8_t grooveResolveChordId(GrooveListener* listener, int numSteps, int step, uint8_t* rawId, bool* repeated) {
  uint8_t raw = listener->rawChordAtStep(step);
  if (rawId != nullptr) *rawId = raw;
  if (repeated != nullptr) *repeated = (raw == CHORD_ID_REPEAT);
  if (raw != CHORD_ID_REPEAT) return raw;
  for (int j = 1; j < numSteps; j++) {
    int p = ((step - j) % numSteps + numSteps) % numSteps;
    uint8_t r = listener->rawChordAtStep(p);
    if (r != CHORD_ID_REPEAT) return r;  // 前のコマが空・未登録(0)なら、休みを繰り返す
  }
  return 0;
}

void Groove::beginStep(int step) {
  StepInfo info;
  memset(&info, 0, sizeof(info));
  info.step = step;
  info.root = -1;

  uint8_t resolved = grooveResolveChordId(listener_, numSteps_, step, &info.rawId, &info.repeated);
  const Chord* chord = (resolved != 0) ? chordById(resolved) : nullptr;
  if (chord != nullptr && chordIsRepeat(*chord)) chord = nullptr;

  // 位置1（ループの最初）に戻ってきたら、前のコードの高さは忘れて、本来の高さに戻す
  if (step == 0) lastPlayedRoot_ = -1;
  prevRootBeforeStep_ = lastPlayedRoot_;
  if (chord != nullptr) {
    info.chordId = chord->id;
    computeVoicing(&info, *chord, prevRootBeforeStep_);
    lastPlayedRoot_ = info.root;  // 次のコードは、このコードから一番近い高さで鳴らす
  }
  cur_ = info;
  lastHit_.valid = false;
}

// コードの音を作る。本来の高さ（ルートが baseC〜baseC+11）から、前のコードに一番近い高さに、1オクターブずらす
void Groove::computeVoicing(StepInfo* info, const Chord& chord, int previousRoot) {
  int nominal = settings_.baseC + chordRootPitchClass(chord, key_);
  int shift = chooseOctaveShift(nominal, previousRoot, voiceLeading_);
  info->shift = shift;
  info->root = nominal + shift;
  info->noteCount = chordMidiNotes(chord, key_, (uint8_t)(settings_.baseC + shift), info->notes, octaveForTriads_);
}

// ------------------------------------------------------------
// マスごとの、バッキングとドラム
// ------------------------------------------------------------

// 16分音符のマスの始まり（tick）に、鳴らすものを予定に入れる
void Groove::scheduleSlot(uint32_t tick) {
  int loopSlots = numSteps_ * GROOVE_SLOTS_PER_STEP;
  int slotInLoop = (int)((tick / GROOVE_TICKS_PER_SLOT) % (uint32_t)loopSlots);
  int slotInStep = slotInLoop % GROOVE_SLOTS_PER_STEP;

  if (backing_ != nullptr && cur_.noteCount > 0) {
    int index = slotInLoop % backing_->length;
    BackingCell cell = backingParseCell(backing_->cells[index]);
    if (backingShapeIsHit(cell.shape)) {
      // 音ののばしは、ステップの終わり（次のコードの始まり）を超えない
      int hold = backingHoldSlots(*backing_, index, GROOVE_SLOTS_PER_STEP - slotInStep);
      uint32_t lengthTicks = (uint32_t)hold * GROOVE_TICKS_PER_SLOT;
      uint32_t gate = lengthTicks * settings_.gatePercent / 100u;
      if (gate < 1) gate = 1;
      scheduleBackingHit(tick, tick + gate, cell.shape, cell.soft);
      lastHit_.valid = true;
      lastHit_.shape = cell.shape;
      lastHit_.soft = cell.soft;
      lastHit_.endTick = tick + gate;
    }
  }
  if (drum_ != nullptr) scheduleDrums(tick, slotInLoop);
}

void Groove::scheduleBackingHit(uint32_t onTick, uint32_t offTick, BackingShape shape, bool soft) {
  uint8_t notes[MAX_CHORD_NOTES + 1];
  int count = notesForShape(shape, notes);
  uint8_t velocity = soft ? settings_.backingSoftVelocity : settings_.backingVelocity;
  for (int i = 0; i < count; i++) {
    enqueue(onTick, true, settings_.pianoChannel, notes[i], velocity);
    enqueue(offTick, false, settings_.pianoChannel, notes[i], 0);
  }
}

// バッキングの文字（形）に合わせて、鳴らす音を選ぶ
int Groove::notesForShape(BackingShape shape, uint8_t* out) const {
  int n = 0;
  int bass = cur_.root - 12;  // ベースは、ルートの1オクターブ下
  // 低すぎる音（MIDI 36 = C2 より下）は、ピアノではにごって不協和に聞こえるので、1オクターブ上げる
  if (bass >= 0 && bass < 36) bass += 12;
  switch (shape) {
    case BK_CHORD:
      for (int i = 0; i < cur_.noteCount; i++) out[n++] = cur_.notes[i];
      break;
    case BK_BASS:
      if (bass >= 0) out[n++] = (uint8_t)bass;
      break;
    case BK_BASS_CHORD:
      if (bass >= 0) out[n++] = (uint8_t)bass;
      for (int i = 0; i < cur_.noteCount; i++) out[n++] = cur_.notes[i];
      break;
    case BK_TONE1: case BK_TONE2: case BK_TONE3: case BK_TONE4: {
      int index = (int)shape - (int)BK_TONE1;  // 0〜3
      // 3和音を3音で鳴らしているとき、4番目は、ルートのオクターブ上にする
      out[n++] = (index < cur_.noteCount) ? cur_.notes[index] : (uint8_t)(cur_.root + 12);
      break;
    }
    default:
      break;
  }
  return n;
}

void Groove::scheduleDrums(uint32_t tick, int slotInLoop) {
  int index = slotInLoop % drum_->length;
  for (int lane = 0; lane < DRUM_LANES; lane++) {
    uint8_t level = drum_->level[lane][index];
    if (level == DRUM_NONE) continue;
    uint8_t velocity = (level == DRUM_ACCENT) ? settings_.drumAccentVelocity
                       : (level == DRUM_GHOST) ? settings_.drumGhostVelocity
                                               : settings_.drumNormalVelocity;
    uint8_t note = drumLaneNote(lane);
    enqueue(tick, true, settings_.drumChannel, note, velocity);
    enqueue(tick + settings_.drumNoteTicks, false, settings_.drumChannel, note, 0);
  }
}

// ------------------------------------------------------------
// 予定（あとで止める指示、同じ時刻の指示）
// ------------------------------------------------------------

// 予定を、時刻の順に並べて入れる。同じ時刻なら、止める指示が先（弾き直しのとき、先に止まる）
void Groove::enqueue(uint32_t tick, bool on, uint8_t channel, uint8_t note, uint8_t velocity) {
  if (queueCount_ >= GROOVE_QUEUE_SIZE) {
    if (!on) {  // 止める指示は、捨てない（鳴りっぱなしになる）。すぐに出す
      MidiEvent ev = {0, channel, note, 0};
      listener_->emit(&ev, 1);
    }
    return;  // 出す指示は、あきらめる
  }
  Pending p;
  p.tick = tick;
  p.ev.on = on ? 1 : 0;
  p.ev.channel = channel;
  p.ev.note = note;
  p.ev.velocity = velocity;
  int i = queueCount_;
  while (i > 0) {
    const Pending& before = queue_[i - 1];
    bool later = (before.tick > tick) || (before.tick == tick && before.ev.on > p.ev.on);
    if (!later) break;
    queue_[i] = queue_[i - 1];
    i--;
  }
  queue_[i] = p;
  queueCount_++;
}

// 時刻が tick までの予定を、まとめて出す
void Groove::emitDue(uint32_t tick) {
  int due = 0;
  while (due < queueCount_ && queue_[due].tick <= tick) due++;
  if (due == 0) return;
  noteLate(queue_[0].tick);
  MidiEvent batch[GROOVE_QUEUE_SIZE];
  for (int i = 0; i < due; i++) batch[i] = queue_[i].ev;
  for (int i = due; i < queueCount_; i++) queue_[i - due] = queue_[i];
  queueCount_ -= due;
  listener_->emit(batch, due);
}

// あるチャンネルの予定を取り消して、鳴っている音を止める（キー変更で、ピアノだけ鳴らし直すため）
void Groove::flushChannel(uint8_t channel) {
  MidiEvent batch[GROOVE_QUEUE_SIZE];
  int n = 0;
  int keep = 0;
  for (int i = 0; i < queueCount_; i++) {
    if (queue_[i].ev.channel == channel) {
      if (!queue_[i].ev.on) batch[n++] = queue_[i].ev;
    } else {
      queue_[keep++] = queue_[i];
    }
  }
  queueCount_ = keep;
  if (n > 0) listener_->emit(batch, n);
}

// ------------------------------------------------------------
// キーの変更: すぐに反映する
// ------------------------------------------------------------
void Groove::restrikeForKeyChange() {
  keyDirty_ = false;
  if (cur_.noteCount == 0 || cur_.chordId == 0) return;  // 休みのステップは、次のコードから新しいキーになる

  flushChannel(settings_.pianoChannel);  // 鳴っている和音を止める

  // 前のコードの高さは、そのまま（もう鳴らした音）。今のステップのコードだけを、新しいキーで作り直す
  const Chord* chord = chordById(cur_.chordId);
  if (chord == nullptr) return;
  computeVoicing(&cur_, *chord, prevRootBeforeStep_);
  lastPlayedRoot_ = cur_.root;

  // 直前の打鍵（和音・ベース・アルペジオの1音）を、新しい音で、同じ終わりの時刻まで鳴らし直す
  if (lastHit_.valid && lastHit_.endTick > nowTick_) {
    scheduleBackingHit(nowTick_, lastHit_.endTick, lastHit_.shape, lastHit_.soft);
  }
  emitDue(nowTick_);
}

// ------------------------------------------------------------
// 次に何かするまでの時間
// ------------------------------------------------------------

// そのマスに、音を出す・ステップが進むなど、何かすることがあるか
bool Groove::slotHasWork(int slotInLoop) const {
  if (slotInLoop % GROOVE_SLOTS_PER_STEP == 0) return true;  // ステップの始まり（コードが変わる）
  if (backing_ != nullptr) {
    if (backingShapeIsHit(backingParseCell(backing_->cells[slotInLoop % backing_->length]).shape)) return true;
  }
  if (drum_ != nullptr) {
    int index = slotInLoop % drum_->length;
    for (int lane = 0; lane < DRUM_LANES; lane++) {
      if (drum_->level[lane][index] != DRUM_NONE) return true;
    }
  }
  return false;
}

uint32_t Groove::nextWorkTick() const {
  // 次の、何かあるマスの始まり（ステップの始まりは、必ずある）
  uint32_t first = (nextTick_ + GROOVE_TICKS_PER_SLOT - 1) / GROOVE_TICKS_PER_SLOT * GROOVE_TICKS_PER_SLOT;
  int loopSlots = numSteps_ * GROOVE_SLOTS_PER_STEP;
  uint32_t best = first + (uint32_t)loopSlots * GROOVE_TICKS_PER_SLOT;  // 見つからなかったときの、遠い時刻
  for (int j = 0; j <= loopSlots; j++) {
    uint32_t t = first + (uint32_t)j * GROOVE_TICKS_PER_SLOT;
    int slotInLoop = (int)((t / GROOVE_TICKS_PER_SLOT) % (uint32_t)loopSlots);
    if (slotHasWork(slotInLoop)) {
      best = t;
      break;
    }
  }
  if (queueCount_ > 0 && queue_[0].tick < best) best = queue_[0].tick;
  if (best < nextTick_) best = nextTick_;
  return best;
}

uint32_t Groove::msUntilNextEvent(uint32_t nowMs) const {
  if (!playing_) return UINT32_MAX;
  if (keyDirty_) return 0;
  return msUntilTick(nextWorkTick(), nowMs);
}

// 診断: 時刻 eventTick の指示を、本来より何ms遅れて出したか
void Groove::noteLate(uint32_t eventTick) {
  uint64_t units = unitsPerMs();
  uint64_t lateUnits = (uint64_t)(nowTick_ - eventTick) * 60000u + acc_;
  uint32_t lateMs = (uint32_t)(lateUnits / units);
  if (lateMs > maxLateMs_) maxLateMs_ = lateMs;
}
