#include "chords.h"

#include <stdio.h>
#include <string.h>

const Key KEY_C = {0, 0};

// C D E F G A B の高さ（Cからの半音数）
static const uint8_t NATURAL_PC[7] = {0, 2, 4, 5, 7, 9, 11};

// 長音階の Ⅰ〜Ⅶ の高さ（主音からの半音数）。ディグリーを実際の音に直すときに使う
static const uint8_t MAJOR_SCALE[7] = {0, 2, 4, 5, 7, 9, 11};

static const char LETTERS[7] = {'C', 'D', 'E', 'F', 'G', 'A', 'B'};

// ------------------------------------------------------------
// コードタイプ（コードの種類ごとの構成音）
// ------------------------------------------------------------
struct ChordTypeDef {
  const char* suffix;                 // コード名の語尾
  uint8_t chordTones;                 // コードそのものの構成音の数（3和音は3、7thなどは4）
  uint8_t noteCount;                  // 鳴らす音の数（どのコードも4音。3和音は4音目がルートのオクターブ上）
  uint8_t semitones[MAX_CHORD_NOTES]; // ルートからの半音数（MIDIの音程を作るのに使う）
  uint8_t steps[MAX_CHORD_NOTES];     // ルートから数えた音名の距離（0=ルート 2=3度 3=4度 4=5度 5=6度 6=7度 7=オクターブ上）。
                                      // C D E... のどの文字で書くか（G#かA♭か）を決めるのに使う
};

// 並び順は enum ChordType と同じにすること。
// どのコードも4音で鳴らす。3和音（トライアド）は、4音目にルートのオクターブ上（+12半音）を足す。
static const ChordTypeDef CHORD_TYPES[CT_TYPE_COUNT] = {
    /* CT_MAJOR  */ {"",      3, 4, {0, 4, 7, 12},  {0, 2, 4, 7}},
    /* CT_MINOR  */ {"m",     3, 4, {0, 3, 7, 12},  {0, 2, 4, 7}},
    /* CT_MAJ7   */ {"M7",    4, 4, {0, 4, 7, 11},  {0, 2, 4, 6}},
    /* CT_DOM7   */ {"7",     4, 4, {0, 4, 7, 10},  {0, 2, 4, 6}},
    /* CT_MIN7   */ {"m7",    4, 4, {0, 3, 7, 10},  {0, 2, 4, 6}},
    /* CT_MIN7B5 */ {"m7-5",  4, 4, {0, 3, 6, 10},  {0, 2, 4, 6}},
    /* CT_DIM7   */ {"dim7",  4, 4, {0, 3, 6, 9},   {0, 2, 4, 6}},
    /* CT_MIN6   */ {"m6",    4, 4, {0, 3, 7, 9},   {0, 2, 4, 5}},
    /* CT_SUS47  */ {"sus47", 4, 4, {0, 5, 7, 10},  {0, 3, 4, 6}},
    /* CT_SUS4   */ {"sus4",  3, 4, {0, 5, 7, 12},  {0, 3, 4, 7}},   // 3和音。4音目はルートのオクターブ上
    /* CT_REPEAT */ {"→",     0, 0, {0, 0, 0, 0},   {0, 0, 0, 0}},   // 音を持たない（前のコードの繰り返し）
};

// ------------------------------------------------------------
// 登録候補のコード一覧
//   この表の並び順 ＝ Serial Monitor のメニューの番号（1番目 → 1、2番目 → 2 ...）。
//   id は保存データ(NVS)に書かれる番号。いちど決めたら変えない。並び順とは無関係。
//   新しいコードは、メニューに出したい位置に差し込み、id には「まだ使っていない最大の番号＋1」を付ける。
//   degree が 0 のものは絶対音名のコード（Keyを変えても音が変わらない）。いまは該当するコードなし
// ------------------------------------------------------------
static const Chord CHORDS[] = {
    // id lv  表示名        度数 変化 音名 タイプ
    // ---- Lv.1 ----
    {1, 1, "Ⅰ",       1, 0, 0, CT_MAJOR},
    {2, 1, "Ⅵm",      6, 0, 0, CT_MINOR},
    {3, 1, "Ⅳ",       4, 0, 0, CT_MAJOR},
    {4, 1, "Ⅴ",       5, 0, 0, CT_MAJOR},
    // ---- Lv.2 ----
    {5, 2, "ⅠM7",     1, 0, 0, CT_MAJ7},
    {6, 2, "Ⅱm",      2, 0, 0, CT_MINOR},
    {7, 2, "Ⅲm",      3, 0, 0, CT_MINOR},
    {8, 2, "ⅣM7",     4, 0, 0, CT_MAJ7},
    {9, 2, "Ⅴ7",      5, 0, 0, CT_DOM7},
    {10, 2, "Ⅵm7",    6, 0, 0, CT_MIN7},
    // ---- Lv.3 ----
    {11, 3, "Ⅰ7",     1, 0, 0, CT_DOM7},
    {12, 3, "Ⅱm7",    2, 0, 0, CT_MIN7},
    {13, 3, "Ⅲm7",    3, 0, 0, CT_MIN7},
    {14, 3, "Ⅲ7",     3, 0, 0, CT_DOM7},
    {15, 3, "Ⅶm7-5",  7, 0, 0, CT_MIN7B5},
    // ---- Lv.4 ----
    {16, 4, "Ⅱ7",     2, 0, 0, CT_DOM7},
    {17, 4, "Ⅳm7",    4, 0, 0, CT_MIN7},
    {18, 4, "Ⅳ#m7-5", 4, +1, 0, CT_MIN7B5},
    {19, 4, "Ⅴm7",    5, 0, 0, CT_MIN7},
    {27, 4, "Ⅴsus47",  5, 0, 0, CT_SUS47},   // 後から追加（id 27）
    {21, 4, "Ⅵ♭M7",   6, -1, 0, CT_MAJ7},
    {20, 4, "Ⅴ#dim7", 5, +1, 0, CT_DIM7},
    {22, 4, "Ⅵ7",     6, 0, 0, CT_DOM7},
    {23, 4, "Ⅶ♭7",    7, -1, 0, CT_DOM7},
    {30, 4, "Ⅵ",      6, 0, 0, CT_MAJOR},   // 後から追加（id 30）。ピカルディ終止の着地点（短調の主和音 Ⅵm を、長三和音にしたもの。Key=C: A）
    {31, 4, "Ⅵsus4",  6, 0, 0, CT_SUS4},    // 後から追加（id 31）。Ⅵ へ解決する前の、サス（Key=C: Asus4）
    // ---- Lv.5（ディグリー。Key=C のとき Ⅱ♭M7=D♭M7 / Ⅲ♭M7=E♭M7 / Ⅳm6=Fm6 / Ⅱ♭7=D♭7）----
    {24, 5, "Ⅱ♭M7",   2, -1, 0, CT_MAJ7},
    {25, 5, "Ⅲ♭M7",   3, -1, 0, CT_MAJ7},
    {28, 5, "Ⅲ♭m6",   3, -1, 0, CT_MIN6},   // 後から追加（id 28）
    {26, 5, "Ⅳm6",    4, 0, 0, CT_MIN6},
    {29, 5, "Ⅱ♭7",    2, -1, 0, CT_DOM7},   // 後から追加（id 29）。裏コード（♭Ⅱ7）。Ⅴ7 の代わりに使い、Ⅰ へ半音下がって解決する（Key=C: D♭7 → C）
    // ---- 特殊（レベル6）----
    {99, 6, "→",       0, 0, 0, CT_REPEAT},   // 前のコマと同じコードを鳴らす
};

static const int CHORD_TOTAL = sizeof(CHORDS) / sizeof(CHORDS[0]);

bool chordIsRepeat(const Chord& chord) { return chord.type == CT_REPEAT; }

int chordCount() { return CHORD_TOTAL; }

const Chord& chordAt(int index) { return CHORDS[index]; }

const Chord* chordById(uint8_t id) {
  for (int i = 0; i < CHORD_TOTAL; i++) {
    if (CHORDS[i].id == id) return &CHORDS[i];
  }
  return nullptr;
}

// ------------------------------------------------------------
// 計算
// ------------------------------------------------------------

// キーの主音の高さ (C=0 ... B=11)
static uint8_t keyPitchClass(const Key& key) {
  return (NATURAL_PC[key.letter % 7] + key.accidental + 12) % 12;
}

uint8_t keyPitchClassOf(const Key& key) { return keyPitchClass(key); }

// コードのルートを求める（音名の文字 と 高さ）
static void chordRoot(const Chord& chord, const Key& key, uint8_t* letter, uint8_t* pitchClass) {
  if (chord.degree == 0) {
    // 絶対音名のコード: Keyに関係なく固定
    *letter = chord.absLetter;
    *pitchClass = (NATURAL_PC[chord.absLetter % 7] + chord.accidental + 12) % 12;
  } else {
    // ディグリーのコード: Keyの主音から、長音階のⅠ〜Ⅶ（＋変化記号）だけ上
    *letter = (key.letter + chord.degree - 1) % 7;
    *pitchClass = (keyPitchClass(key) + MAJOR_SCALE[chord.degree - 1] + chord.accidental + 12) % 12;
  }
}

// 高さ pitchClass の音を、音名の文字 letter で書くときの変化記号（♭=-1 / #=+1）
static int8_t accidentalFor(uint8_t pitchClass, uint8_t letter) {
  int d = (int)pitchClass - (int)NATURAL_PC[letter % 7];
  while (d > 6) d -= 12;
  while (d < -5) d += 12;
  return (int8_t)d;
}

static const char* accidentalText(int8_t accidental) {
  switch (accidental) {
    case 0:  return "";
    case 1:  return "#";
    case -1: return "♭";
    case 2:  return "##";
    case -2: return "♭♭";
    default: return "?";
  }
}

// buf の末尾に text を足す（size を超えないようにする）
static void appendText(char* buf, size_t size, const char* text) {
  size_t len = strlen(buf);
  if (len + 1 >= size) return;
  strncat(buf, text, size - len - 1);
}

static void appendNote(char* buf, size_t size, uint8_t letter, int8_t accidental) {
  char one[2] = {LETTERS[letter % 7], '\0'};
  appendText(buf, size, one);
  appendText(buf, size, accidentalText(accidental));
}

uint8_t chordRootPitchClass(const Chord& chord, const Key& key) {
  uint8_t letter, pitchClass;
  chordRoot(chord, key, &letter, &pitchClass);
  return pitchClass;
}

// 鳴らす音の数。octaveForTriads が false なら、3和音は3音だけ（ルートのオクターブ上を足さない）
static uint8_t voiceCount(const ChordTypeDef& type, bool octaveForTriads) {
  return octaveForTriads ? type.noteCount : type.chordTones;
}

uint8_t chordMidiNotes(const Chord& chord, const Key& key, uint8_t baseC, uint8_t* notes, bool octaveForTriads) {
  const ChordTypeDef& type = CHORD_TYPES[chord.type];
  uint8_t rootNote = baseC + chordRootPitchClass(chord, key);
  uint8_t count = voiceCount(type, octaveForTriads);
  for (uint8_t i = 0; i < count; i++) {
    notes[i] = rootNote + type.semitones[i];
  }
  return count;
}

void chordSymbol(const Chord& chord, const Key& key, char* buf, size_t size) {
  if (size == 0) return;
  buf[0] = '\0';
  if (chordIsRepeat(chord)) {  // 「→」には音名がない
    appendText(buf, size, "→");
    return;
  }
  uint8_t letter, pitchClass;
  chordRoot(chord, key, &letter, &pitchClass);
  appendNote(buf, size, letter, accidentalFor(pitchClass, letter));
  appendText(buf, size, CHORD_TYPES[chord.type].suffix);
}

void chordNoteNames(const Chord& chord, const Key& key, char* buf, size_t size, bool octaveForTriads) {
  if (size == 0) return;
  buf[0] = '\0';
  const ChordTypeDef& type = CHORD_TYPES[chord.type];
  uint8_t rootLetter, rootPitchClass;
  chordRoot(chord, key, &rootLetter, &rootPitchClass);
  uint8_t count = voiceCount(type, octaveForTriads);
  for (uint8_t i = 0; i < count; i++) {
    uint8_t letter = (rootLetter + type.steps[i]) % 7;
    uint8_t pitchClass = (rootPitchClass + type.semitones[i]) % 12;
    if (i > 0) appendText(buf, size, " ");
    appendNote(buf, size, letter, accidentalFor(pitchClass, letter));
  }
}

void keyName(const Key& key, char* buf, size_t size) {
  if (size == 0) return;
  buf[0] = '\0';
  appendNote(buf, size, key.letter, key.accidental);
}

// ------------------------------------------------------------
// キー（調）の扱い
// ------------------------------------------------------------

// 高さ(0〜11) → ふつうの綴り。黒鍵は、C D♭ D E♭ E F F# G A♭ A B♭ B の並び
static const Key PREFERRED_KEYS[12] = {
    {0, 0},   // C
    {1, -1},  // D♭
    {1, 0},   // D
    {2, -1},  // E♭
    {2, 0},   // E
    {3, 0},   // F
    {3, +1},  // F#
    {4, 0},   // G
    {5, -1},  // A♭
    {5, 0},   // A
    {6, -1},  // B♭
    {6, 0},   // B
};

Key keyFromPitchClass(int pitchClass) {
  int pc = ((pitchClass % 12) + 12) % 12;
  return PREFERRED_KEYS[pc];
}

Key keyTranspose(const Key& key, int semitones) {
  return keyFromPitchClass((int)keyPitchClass(key) + semitones);
}

bool parseKeyName(const char* text, Key* key) {
  if (text == nullptr) return false;
  while (*text == ' ' || *text == '\t') text++;
  char c = *text;
  if (c >= 'a' && c <= 'g') c = (char)(c - 'a' + 'A');
  if (c < 'A' || c > 'G') return false;
  uint8_t letter = (uint8_t)((c - 'A' + 5) % 7);  // A=5 B=6 C=0 D=1 E=2 F=3 G=4
  text++;

  int8_t accidental = 0;
  if (*text == '#') {
    accidental = 1;
    text++;
  } else if (*text == 'b') {  // 小文字の b は「♭」（大文字の B は音名なので、2文字目には来ない）
    accidental = -1;
    text++;
  } else if (strncmp(text, "♯", 3) == 0) {
    accidental = 1;
    text += 3;
  } else if (strncmp(text, "♭", 3) == 0) {
    accidental = -1;
    text += 3;
  }
  while (*text == ' ' || *text == '\t') text++;
  if (*text != '\0') return false;  // ほかの文字が残っている

  key->letter = letter;
  key->accidental = accidental;
  return true;
}
