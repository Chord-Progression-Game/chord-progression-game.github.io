#pragma once
#include <stddef.h>
#include <stdint.h>

// ============================================================
// リズムのパターン（ドラム と バッキング）
//
//   ドラムとバッキングは、別々に作って、別々に選べる。どの組み合わせでも鳴らせる。
//     ドラム   : 打楽器のパターン。8つのレーン（キック・スネア・ハイハット…）× 16分音符のマス
//     バッキング: コードの鳴らし方のパターン。16分音符のマスごとに、「和音をポン」「ベース」「アルペジオの1音」など
//   どちらも、1小節（16マス）か、半小節（8マス）、2小節（32マス）の長さで、くり返す。
//   バッキングは、そのとき鳴っているコード（4つの位置のどれか）の音を使う。
//
//   Arduino に依存しない（パソコンの上でもテストできる）。保存（NVS）は rhythm_store.cpp。
// ============================================================

const int RHYTHM_MAX_SLOTS = 32;      // パターンの最大の長さ（16分音符のマスの数）
const int RHYTHM_NAME_BYTES = 32;     // 名前の最大バイト数（日本語は1文字3バイト）
const int DRUM_LANES = 8;             // ドラムのレーンの数

// パターンの番号（ID）。0 は「なし」。1〜10 は最初から入っているプリセット（変更できない）。
// 11〜20 は、自分で作れるスロット（保存される）
const int PATTERN_ID_OFF = 0;
const int PATTERN_ID_PRESET_LAST = 10;
const int PATTERN_ID_USER_FIRST = 11;
const int PATTERN_USER_SLOTS = 10;
const int PATTERN_ID_USER_LAST = PATTERN_ID_USER_FIRST + PATTERN_USER_SLOTS - 1;  // 20

inline bool patternIdIsPreset(int id) { return id >= 1 && id <= PATTERN_ID_PRESET_LAST; }
inline bool patternIdIsUser(int id) { return id >= PATTERN_ID_USER_FIRST && id <= PATTERN_ID_USER_LAST; }

// ---- ドラム ----
// マスの音の強さ
enum DrumLevel : uint8_t {
  DRUM_NONE = 0,    // .  鳴らさない
  DRUM_GHOST = 1,   // o  弱く
  DRUM_NORMAL = 2,  // x  ふつう
  DRUM_ACCENT = 3   // X  強く
};

struct DrumPattern {
  char name[RHYTHM_NAME_BYTES];
  uint8_t length;                                   // 8 / 16 / 32（16分音符のマスの数）
  uint8_t level[DRUM_LANES][RHYTHM_MAX_SLOTS];      // レーンごと・マスごとの DrumLevel
};

// レーンの文字: K=キック S=スネア P=サイドスティック H=ハイハット(閉) O=ハイハット(開) C=クラップ R=ライド X=クラッシュ
int drumLaneFromLetter(char letter);   // 大文字小文字どちらでもよい。なければ -1
char drumLaneLetter(int lane);
const char* drumLaneName(int lane);    // 画面に出す名前（日本語）
uint8_t drumLaneNote(int lane);        // GM のドラムのノート番号

bool rhythmLengthValid(int length);    // 8 / 16 / 32 か

void rhythmSetName(char* dst, const char* name);   // 名前を入れる（長すぎれば、文字の途中で切らずに短くする）

void drumPatternClear(DrumPattern* p, int length);                          // 全部空にして、長さを決める
bool drumPatternIsEmpty(const DrumPattern& p);                              // 音が1つもないか
bool drumPatternSetLength(DrumPattern* p, int length);                      // 長さを変える（短くすると切り捨て、長くすると空のマスを足す）
// レーンの内容を、文字列（"x...x...X..o...."）で設定する。文字は . x X o
// 長さが違うとき: パターンが空なら、その文字数を長さにする。空でなければ失敗（error に理由）
bool drumPatternSetLane(DrumPattern* p, int lane, const char* text, const char** error);
void drumPatternLaneText(const DrumPattern& p, int lane, char* out, size_t outSize);   // 文字列にして取り出す

// ---- バッキング ----
// マスの文字:
//   .  何もしない        -  直前の音を、のばす
//   C  和音（全部の音）   c  和音（弱く）
//   B  ベース（ルートの1オクターブ下）  b  同（弱く）
//   D  ベース＋和音       d  同（弱く）
//   1 2 3 4  和音の1番目〜4番目の音を、1音だけ（アルペジオ用）
enum BackingShape : uint8_t {
  BK_NONE,        // .
  BK_HOLD,        // -
  BK_CHORD,       // C c
  BK_BASS,        // B b
  BK_BASS_CHORD,  // D d
  BK_TONE1, BK_TONE2, BK_TONE3, BK_TONE4,  // 1 2 3 4
  BK_INVALID
};

struct BackingCell {
  BackingShape shape;
  bool soft;       // 弱く（小文字）
};

struct BackingPattern {
  char name[RHYTHM_NAME_BYTES];
  uint8_t length;                       // 8 / 16 / 32
  char cells[RHYTHM_MAX_SLOTS + 1];     // length 文字 + 終わりの '\0'
};

BackingCell backingParseCell(char c);                   // 1文字の意味。使えない文字は BK_INVALID
bool backingShapeIsHit(BackingShape shape);             // 音を出す文字か（C B D 1〜4）

void backingPatternClear(BackingPattern* p, int length);
bool backingPatternIsEmpty(const BackingPattern& p);
bool backingPatternSetLength(BackingPattern* p, int length);
// 文字列全体を設定する。文字数が長さと違うとき: パターンが空なら、その文字数を長さにする。空でなければ失敗
bool backingPatternSetCells(BackingPattern* p, const char* text, const char** error);

// index 番目のマスが音のとき、のばす長さ（マスの数）= 1 + 続く '-' の数。maxSlots を超えない
int backingHoldSlots(const BackingPattern& p, int index, int maxSlots);

// ---- プリセット（最初から入っているパターン）----
const DrumPattern* drumPresetById(int id);          // 1〜。なければ nullptr
const BackingPattern* backingPresetById(int id);

// ---- 保存形式（NVS に書くバイト列）----
// 戻り値: バイト数（失敗は 0）。out は最大 RHYTHM_SERIALIZED_MAX バイト
const size_t RHYTHM_SERIALIZED_MAX = 2 + RHYTHM_NAME_BYTES + DRUM_LANES * RHYTHM_MAX_SLOTS;
size_t drumPatternSerialize(const DrumPattern& p, uint8_t* out, size_t outSize);
bool drumPatternDeserialize(const uint8_t* data, size_t len, DrumPattern* p);   // 中身を検査する。壊れていれば false
size_t backingPatternSerialize(const BackingPattern& p, uint8_t* out, size_t outSize);
bool backingPatternDeserialize(const uint8_t* data, size_t len, BackingPattern* p);
