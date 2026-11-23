#pragma once
#include <stdint.h>

#include "tag_store.h"  // TagUid

// ============================================================
// 複数のRC522を、1本のSPIバスにつないで使うための部品
//
//   リーダー番号 0, 1, ...  ＝ 配線の順番（reader_array.cpp のピン表の順）。画面には「リーダー1, 2, ...」と出る。
//   どのリーダーが「位置1, 2, ...」（コード進行の順番）かは、別の表（layout.h・board.cpp）で決まる。
//   SCK / MOSI / MISO は全員で共有。SS(SDA) と RST は1台ごとに別のGPIO。
//
// 台数は 8台（4×2）。配線していないリーダーは、起動時に「応答なし」になって、使われない（位置は「空」= 休み）。
// パソコン上のテストや、4台だけの実機のテストでは、-DNUM_READERS_CONFIG=4 で4台にできる。
// ============================================================

#ifndef NUM_READERS_CONFIG
#define NUM_READERS_CONFIG 8
#endif
const int NUM_READERS = NUM_READERS_CONFIG;

// 使っていないリーダーを、どうやって静かにさせておくか
//   読むリーダーは1台ずつ。ほかのリーダーは、読んでいない間、次のどちらかの状態にしておく。
//   IDLE_ANTENNA_OFF: 電波（アンテナの駆動）だけ止める。チップは動いたまま（約13.5mA）。
//                     データシートでは、このときの TX端子の状態は「規定なし」。
//   IDLE_RESET      : RST を LOW にして、チップごと止める（ハードパワーダウン、約5µA）。
//                     発振も、受信も止まる。TX端子は HIGH か LOW に固定される（データシートの記述）。
//                     読むときだけ、速く起こして設定し直す（約5〜10ms）。
enum IdleMethod {
  IDLE_ANTENNA_OFF,
  IDLE_RESET
};

const char* readersIdleMethodName(IdleMethod method);   // 画面に出す名前

// 起動時に1回呼ぶ。ピンの準備とSPIの開始をする（全リーダーはRST=LOWで止まった状態になる）。
// そのあと、リーダーごとに readersProbe() を呼ぶこと
void readersBegin(int sckPin, int misoPin, int mosiPin);

// リーダーのピン番号（表示用）
int readerSsPin(int i);
int readerRstPin(int i);

// 止め方を切り替える（全リーダーをその状態にする）。
// verify が true（標準）で IDLE_RESET のときは、切り替える前に、全リーダーを起こして正しく読めるか自己診断する。
// 診断に失敗したら、止め方は変えずに false を返す（readersLastSelfTestFailures() に、失敗したリーダーの数）
bool readersSetIdleMethod(IdleMethod method, bool verify = true);
IdleMethod readersIdleMethod();
int readersLastSelfTestFailures();
uint32_t readersSlowWakeCount();   // RESET方式で、速い起こし方に失敗して、確実な方法にした回数（診断用。0 が理想）

// 受信の感度（dB）。18 / 23 / 33（標準）/ 38 / 43 / 48。下げると、遠くのタグや、隣のリーダーのタグを拾いにくくなる。
// 使えない値なら false。すぐに全リーダーに反映される
bool readersSetGainDb(uint8_t db);
uint8_t readersGainDb();
bool readersGainValid(uint8_t db);

// アンテナの駆動の強さ（RC522 の CWGsPReg）。標準は 0x20。小さいほど弱く、電波が遠くまで届かなくなる（0x01〜0x3F）。
// 受信感度（上）は「返事を聞き取る力」、これは「呼びかける電波の強さ」。隣のリーダーのタグまで読んでしまうときに調整する。
// 使えない値なら false。すぐに全リーダーに反映される
bool readersSetRfPower(uint8_t cwGsP);
uint8_t readersRfPower();

// 受信のしきい値（RC522 の RxThresholdReg の上の4ビット MinLevel。0〜15）。標準は 8。
// 大きいほど、強い信号しか受け付けない（= 感度が低い）。受信感度（dB）は 5〜10dB ずつしか変えられないので、
// これで、その間を細かく比べられる（本命のリーダーと、隣のリーダーの見分けに使う。x → f）。
// 使えない値なら false。すぐに全リーダーに反映される
bool readersSetRxMinLevel(uint8_t level);
uint8_t readersRxMinLevel();

// ---- 診断用（x → k の「隣のリーダーを読む原因調べ」）----
// true にすると、読むとき電波を出さない。それでも読めてしまうなら、電波以外（配線・SPI の経路）に原因がある
void readersDebugAntennaOff(bool off);
// リーダー i の電波の届く範囲にいるタグを、最大 maxTags 枚まで、全部読む（1枚ずつ眠らせながら）。見つけた枚数を返す
int readersScanAll(int i, TagUid* out, int maxTags);

// リーダーを初期化し直して、RC522が応答するか調べる。応答すれば true
// version にはバージョン値（0x91 / 0x92 など）が入る。0x00 や 0xFF は「応答なし」
bool readersProbe(int i, uint8_t* version);

// 起動時に応答したリーダーだけ true（応答しないリーダーは読み取りの対象から外す）
bool readerIsAlive(int i);

// i 番のリーダーに、いまタグが載っているか調べる。載っていれば true と UID を返す。
// 1台ぶん、約 10〜20ms かかる（config.h の RC522_TIMEOUT_MS などで決まる）
bool readersScanOne(int i, TagUid* uid);

// ---- 診断用（x → t の「待ち時間の総当たりテスト」で使う）----
// タグの返事を待つ時間などを、実行中に変える（標準は config.h の RC522_SETTLE_MS / RC522_TIMEOUT_MS）。
// settleMs: アンテナをONにしてから、最初の呼びかけまで待つ時間。timeoutMs: タグの返事を待つ時間
void readersSetTiming(uint8_t settleMs, uint8_t timeoutMs);
uint8_t readersSettleMs();
uint8_t readersTimeoutMs();

// 1回の読み取りの、中身の記録
struct ScanDiag {
  bool wokeFast;        // 止まっていたリーダーを、速い方法で起こせたか（止まっていなかったときは true）
  bool wasInReset;      // 読む前は RST=LOW で止まっていたか
  uint32_t wakeUs;      // 起こすのにかかった時間(µs)
  uint8_t version;      // 起こしたあとの VersionReg（正しい値か）
  uint8_t txControl;    // アンテナをONにしたあとの TxControlReg（下位2ビットが 11 なら、電波が出ている）
  int wupaStatus;       // 呼びかけ(WUPA)の結果。0=OK 1=エラー 2=衝突 3=返事なし(タイムアウト) 7=CRC不一致 …
  uint8_t errorReg;     // 呼びかけの直後の ErrorReg
  bool serialOk;        // UID を読めたか
  bool found;           // タグが見つかったか
  uint32_t totalUs;     // 1回の読み取り全体の時間(µs)
};
bool readersScanDiag(int i, TagUid* uid, ScanDiag* diag);

// ---- 通常の動作用 ----
// 応答するリーダーが何台あるか
int readersAliveCount();

// リーダーで起きた出来事
enum ReaderEventType {
  READER_EVENT_PLACED,   // 空だったリーダーに、タグが置かれた
  READER_EVENT_CHANGED,  // 載っていたタグが、別のタグに交換された
  READER_EVENT_REMOVED   // タグが外れた（uid は、外れたタグ）
};
struct ReaderEvent {
  ReaderEventType type;
  int reader;   // リーダー番号（0から数える）
  TagUid uid;   // 置かれた／交換後／外れたタグのUID
};

// 1回呼ぶごとに、リーダーを1台ずつ順番に調べる（巡回する）。何か起きたときだけ true を返す。
// 置きっぱなしのタグ・何もないときは false。
// 1回の読み損ないで「外れた」と判断しないよう、3回続けて読めず、かつ 90ms 以上たったら外れたとみなす。
// 1回の呼び出しで行う RF の読み取りは、多くて1回（約20〜30ms）。
//
// 隣のリーダーが、載っていない駒を読んでしまう（影）ことがある。そこで、新しく見えた駒は、すぐには「置かれた」とせず、
// ほかのリーダーも全員読んだあとで、一番弱い電波から読めるリーダーを持ち主にする（array_tracker.h）。
// このため、置いてから「置かれた」が出るまで、約 0.3 秒かかる。
bool readersPollNext(ReaderEvent* event);

// 起動時: 置いてある駒を見つけ終わる（持ち主が決まる）まで、読み続ける。最大 maxMs ミリ秒。
// 見つけた駒の知らせ（イベント）は捨てる。持ち主の記録は残るので、読み終わったあとの readerHasTag で分かる
void readersScanUntilSettled(uint32_t maxMs);

// いま、リーダー i にタグが載っているか（上の見張りで分かっている状態。持ち主のリーダーだけ）と、そのUID
bool readerHasTag(int i);
const TagUid& readerTagUid(int i);

// リーダー i は、いま「影」（隣のリーダーに載っている駒を読んでいるだけ）か。そうなら、その駒の持ち主のリーダー番号。そうでなければ -1
bool readerIsShadow(int i);
int readerShadowOwner(int i);
// 持ち主を比べ読みで決めた回数（診断用）
uint32_t readersArbitrationCount();
// 巡回で1台を読むのにかかる時間の、最近の平均（µs。診断用。まだ読んでいなければ 0）
uint32_t readersAvgScanUs();

// 直近の「持ち主の判定」（比べ読みをしたもの。診断用。SHADOWLOG ON で表示される）
struct ReaderVerdict {
  TagUid uid;
  int n;              // 候補のリーダーの数
  int reader[8];      // 候補のリーダー（有力な順。0から数える）
  int score[8];       // その得点（読めた回数。1つ下の段で読めたら 2 点）
  int foundDb;        // 最初に読めた受信感度（dB）。誰も読めなかったときは 0
  int winner;         // 持ち主になったリーダー（0から）。決まらなかったら -1
  bool recheck;       // 影があるときの定期的な確かめ直し（false = 新しく見えた駒）
  bool fineRan;       // 同じ感度から複数が読めたため、受信のしきい値を細かく動かして比べたか
  int fineSub;        // 細かい比べで決まったときの、しきい値を下げた段数（決まらなければ 0）
  int fineWinner;     // 細かい比べで決まった持ち主のリーダー（0から。なければ -1）
};
// 前に取り出したあとに、新しい判定があれば true（1回に1件。取り出す前に次の判定が来たら、古いほうは捨てる）
bool readersTakeVerdict(ReaderVerdict* out);

// 置かれた・外れた・交換のイベントが、なぜ起きたか（診断用。SHADOWLOG ON で表示される）。古いほうから1件ずつ取り出す。なければ false
//   「駒を動かしていないのに、別のリーダーの駒が、外れた → 置かれた と知らせられる」ときの、原因調べに使う
struct ReaderEventNote {
  ReaderEventType type;
  int reader;           // リーダー番号（0から数える）
  TagUid uid;
  const char* cause;    // 原因の説明（日本語）
  bool byMiss;          // 続けて読めなくなったことが原因か（miss・missMs が使える）
  bool garbled;         // イベントではなく、「返事はあったのに読めない」読み取りが続いたのが、おさまった記録（miss = 続いた回数）
  bool rescued;         // イベントではなく、持ち主の駒が読めなくなったが、高い感度で読み直したら、いた記録（miss・missMs = 読めなかった回数・時間）
  bool absorbed;        // イベントではなく、持ち主の駒が読めなくなったが、「外れた」と決める前に、また読めた記録（ちらつきを吸収した。miss・missMs 同上）
  int wupaStatus;       // garbled のとき: 最後の失敗の、呼びかけの結果（MFRC522 の StatusCode。100 = UID を読めなかった）
  uint32_t wupaUs;      // garbled のとき: 最後の失敗の、呼びかけにかかった時間（µs）
  uint8_t miss;
  uint32_t missMs;
};
bool readersTakeEventNote(ReaderEventNote* out);

// リーダーごとの読み取りの統計（診断用。RSTAT で表示する）。持ち主の駒が載っているリーダーの、標準の感度での読み取りを数える
struct ReaderStatsInfo {
  uint32_t hits;           // 持ち主の駒を読めた回数
  uint32_t misses;         // 持ち主の駒が読めなかった（何も答えなかった）回数
  uint32_t garbled;        // 「返事はあったのに読めない」読み取りの回数
  uint32_t rescueTries;    // 高い感度で読み直した回数
  uint32_t rescued;        // そのうち、駒が読めて、救えた回数
  uint32_t absorbed;       // 読めなくなったが、「外れた」にならずに、また読めた回数
  uint32_t longestMs;      // そのうち、いちばん長く読めなかった時間（ms）
  uint32_t removedByMiss;  // 「続けて読めなくなった」ことで、外れたと知らせた回数
  uint32_t directOk;       // 載っているはずの駒を、UID を指定して直接呼びかけて（衝突回避なしで）確かめられた回数
  uint32_t directFail;     // 直接の呼びかけを試したが、確かめられなかった回数
  uint32_t guesses;        // 持ち主のいないリーダーで、候補の UID を呼びかけてみた回数（衝突回避が失敗し続けたとき）
  uint32_t guessHits;      // そのうち、その駒が見つかった回数
};
// 診断用（RETEST）: そのリーダー（0から数える）の持ち主の記録を、黙って忘れさせて、「新しく置かれた駒」として見つけ直すまでの時間を測る。
//   駒は、載ったまま。見つかったときの「置かれた」は、上へ渡さない（盤面は変わらない）。始められたら true（持ち主がいない・測定中は false）
bool readersRetest(int reader);
// 測定の結果を1件取り出す（なければ false）。ms = 見つかるまでの時間（見つからなかったら 0）。ok = 同じリーダーで見つかったか
bool readersTakeRetestResult(int* reader, uint32_t* ms, bool* ok);
// 診断用（MARGIN）: そのリーダーに載っている駒を、受信感度の段ごとに tries 回ずつ読んで、読めた回数を数える（読めなければ、その感度では、余裕がない）。
//   hits[] は、段の数（readersGainLevels()）ぶん。駒が載っていなければ false。数秒かかる（その間、ほかのリーダーは読まない）
bool readersMarginTest(int reader, int tries, int* hits);
int readersGainLevels();
int readersGainDbAt(int level);
bool readersStatsGet(int reader, ReaderStatsInfo* out);
void readersStatsReset();

// 「どのリーダーに何が載っているか」の記憶を消す（テストモードから戻ったときなど）
void readersResetPresence();

// 通信テスト用: バージョンレジスタを rounds 回ずつ読んで、正しい値が返った回数を数える。
//   holdOthersInReset = false : 全リーダーを起こしたまま、SSだけを切り替えて交互に読む
//   holdOthersInReset = true  : 読む1台だけを起こし、ほかはRST=LOWで止めて読む
// okCount[i] / errCount[i] に結果が入る
void readersVersionTest(int rounds, bool holdOthersInReset, int* okCount, int* errCount);
