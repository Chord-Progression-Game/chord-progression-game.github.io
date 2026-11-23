#include "rhythm.h"

#include <ctype.h>
#include <string.h>

// ------------------------------------------------------------
// ドラムのレーン
// ------------------------------------------------------------
static const char LANE_LETTERS[DRUM_LANES] = {'K', 'S', 'P', 'H', 'O', 'C', 'R', 'X'};
static const char* const LANE_NAMES[DRUM_LANES] = {
    "キック", "スネア", "サイドスティック", "ハイハット(閉)", "ハイハット(開)", "ハンドクラップ", "ライド", "クラッシュ"};
// GM（General MIDI）のパーカッションのノート番号
static const uint8_t LANE_NOTES[DRUM_LANES] = {36, 38, 37, 42, 46, 39, 51, 49};

int drumLaneFromLetter(char letter) {
  char up = (char)toupper((unsigned char)letter);
  for (int i = 0; i < DRUM_LANES; i++) {
    if (LANE_LETTERS[i] == up) return i;
  }
  return -1;
}
char drumLaneLetter(int lane) { return (lane >= 0 && lane < DRUM_LANES) ? LANE_LETTERS[lane] : '?'; }
const char* drumLaneName(int lane) { return (lane >= 0 && lane < DRUM_LANES) ? LANE_NAMES[lane] : "?"; }
uint8_t drumLaneNote(int lane) { return (lane >= 0 && lane < DRUM_LANES) ? LANE_NOTES[lane] : 0; }

bool rhythmLengthValid(int length) { return length == 8 || length == 16 || length == 32; }

void rhythmSetName(char* dst, const char* name) {
  size_t n = 0;
  if (name != nullptr) {
    n = strlen(name);
    if (n > (size_t)RHYTHM_NAME_BYTES - 1) {
      n = RHYTHM_NAME_BYTES - 1;
      // UTF-8 の文字の途中（10xxxxxx）で切らないようにする
      while (n > 0 && (((unsigned char)name[n]) & 0xC0) == 0x80) n--;
    }
    memcpy(dst, name, n);
  }
  memset(dst + n, 0, RHYTHM_NAME_BYTES - n);
}

// ------------------------------------------------------------
// ドラムのパターン
// ------------------------------------------------------------
void drumPatternClear(DrumPattern* p, int length) {
  memset(p, 0, sizeof(*p));
  p->length = (uint8_t)(rhythmLengthValid(length) ? length : 16);
}

bool drumPatternIsEmpty(const DrumPattern& p) {
  for (int lane = 0; lane < DRUM_LANES; lane++) {
    for (int s = 0; s < p.length; s++) {
      if (p.level[lane][s] != DRUM_NONE) return false;
    }
  }
  return true;
}

bool drumPatternSetLength(DrumPattern* p, int length) {
  if (!rhythmLengthValid(length)) return false;
  for (int lane = 0; lane < DRUM_LANES; lane++) {
    for (int s = length; s < RHYTHM_MAX_SLOTS; s++) p->level[lane][s] = DRUM_NONE;  // 短くした分は捨てる
  }
  p->length = (uint8_t)length;
  return true;
}

static int drumLevelFromChar(char c) {
  switch (c) {
    case '.': return DRUM_NONE;
    case 'o': return DRUM_GHOST;
    case 'x': return DRUM_NORMAL;
    case 'X': return DRUM_ACCENT;
    default:  return -1;
  }
}

bool drumPatternSetLane(DrumPattern* p, int lane, const char* text, const char** error) {
  static const char* ERR_LANE = "レーンは K S P H O C R X のどれかです";
  static const char* ERR_CHAR = "使える文字は  .（なし） o（弱く） x（ふつう） X（強く）  です";
  static const char* ERR_LEN = "文字数が、いまのパターンの長さと違います。長さを変えるときは、先に LEN を使ってください";
  static const char* ERR_LEN_FREE = "文字数は 8 / 16 / 32 のどれかにしてください（1文字 = 16分音符 1つ分）";
  if (lane < 0 || lane >= DRUM_LANES) { if (error) *error = ERR_LANE; return false; }
  size_t len = strlen(text);
  for (size_t i = 0; i < len; i++) {
    if (drumLevelFromChar(text[i]) < 0) { if (error) *error = ERR_CHAR; return false; }
  }
  if (len != p->length) {
    // 空のパターンなら、文字数をそのまま長さにする（8 / 16 / 32 のとき）
    if (drumPatternIsEmpty(*p) && rhythmLengthValid((int)len)) {
      char name[RHYTHM_NAME_BYTES];
      memcpy(name, p->name, sizeof(name));  // 名前は、そのまま残す
      drumPatternClear(p, (int)len);
      memcpy(p->name, name, sizeof(name));
    } else {
      if (error) *error = drumPatternIsEmpty(*p) ? ERR_LEN_FREE : ERR_LEN;   // 空なら、どの長さにもできるので、有効な長さを案内する
      return false;
    }
  }
  for (size_t i = 0; i < len; i++) p->level[lane][i] = (uint8_t)drumLevelFromChar(text[i]);
  return true;
}

void drumPatternLaneText(const DrumPattern& p, int lane, char* out, size_t outSize) {
  static const char CHARS[4] = {'.', 'o', 'x', 'X'};
  if (outSize == 0) return;
  size_t n = 0;
  for (int s = 0; s < p.length && n + 1 < outSize; s++) out[n++] = CHARS[p.level[lane][s] & 3];
  out[n] = '\0';
}

// ------------------------------------------------------------
// バッキングのパターン
// ------------------------------------------------------------
BackingCell backingParseCell(char c) {
  BackingCell cell = {BK_INVALID, false};
  switch (c) {
    case '.': cell.shape = BK_NONE; break;
    case '-': cell.shape = BK_HOLD; break;
    case 'C': cell.shape = BK_CHORD; break;
    case 'c': cell.shape = BK_CHORD; cell.soft = true; break;
    case 'B': cell.shape = BK_BASS; break;
    case 'b': cell.shape = BK_BASS; cell.soft = true; break;
    case 'D': cell.shape = BK_BASS_CHORD; break;
    case 'd': cell.shape = BK_BASS_CHORD; cell.soft = true; break;
    case '1': cell.shape = BK_TONE1; break;
    case '2': cell.shape = BK_TONE2; break;
    case '3': cell.shape = BK_TONE3; break;
    case '4': cell.shape = BK_TONE4; break;
    default: break;
  }
  return cell;
}

bool backingShapeIsHit(BackingShape shape) {
  return shape == BK_CHORD || shape == BK_BASS || shape == BK_BASS_CHORD || (shape >= BK_TONE1 && shape <= BK_TONE4);
}

void backingPatternClear(BackingPattern* p, int length) {
  memset(p, 0, sizeof(*p));
  p->length = (uint8_t)(rhythmLengthValid(length) ? length : 16);
  memset(p->cells, '.', p->length);
}

bool backingPatternIsEmpty(const BackingPattern& p) {
  for (int i = 0; i < p.length; i++) {
    if (backingShapeIsHit(backingParseCell(p.cells[i]).shape)) return false;
  }
  return true;
}

bool backingPatternSetLength(BackingPattern* p, int length) {
  if (!rhythmLengthValid(length)) return false;
  for (int i = p->length; i < length; i++) p->cells[i] = '.';  // 長くした分は、何もしない
  p->length = (uint8_t)length;
  memset(p->cells + length, 0, RHYTHM_MAX_SLOTS + 1 - length);
  // 短くして、「-」が先頭に取り残された場合などを直す（のばす相手がない「-」は「.」にする）
  bool afterHit = false;
  for (int i = 0; i < p->length; i++) {
    BackingCell c = backingParseCell(p->cells[i]);
    if (c.shape == BK_HOLD && !afterHit) p->cells[i] = '.';
    afterHit = backingShapeIsHit(c.shape) || (c.shape == BK_HOLD && afterHit);
  }
  return true;
}

bool backingPatternSetCells(BackingPattern* p, const char* text, const char** error) {
  static const char* ERR_CHAR = "使える文字は  .  -  C c B b D d  1 2 3 4  です";
  static const char* ERR_HOLD = "「-」は、音（C B D 1〜4）か、別の「-」の直後にだけ使えます";
  static const char* ERR_LEN = "文字数が、いまのパターンの長さと違います。長さを変えるときは、先に LEN を使ってください";
  static const char* ERR_LEN_FREE = "文字数は 8 / 16 / 32 のどれかにしてください（1文字 = 16分音符 1つ分）";
  size_t len = strlen(text);
  bool afterHit = false;
  for (size_t i = 0; i < len; i++) {
    BackingCell c = backingParseCell(text[i]);
    if (c.shape == BK_INVALID) { if (error) *error = ERR_CHAR; return false; }
    if (c.shape == BK_HOLD && !afterHit) { if (error) *error = ERR_HOLD; return false; }
    afterHit = backingShapeIsHit(c.shape) || (c.shape == BK_HOLD && afterHit);
  }
  if (len != p->length) {
    if (backingPatternIsEmpty(*p) && rhythmLengthValid((int)len)) {
      char name[RHYTHM_NAME_BYTES];
      memcpy(name, p->name, sizeof(name));  // 名前は、そのまま残す
      backingPatternClear(p, (int)len);
      memcpy(p->name, name, sizeof(name));
    } else {
      if (error) *error = backingPatternIsEmpty(*p) ? ERR_LEN_FREE : ERR_LEN;
      return false;
    }
  }
  memset(p->cells, 0, sizeof(p->cells));
  memcpy(p->cells, text, len);
  return true;
}

int backingHoldSlots(const BackingPattern& p, int index, int maxSlots) {
  int hold = 1;
  for (int i = index + 1; i < p.length && p.cells[i] == '-'; i++) hold++;
  if (hold > maxSlots) hold = maxSlots;
  if (hold < 1) hold = 1;
  return hold;
}

// ------------------------------------------------------------
// プリセット
// ------------------------------------------------------------
namespace {

struct DrumPreset {
  int id;
  const char* name;
  int length;
  const char* lanes[DRUM_LANES];   // K S P H O C R X の順。nullptr = 空
};

struct BackingPreset {
  int id;
  const char* name;
  const char* cells;
};

const DrumPreset DRUM_PRESETS[] = {
    //                              K                   S                   P                   H                   O                   C                   R                   X
    {1, "メトロノーム", 16, {nullptr,            nullptr,            nullptr,            "X...x...x...x...", nullptr,            nullptr,            nullptr,            nullptr}},
    {2, "8ビート",      16, {"x.......x.x.....", "....x.......x...", nullptr,            "x.x.x.x.x.x.x.x.", nullptr,            nullptr,            nullptr,            nullptr}},
    {3, "4つ打ち",      16, {"x...x...x...x...", nullptr,            nullptr,            "x...x...x...x...", "..x...x...x...x.", "....x.......x...", nullptr,            nullptr}},
    {4, "16ビート",     16, {"x.....x...x.....", "....x.......x...", nullptr,            "XoxoXoxoXoxoXoxo", nullptr,            nullptr,            nullptr,            nullptr}},
    {5, "バラード",     16, {"x.......x.......", nullptr,            "....x.......x...", nullptr,            nullptr,            nullptr,            "x.x.x.x.x.x.x.x.", nullptr}},
    {6, "レゲエ",       16, {"........x.......", nullptr,            "........x.......", "x.x.x.x.x.x.x.x.", nullptr,            nullptr,            nullptr,            nullptr}},
    {7, "ハーフタイム", 16, {"x...............", "........x.......", nullptr,            "x.x.x.x.x.x.x.x.", nullptr,            nullptr,            nullptr,            nullptr}},
};

const BackingPreset BACKING_PRESETS[] = {
    {1, "ロング",           "C-------C-------"},
    {2, "4分チョップ",      "C...C...C...C..."},
    {3, "8分チョップ",      "C.C.C.C.C.C.C.C."},
    {4, "裏打ち",           "..C...C...C...C."},
    {5, "チャールストン",   "C-----C-C-----C-"},
    {6, "アルペジオ(8分)",  "1-2-3-4-1-2-3-4-"},
    {7, "アルペジオ(上下)", "1-2-3-4-4-3-2-1-"},
    {8, "ベース+コード",    "B...C...B...C..."},
    {9, "シンコペ",         "C..C..C.C..C..C."},
};

const int DRUM_PRESET_COUNT = (int)(sizeof(DRUM_PRESETS) / sizeof(DRUM_PRESETS[0]));
const int BACKING_PRESET_COUNT = (int)(sizeof(BACKING_PRESETS) / sizeof(BACKING_PRESETS[0]));

// 表のデータから、使いやすい形のパターンを作って、取っておく（1回だけ作る）
DrumPattern builtDrums[DRUM_PRESET_COUNT];
BackingPattern builtBackings[BACKING_PRESET_COUNT];
bool built = false;

void buildPresets() {
  if (built) return;
  for (int i = 0; i < DRUM_PRESET_COUNT; i++) {
    DrumPattern* p = &builtDrums[i];
    drumPatternClear(p, DRUM_PRESETS[i].length);
    rhythmSetName(p->name, DRUM_PRESETS[i].name);
    for (int lane = 0; lane < DRUM_LANES; lane++) {
      if (DRUM_PRESETS[i].lanes[lane] != nullptr) drumPatternSetLane(p, lane, DRUM_PRESETS[i].lanes[lane], nullptr);
    }
  }
  for (int i = 0; i < BACKING_PRESET_COUNT; i++) {
    BackingPattern* p = &builtBackings[i];
    backingPatternClear(p, (int)strlen(BACKING_PRESETS[i].cells));
    rhythmSetName(p->name, BACKING_PRESETS[i].name);
    backingPatternSetCells(p, BACKING_PRESETS[i].cells, nullptr);
  }
  built = true;
}

}  // namespace

const DrumPattern* drumPresetById(int id) {
  buildPresets();
  for (int i = 0; i < DRUM_PRESET_COUNT; i++) {
    if (DRUM_PRESETS[i].id == id) return &builtDrums[i];
  }
  return nullptr;
}

const BackingPattern* backingPresetById(int id) {
  buildPresets();
  for (int i = 0; i < BACKING_PRESET_COUNT; i++) {
    if (BACKING_PRESETS[i].id == id) return &builtBackings[i];
  }
  return nullptr;
}

// ------------------------------------------------------------
// 保存形式
// ------------------------------------------------------------
static const uint8_t SERIAL_VERSION = 1;

size_t drumPatternSerialize(const DrumPattern& p, uint8_t* out, size_t outSize) {
  size_t need = 2 + RHYTHM_NAME_BYTES + (size_t)DRUM_LANES * p.length;
  if (!rhythmLengthValid(p.length) || outSize < need) return 0;
  size_t n = 0;
  out[n++] = SERIAL_VERSION;
  out[n++] = p.length;
  memcpy(out + n, p.name, RHYTHM_NAME_BYTES);
  n += RHYTHM_NAME_BYTES;
  for (int lane = 0; lane < DRUM_LANES; lane++) {
    for (int s = 0; s < p.length; s++) out[n++] = p.level[lane][s];
  }
  return n;
}

bool drumPatternDeserialize(const uint8_t* data, size_t len, DrumPattern* p) {
  if (len < 2 + (size_t)RHYTHM_NAME_BYTES || data[0] != SERIAL_VERSION) return false;
  int length = data[1];
  if (!rhythmLengthValid(length)) return false;
  if (len != 2 + (size_t)RHYTHM_NAME_BYTES + (size_t)DRUM_LANES * length) return false;
  DrumPattern tmp;
  drumPatternClear(&tmp, length);
  memcpy(tmp.name, data + 2, RHYTHM_NAME_BYTES);
  tmp.name[RHYTHM_NAME_BYTES - 1] = '\0';
  size_t n = 2 + RHYTHM_NAME_BYTES;
  for (int lane = 0; lane < DRUM_LANES; lane++) {
    for (int s = 0; s < length; s++) {
      uint8_t v = data[n++];
      if (v > DRUM_ACCENT) return false;
      tmp.level[lane][s] = v;
    }
  }
  *p = tmp;
  return true;
}

size_t backingPatternSerialize(const BackingPattern& p, uint8_t* out, size_t outSize) {
  size_t need = 2 + RHYTHM_NAME_BYTES + p.length;
  if (!rhythmLengthValid(p.length) || outSize < need) return 0;
  size_t n = 0;
  out[n++] = SERIAL_VERSION;
  out[n++] = p.length;
  memcpy(out + n, p.name, RHYTHM_NAME_BYTES);
  n += RHYTHM_NAME_BYTES;
  memcpy(out + n, p.cells, p.length);
  n += p.length;
  return n;
}

bool backingPatternDeserialize(const uint8_t* data, size_t len, BackingPattern* p) {
  if (len < 2 + (size_t)RHYTHM_NAME_BYTES || data[0] != SERIAL_VERSION) return false;
  int length = data[1];
  if (!rhythmLengthValid(length)) return false;
  if (len != 2 + (size_t)RHYTHM_NAME_BYTES + (size_t)length) return false;
  BackingPattern tmp;
  backingPatternClear(&tmp, length);
  memcpy(tmp.name, data + 2, RHYTHM_NAME_BYTES);
  tmp.name[RHYTHM_NAME_BYTES - 1] = '\0';
  char text[RHYTHM_MAX_SLOTS + 1];
  memcpy(text, data + 2 + RHYTHM_NAME_BYTES, length);
  text[length] = '\0';
  // 保存データでも、ふつうの入力と同じ検査をする
  BackingPattern probe;
  backingPatternClear(&probe, length);
  if (!backingPatternSetCells(&probe, text, nullptr)) return false;
  memcpy(tmp.cells, probe.cells, sizeof(tmp.cells));
  *p = tmp;
  return true;
}
