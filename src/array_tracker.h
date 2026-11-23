#pragma once
#include <stdint.h>
#include <string.h>

#include "reader_array.h"  // ReaderEvent, ReaderEventType, TagUid

// ============================================================
// リーダーの並び全体で、「どのリーダーに、どの駒が載っているか」を決める部品（Arduino に依存しない）
//
//   RC522 を隣どうしに並べると、1枚の駒を、載っていない隣のリーダーも読んでしまうことがある
//   （2026-10-19 の実機: リーダー5に置いた駒を、リーダー6も読む）。
//   同じ駒を2つのリーダーが読むと、そのまま使えば、駒が2か所にあることになってしまう。そこで、
//     ・同じ駒を複数のリーダーが読んだときは、「一番弱い電波から読めるリーダー」を持ち主にする
//       （駒の真下のリーダーが、一番強く結びついている。受信感度を 18 → 23 → 33 dB… と上げながら、どれが先に読めるかを比べる）
//     ・持ち主でないリーダーは「影」とする。影のリーダーは、その駒を無視する（駒が載っているとは数えない）
//     ・影のリーダーに、本当に別の駒が載っていたら、それも別に見つける
//       （各リーダーは、電波の届く範囲の駒を、全部読む。1枚だけ読むと、隣の駒に隠されて、自分の駒が見えなくなる）
//   1つのリーダーに載せられる駒は1枚だけ。すでに別の駒が載っているリーダーは、ほかの駒の持ち主にならない。
//
//   新しく見えた駒は、すぐには「置かれた」としない。ほかのリーダーが全員、あとで1回ずつ読まれて
//   （そこでも同じ駒が見えるか確かめて）から、持ち主を決める。これで、隣のリーダーが先に読んで
//   「置かれた」と知らせてしまうのを防ぐ。
//
//   poll() 1回で行う RF の読み取りは、多くて1回（約20〜30ms）。持ち主を決める比べ読みも、1回ずつに分けて進める
//   （音を鳴らす時刻に、読み取りが割り込んでも、ずれが小さいように）。
//   RF の読み取りは ArrayRf（本物は reader_array.cpp、パソコンのテストでは偽物）に頼む。
// ============================================================

class ArrayRf {
 public:
  enum { SCAN_GARBLED = -1 };
  virtual ~ArrayRf() {}
  virtual bool alive(int reader) = 0;
  // リーダーの電波の届く範囲にいる駒を、全部読む（最大 maxTags 枚。同じ駒は1回だけ）。見つけた枚数を返す。
  //   戻り値が負（SCAN_GARBLED）: 「返事はあったのに、読めなかった」（電波の乱れ・衝突）。駒が、ある・ないは、分からない。
  //     何も答えない（タイムアウト）ときの 0 とは、別。タイムアウトは「駒がない」の証拠だが、読めなかっただけでは、駒がないとは言えない
  //   level < 0: いまの標準の感度で読む。 level >= 0: 感度の階段の段 level で読む（0 が一番弱い。段の数は levelCount()）
  //   sub: 段の中での細かい調整（受信のしきい値）。0 = 標準。正の数ほど感度が高い（弱い信号も受け付ける）、負の数ほど低い。level < 0 のときは無視
  virtual int scan(int reader, int level, int sub, TagUid* out, int maxTags) = 0;
  // 次の scan() で、このリーダーに載っているはずの駒（expected。なければ nullptr）を、教える（1回だけ有効）。
  //   本物のリーダーは、その駒の UID を知っているので、衝突回避（UID を1ビットずつ探す手順）をやめて、直接「この UID の駒、答えて」と呼びかけられる。
  //   隣の駒が同時に答えて衝突しても、一致する駒だけが答えるので、読み損ないが減る（2026-11-16 の実機: リーダー6 で、呼びかけは通るのに UID を読めない、が9割）
  //   confirmOnly = true: その駒が読めたら、ほかの駒（隣の駒）は探さない（HALT と、もう1度の REQA を省く）。
  //     この2つは、駒が答えないので、返事の待ち時間（約10ms）をいっぱいまで待つ。省くと、載っている駒を確かめる読み取りが、約34ms → 約14ms になる（2026-11-18 の実機）。
  //     持ち主がいるリーダーの確認と、比べ読みの1回（駒 u が読めるかだけを見る）で使う。新しい駒を探す読み取り（持ち主のいないリーダー）では、使わない
  virtual void hint(int reader, const TagUid* expected, bool confirmOnly = false) { (void)reader; (void)expected; (void)confirmOnly; }
  // 登録済みの駒の UID の一覧（本物は、tag_store）。新しく載った駒を、衝突回避で読めなかったとき、候補として、1つずつ呼びかけてみるのに使う
  virtual int knownCount() { return 0; }
  virtual bool knownAt(int index, TagUid* out) { (void)index; (void)out; return false; }
  virtual int defaultLevel() = 0;   // 標準の感度は、段の何番目か
  virtual int levelCount() = 0;     // 段の数
  virtual uint32_t nowMs() = 0;
};

class ArrayTracker {
 public:
  enum {
    MAX_READERS = 8,
    MAX_OBS = 4,    // 1つのリーダーが同時に覚えておく駒の数（自分の駒 + 隣の駒の影）
    MAX_SCAN = 4    // 1回の読み取りで拾う駒の数の上限
  };
  // 持ち主の駒が「外れた」と判断する条件: この回数だけ続けて読めず、かつ最初に読めなかってから、この時間（ms）以上たっている。
  //   2026-11-15 の実機: 動かしていない駒が、95〜370 ms のあいだ、続けて読めなくなることがある（1〜2分に1回ほど。リーダー3）。
  //   以前の条件（90 ms）では、そのたびに「外れた → 置かれた」と知らせてしまい、ゲームの駒が一瞬消えた。
  //   そこで、「外れた」と知らせるまでに、猶予（MISS_MIN_MS）をおく。駒が本当に外されたときは、その分だけ遅れて知らせる。
  //   猶予のあいだに駒がまた読めたら、何も知らせない（ちらつきを吸収する）。
  //   2026-11-18: 500 → 400 ms（「外れた」の知らせを、約0.1秒早くする。2026-11-15 の実機の、いちばん長い途切れが 370 ms）。猶予が終わる直前には、高い感度で読み直す
  //   「最後の確かめ」をするので、読み取りが悪いだけの駒（実機で、4.8秒続けて標準の感度では読めない駒があった）は、これまでどおり、救われる
  static const uint8_t MISS_LIMIT = 3;
  static const uint32_t MISS_MIN_MS = 400;
  // 読めなかったとき、次の周回を待たずに、同じリーダーをすぐ読み直す回数（それ以上は、ふつうの巡回にもどる。ほかのリーダーを待たせないため）
  static const uint8_t QUICK_RETRY = 2;
  // 持ち主の駒が、この回数続けて読めなかったら、高い感度で読み直してみる（早めの救済）。「外れた」と決める直前にも、もう一度する（最後の確かめ）。
  //   電波が弱くて、受信が追いつかないだけなら、感度を上げると読める。本当に外れているなら、どの感度でも読めない
  static const uint8_t RESCUE_AT_MISS = 2;
  static const uint8_t RESCUE_PROBES = 2;   // 1回の救済で、高い感度の段を、上から何段、試すか
  // 「返事はあったのに読めない」（衝突回避の失敗）が続くリーダーは、載っているはずの駒の UID を1つずつ呼びかけてみる（直接 SELECT は、衝突があっても成功する）。
  //   そのとき、次の周回を待たず、同じリーダーを続けて読む（最大この回数。あとは、ふつうの巡回にもどる。ほかのリーダーを待たせない）。
  //   2026-11-16 の実機: 位置2・位置6（リーダー3・6）は、衝突回避が失敗しやすく、置いても、なかなか反応しなかった
  static const uint8_t GUESS_BURST = 8;
  //   ただし、続けて読むのは、「直前まで、きれいに読めていた（何も答えない空き・駒が読めた）リーダーが、急に、読めなくなったとき」だけ（置かれたばかりの可能性が高い）。
  //   隣の駒の電波が漏れているだけのリーダーは、「読めない」が断続的に続く。そのたびに8回続けて読むと、1周が、とても長くなる（2026-11-18 の実機の統計:
  //   リーダー2 は「読めない」8565回に対して、候補の呼びかけ 8521回・見つかったのは 1回）。そういうリーダーは、1周に1回ずつ、候補を試す
  static const uint8_t BURST_MIN_CLEAN = 4;
  // 持ち主のいるリーダーの確認は、ふだんは「確かめるだけ」（hint の confirmOnly）の読み取りにして、時間を短くする（1台 約34ms → 約14ms）。
  //   ただし、ほかの駒（隣の駒・新しく載った駒・隣へ滑らせた駒）を見つけるには、そのリーダーを、ふつうに（ほかの駒も探して）読む必要がある。
  //   そこで、このリーダーの確認のうち、FULL_SCAN_EVERY 回に1回は、ふつうに読む。1周は、約270ms → 約150ms（8台とも駒があるとき）
  static const uint8_t FULL_SCAN_EVERY = 3;
  static const int RECENT_N = 4;            // 最近、外れた持ち主の駒を、いくつ覚えておくか（置き直されることが多いので、候補の最初に試す）
  // 影（持ち主でない観測）を忘れる条件: この回数だけ続けて読めなかった。影は読めたり読めなかったりするので、長めに覚えておく
  static const uint8_t SHADOW_MISS_LIMIT = 6;
  // 影のリーダーがいるとき、持ち主をもう一度確かめる間隔（ms）。駒を滑らせて隣のリーダーに移したときに、持ち主を直す
  static const uint32_t RECHECK_MS = 5000;
  // 読み取りが、これ以上（ms）止まっていたら、そのあいだに溜まった「読めなかった」の途中経過は捨てる。
  //   読み取りが止まる（ブザーを鳴らしている間は読まない・ほかの処理で待たされる）と、「最初に読めなかってから 90ms たった」という条件が、
  //   すぐ満たされてしまう。そのまま続けると、止まる前の1〜2回の読み損ないに、止まったあとの1〜2回が足されて、動かしていない駒を「外れた」としてしまう。
  //   ふつうの巡回では、読み取りの間隔は 20〜30ms 程度なので、この値には届かない
  static const uint32_t GAP_FORGET_MS = 200;
  // 「返事はあったのに読めない」読み取り（SCAN_GARBLED）は、駒がある・ないの証拠にならないので、「読めなかった」とは数えない。
  //   2026-11-15 の実機: リーダー3の駒を扱っている間に、リーダー8の動かしていない駒が、約90msの間に、11回続けて読めず、「外れた」と誤判定された。
  //   本当に外したときは、何も答えない（タイムアウト）ので、そちらは、これまでどおり「外れた」になる。
  //   ただし、これだけ続いたら、読めなかったものとして数える（いつまでも、外れたかどうかを決められなくならないように）
  static const uint8_t GARBLED_LIMIT = 30;

  // 直近の「持ち主の判定」の記録（診断用。比べ読みをしたものだけ）
  struct VerdictInfo {
    TagUid uid;
    uint8_t n;                  // 候補のリーダーの数
    int8_t reader[MAX_READERS]; // 候補のリーダー
    uint8_t score[MAX_READERS]; // 得点（読めた回数。1つ下の段で読めたら 2 点）
    int8_t foundLevel;          // 最初に読めた感度の段（誰も読めなければ -1）
    int8_t winner;              // 持ち主になったリーダー（別の駒に邪魔されて決まらなければ -1）
    bool recheck;               // 影があるときの定期的な確かめ直しか（false = 新しく見えた駒）
    int8_t fineSub;             // 細かい比べで決まったときの、しきい値を下げた段数（使わなかった・決まらなかったら 0）
    int8_t fineWinner;          // 細かい比べで決まった持ち主のリーダー（なければ -1）
    bool fineRan;               // 細かい比べをしたか
  };

  // イベント（置かれた・外れた・交換）が起きた「原因」の記録（診断用。SHADOWLOG ON で表示する）。
  //   「駒を動かしていないのに、別のリーダーの駒が、外れた → 置かれた と知らせられる」ときに、何が起きたかを調べるため
  enum EventCause : uint8_t {
    CAUSE_NEW,       // 新しく見えた駒が、持ち主に決まった（競争相手なし）
    CAUSE_WON,       // 比べ読みで、持ち主に決まった
    CAUSE_MISS,      // 持ち主の駒が、続けて読めなくなった（外れた）
    CAUSE_LOST,      // 比べ読みで負けて、持ち主でなくなった（駒は、ほかのリーダーのものになった）
    CAUSE_BUMP_OUT,  // 同点だったので、空いている別のリーダーへ移ってもらった（元のリーダーから外れた）
    CAUSE_BUMP_IN,   // 同点だったので、別のリーダーから移ってきた
    CAUSE_SWAP_OUT,  // 2枚が場所を取り合っていたので、入れ替えた（外れた側）
    CAUSE_SWAP_IN,   // 同上（置かれた側）
    CAUSE_STALE,     // 持ち主のリーダーに残っていた古い駒を、新しい駒に入れ替えた（交換）
    CAUSE_GARBLED,   // イベントではない。「返事はあったのに読めない」読み取りが続いたのが、おさまった（miss = 続いた回数）
    CAUSE_RESCUED,   // イベントではない。持ち主の駒が読めなくなったが、高い感度で読み直したら、いた（miss = 続けて読めなかった回数、missMs = その時間）
    CAUSE_ABSORBED   // イベントではない。持ち主の駒が読めなくなったが、「外れた」と決める前に、また読めた（ちらつきを吸収した。miss・missMs 同上）
  };
  struct EventNote {
    ReaderEventType type;
    int8_t reader;
    TagUid uid;
    EventCause cause;
    uint8_t miss;        // CAUSE_MISS のとき: 続けて読めなかった回数
    uint32_t missMs;     // CAUSE_MISS のとき: 最初に読めなかってからの時間（ms）
  };
  // 前に取り出したあとに起きたイベントの原因を、古いほうから1件ずつ取り出す（8件までためておく。あふれたら古いほうを捨てる）
  bool takeNote(EventNote* out);

  // リーダーごとの読み取りの統計（診断用。RSTAT で表示する）。持ち主の駒が載っているリーダーだけが、数えられる
  struct ReaderStats {
    uint32_t hits;           // 持ち主の駒を、標準の感度で読めた回数
    uint32_t misses;         // 持ち主の駒が読めなかった（何も答えなかった）回数
    uint32_t garbled;        // 「返事はあったのに読めない」読み取りの回数（駒のあるなしにかかわらず）
    uint32_t rescueTries;    // 高い感度で読み直した回数
    uint32_t rescued;        // そのうち、駒が読めて、救えた回数
    uint32_t absorbed;       // 読めなくなったが、「外れた」にならずに、また読めた回数（猶予で、ちらつきを吸収した）
    uint32_t longestMs;      // そのうち、いちばん長く読めなかった時間（ms）
    uint32_t removedByMiss;  // 「続けて読めなくなった」ことで、外れたと知らせた回数
    uint32_t guesses;        // 持ち主のいないリーダーで、候補の UID を呼びかけてみた回数
    uint32_t guessHits;      // そのうち、その駒が見つかった回数
  };
  const ReaderStats& stats(int reader) const { return stats_[reader]; }
  // 診断用（RETEST）: そのリーダーの持ち主の記録を、イベントを出さずに忘れさせる（駒は、載ったまま）。そのあと、新しく置かれた駒として、見つけ直す。持ち主がいなければ false
  bool forgetOwner(int reader, TagUid* uidOut);
  void resetStats() { memset(stats_, 0, sizeof(stats_)); }

  ArrayTracker(ArrayRf* rf, int numReaders);

  void reset();

  // 1回呼ぶごとに、少しずつ進める。何か起きたときだけ true
  //   置かれた(PLACED)・同じリーダーで駒が入れ替わった(CHANGED)・外れた(REMOVED)。
  //   持ち主が別のリーダーに変わるときは、外れた → 置かれた の順に、2回に分けて返る
  bool poll(ReaderEvent* event);

  // いま知らせ済みの状態（持ち主の駒だけ。影は含まない）
  bool hasTag(int reader) const { return present_[reader]; }
  const TagUid& uid(int reader) const { return uids_[reader]; }

  // このリーダーは、いま「影」（ほかのリーダーの駒を読んでいるだけ）か。持ち主が分かれば、そのリーダー番号。なければ -1
  bool isShadow(int reader) const { return shadowOwner(reader) >= 0; }
  int shadowOwner(int reader) const;

  // 判定の途中か（新しい駒の確認中・比べ読み中・まだ渡していないイベントがある）
  bool busy() const;

  // 内部の記録に矛盾がないか（テスト・診断用）。イベントが残っている間は、まだ合わなくてよいので true
  bool consistent() const;

  // 診断・テスト用の数
  uint32_t scanCount() const { return scans_; }               // 標準の感度で、リーダーを読んだ回数
  uint32_t arbitrationCount() const { return arbitrations_; } // 持ち主を比べ読みで決めた回数
  uint32_t rescuedCount() const { return rescued_; }          // 高い感度で読み直して、持ち主の駒を救えた回数
  uint32_t verdictCount() const { return verdicts_; }         // lastVerdict() が新しくなった回数
  const VerdictInfo& lastVerdict() const { return lastVerdict_; }
  uint32_t rfOpCount() const { return rfOps_; }               // RF の読み取りの合計（比べ読みを含む）

 private:
  enum Role : uint8_t {
    ROLE_NEW,     // 見えたが、持ち主かどうか、まだ決めていない
    ROLE_OWNER,   // 持ち主（このリーダーに載っている駒として知らせてある）
    ROLE_SHADOW,  // 影（ほかのリーダーが持ち主。無視する）
    ROLE_WAIT     // このリーダーが持ち主に決まったが、別の駒がすでに載っているので、場所が空くのを待っている
  };

  // リーダー reader が、駒 uid を読んだ、という記録
  struct Obs {
    bool used;
    Role role;
    TagUid uid;
    uint8_t miss;         // 続けて読めなかった回数（0 = 直前の読み取りで読めた）
    uint32_t missSince;   // 最初に読めなかった時刻（ms）
    uint32_t born;        // 最初に読んだ読み取りの通し番号（「全員が1回ずつ読まれた」かを調べる基準）
    uint32_t checkedAt;   // 持ち主を最後に確かめた時刻（ms）。持ち主の記録だけで使う
    bool suspect;         // 持ち主の駒が、2回以上続けて読めなくなったあとで戻ってきた（動かされたかもしれない）。すぐ確かめ直す
    bool tied;            // 直前の持ち主の判定で、一番有力な候補と同点だった（決め手がなかった）
  };

  // 持ち主を比べ読みで決めている途中の記録
  enum ArbStage : uint8_t {
    ARB_ASC,       // 弱い電波から順に、候補を1回ずつ読んで、最初に読めた段を探す
    ARB_CONFIRM,   // 最初に読めた段で、もう一度読んで確かめる
    ARB_FINE,      // 同じ段で複数が読めたとき: 1つ下の段で、受信のしきい値を少しずつ下げて、どれが先に読めるかを見る
    ARB_FINE_CONFIRM,  // 細かい比べで、1人だけ読めたとき: 同じ条件でもう一度読んで確かめる
    ARB_EXTRA      // 結果が割れたとき: その段と1つ下の段を、何回か読んで、読めた回数で決める
  };
  struct Arb {
    bool active;
    TagUid u;
    uint8_t n;
    int8_t cand[MAX_READERS];   // 候補のリーダー
    int8_t incumbent;           // いまの持ち主（いなければ -1）
    ArbStage stage;
    uint8_t level;              // ASC で調べている段
    uint8_t top;                // 調べる段の上限
    uint8_t idx;                // いまの回で、次に読む候補
    uint8_t pass;               // EXTRA の何回目か
    uint8_t mask;               // いまの回で読めた候補（ビット = 候補の番号）
    uint8_t firstMask;          // 最初に読めた回の結果
    uint8_t foundLevel;         // 最初に読めた段
    uint8_t fineMask;           // 細かい比べの対象（同じ段で読めた候補。ビット = 候補の番号）
    uint8_t fineHit;            // 細かい比べで、1人だけ読めたときの、その候補
    uint8_t fineSub;            // 細かい比べで、いま試している、しきい値を下げる段数（1〜FINE_MAX_SUB）
    int8_t fineWinner;          // 細かい比べで決まった候補の番号（なければ -1）
    uint8_t fineWinSub;
    bool fineRan;
    bool found;                 // どこかの段で読めたか
    bool recheck;               // 定期的な確かめ直しか
    uint8_t score[MAX_READERS]; // 読めた回数の得点（1つ下の段で読めたら 2 点）
  };

  enum { EXTRA_PASSES = 3 };
  enum { FINE_MAX_SUB = 5 };   // 細かい比べで、受信のしきい値を下げる最大の段数（MinLevel 8 → 3。2 以下は雑音で読めなくなる）   // EXTRA で、同じ段を読み直す回数（1つ下の段も同じ回数）
  enum { QUEUE_SIZE = 8 };

  ArrayRf* rf_;
  int n_;
  Obs obs_[MAX_READERS][MAX_OBS];
  uint32_t lastSeq_[MAX_READERS];   // そのリーダーを最後に標準の感度で読んだときの通し番号
  uint32_t seq_;
  int next_;
  bool present_[MAX_READERS];
  TagUid uids_[MAX_READERS];
  Arb arb_;
  ReaderEvent queue_[QUEUE_SIZE];
  int qHead_;
  int qCount_;
  EventNote notes_[QUEUE_SIZE];
  int noteHead_;
  int noteCount_;
  uint32_t scans_;
  uint32_t arbitrations_;
  uint32_t rfOps_;
  uint32_t verdicts_;
  VerdictInfo lastVerdict_;
  uint8_t garbled_[MAX_READERS];   // そのリーダーの、「返事はあったのに読めない」読み取りが、いま何回続いているか
  uint8_t clean_[MAX_READERS];     // そのリーダーの、「読めない」のではない読み取り（何も答えない・駒が読めた）が、いま何回続いているか
  uint8_t quickTurn_[MAX_READERS]; // そのリーダーの、持ち主の確認の回数（FULL_SCAN_EVERY 回に1回、ふつうに読む）
  bool burst_[MAX_READERS];        // いまの「読めない」の続きは、置かれたばかりらしい（続けて読んで、候補を次々に試す）か
  ReaderStats stats_[MAX_READERS];

  // 救済（高い感度での読み直し）の途中の記録。poll() 1回につき、RF の読み取り1回
  struct Rescue {
    bool active;
    bool last;        // 最後の確かめか（失敗したら、そのまま「外れた」にする）
    int8_t reader;
    TagUid uid;
    uint8_t step;     // 次に試す番号（0 〜 RESCUE_PROBES-1）
    uint8_t startMiss;
    uint32_t startMs;
  };
  Rescue rescue_;
  TagUid recent_[RECENT_N];      // 最近、外れた持ち主の駒（新しいものが先頭）
  int recentCount_;
  uint8_t guessIdx_[MAX_READERS];   // 候補を、どこまで試したか（読み取りごとに1つずつ進める）
  uint32_t rescued_;   // 救済で駒が読めた回数の合計
  bool pickGuess(int reader, TagUid* out);
  bool ownedAnywhere(const TagUid& u) const;
  void startRescue(int reader, const Obs& o, bool last);
  void stepRescue();
  uint32_t lastRfMs_;   // 最後に RF の読み取りをした時刻（ms）
  bool haveRf_;         // まだ1回も読んでいない間は false

  static bool same(const TagUid& a, const TagUid& b);
  Obs* findObs(int reader, const TagUid& u);
  const Obs* findObs(int reader, const TagUid& u) const;
  int ownerIndex(int reader) const;   // そのリーダーの持ち主の記録の番号（なければ -1）
  Obs* freeObs(int reader);
  void wakeWaiters(int reader);       // このリーダーで場所が空くのを待っていた駒を、もう一度確かめる

  void pushNote(ReaderEventType type, int reader, const TagUid& uid, EventCause cause, uint8_t miss, uint32_t missMs);
  void enqueue(ReaderEventType type, int reader, const TagUid& uid, EventCause cause, uint8_t miss = 0, uint32_t missMs = 0);
  bool popEvent(ReaderEvent* event);

  void scanNext();
  bool probe(int reader, int level, int sub, const TagUid& u);
  void dropObs(int reader, int k, uint8_t miss, uint32_t missMs);
  void releaseOwner(int reader, int k, bool emitRemoved, uint8_t miss, uint32_t missMs);

  bool probationDone(const TagUid& u) const;
  bool hasActiveShadow(const TagUid& u) const;
  void beginPending();
  void decide(const TagUid& u, bool recheck);
  void stepArbitration();
  void stepFine();
  bool better(int i, int j) const;
  bool tryBump(int reader, int occ);
  void finishArbitration();
  void applyVerdict();
  void forgetMisses();   // 「読めなかった」の途中経過を、すべて捨てる（読み取りが止まっていたあと）
};
