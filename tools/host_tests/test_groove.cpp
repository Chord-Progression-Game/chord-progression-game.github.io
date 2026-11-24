// groove.cpp のパソコン上テスト（時計を自分で動かして、タイミング・コード・パターンを確かめる）
//   実行: tools/host_tests/run_all.sh
#include "groove.h"

#include <stdio.h>
#include <string.h>

#include <algorithm>
#include <string>
#include <vector>

static int fails = 0, checks = 0;
static void eqi(const std::string& w, long long g, long long e) {
  checks++;
  if (g != e) { fails++; printf("FAIL %s: got %lld want %lld\n", w.c_str(), g, e); }
}
static void ok(const std::string& w, bool c) { eqi(w, c ? 1 : 0, 1); }

// 起きたことを、時刻つきで記録する
struct Rec : GrooveListener {
  uint32_t now = 0;
  uint8_t raw[8] = {1, 2, 3, 4, 0, 0, 0, 0};   // 位置ごとの駒（0=空 99=→）
  struct Ev { uint32_t ms; bool on; uint8_t ch, note, vel; int batch; };
  struct Step { uint32_t ms; StepInfo info; };
  std::vector<Ev> ev;
  std::vector<Step> steps;
  int batches = 0;
  std::vector<int> batchSizes;

  uint8_t rawChordAtStep(int step) override { return raw[step]; }
  void stepStarted(const StepInfo& info) override { steps.push_back({now, info}); }
  void emit(const MidiEvent* e, int n) override {
    batches++;
    batchSizes.push_back(n);
    for (int i = 0; i < n; i++) ev.push_back({now, e[i].on != 0, e[i].channel, e[i].note, e[i].velocity, batches});
  }
};

static void run(Groove& g, Rec& r, uint32_t from, uint32_t to, uint32_t stepMs = 1) {
  for (uint32_t t = from; t <= to; t += stepMs) { r.now = t; g.update(t); }
}
// 時刻 ms の近く（誤差 tol ms 以内）で、条件に合う指示を探す
static std::vector<Rec::Ev> evAt(const Rec& r, uint32_t ms, int tol, bool on, int ch) {
  std::vector<Rec::Ev> out;
  for (auto& e : r.ev) if (e.on == on && e.ch == ch && (int)e.ms >= (int)ms - tol && (int)e.ms <= (int)ms + tol) out.push_back(e);
  return out;
}
static std::vector<int> notesOf(const std::vector<Rec::Ev>& v) { std::vector<int> n; for (auto& e : v) n.push_back(e.note); std::sort(n.begin(), n.end()); return n; }
static bool sameNotes(std::vector<int> a, std::vector<int> b) { std::sort(a.begin(), a.end()); std::sort(b.begin(), b.end()); return a == b; }
static std::vector<Rec::Ev> evAfter(const Rec& r, size_t from) { return std::vector<Rec::Ev>(r.ev.begin() + from, r.ev.end()); }

static BackingPattern backing(const char* cells) { BackingPattern p; backingPatternClear(&p, strlen(cells)); backingPatternSetCells(&p, cells, nullptr); return p; }

// BPM 120: 1ティック = 10.4167ms。16分音符のマス(12ティック) = 125ms、1ステップ(96ティック) = 1000ms

int main() {
  const BackingPattern* B1 = backingPresetById(1);   // ロング
  const std::vector<int> I = {48, 52, 55, 60}, VIM_NOMINAL = {57, 60, 64, 69};

  // ===== 1. バッキング: ロング（1ステップ1和音）=====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(B1); g.setVoiceLeading(false);
    r.now = 0; g.start(0);
    eqi("開始直後に位置1が始まる", r.steps.size(), 1);
    eqi("最初のステップは 0", r.steps[0].info.step, 0);
    run(g, r, 1, 4100);
    auto on0 = evAt(r, 0, 1, true, 0);
    ok("時刻0に Ⅰ(C3 E3 G3 C4) が同時に出る", sameNotes(notesOf(on0), I));
    eqi("同時（1回の emit にまとまる）", on0.empty() ? -1 : (int)std::count_if(on0.begin(), on0.end(), [&](const Rec::Ev& e) { return e.batch == on0[0].batch; }), 4);
    ok("止めるのは 95%（948ms ごろ）", sameNotes(notesOf(evAt(r, 948, 2, false, 0)), I));
    ok("次のステップは 1000ms: Ⅵm", sameNotes(notesOf(evAt(r, 1000, 2, true, 0)), VIM_NOMINAL));
    ok("2000ms: Ⅳ", sameNotes(notesOf(evAt(r, 2000, 2, true, 0)), {53, 57, 60, 65}));
    ok("3000ms: Ⅴ", sameNotes(notesOf(evAt(r, 3000, 2, true, 0)), {55, 59, 62, 67}));
    ok("4000ms: 先頭に戻って Ⅰ", sameNotes(notesOf(evAt(r, 4000, 2, true, 0)), I));
    eqi("ステップは 5回（0〜4000ms）", r.steps.size(), 5);
    eqi("ステップ番号 0,1,2,3,0", r.steps[4].info.step, 0);
    for (auto& e : r.ev) if (e.on) eqi("強さ 80", e.vel, 80);
    for (auto& e : r.ev) if (!e.on) eqi("止めるときの強さは 0", e.vel, 0);
    eqi("ドラムの音は出ない", std::count_if(r.ev.begin(), r.ev.end(), [](const Rec::Ev& e) { return e.ch == 9; }), 0);
    // 鳴らした音は、必ず止める
    int on = 0, off = 0; for (auto& e : r.ev) (e.on ? on : off)++;
    ok("出した音の数 ≧ 止めた音の数（最後の和音は、まだ鳴っている）", on >= off && on - off <= 4);
  }

  // ===== 2. ドラム: 8ビート =====
  {
    Rec r; Groove g(4, &r); g.setDrumPattern(drumPresetById(2)); g.setBackingPattern(nullptr);
    r.now = 0; g.start(0); run(g, r, 1, 2100);
    // K: x.......x.x.....  S: ....x.......x...  H: x.x.x.x.x.x.x.x.
    ok("0ms: キック(36)とハイハット(42)", sameNotes(notesOf(evAt(r, 0, 1, true, 9)), {36, 42}));
    eqi("1マス(125ms)後は、何もない", evAt(r, 125, 3, true, 9).size(), 0);
    ok("250ms: ハイハット", sameNotes(notesOf(evAt(r, 250, 3, true, 9)), {42}));
    ok("500ms(マス4): スネア(38)とハイハット", sameNotes(notesOf(evAt(r, 500, 3, true, 9)), {38, 42}));
    ok("1000ms(マス8): キックとハイハット", sameNotes(notesOf(evAt(r, 1000, 3, true, 9)), {36, 42}));
    ok("1250ms(マス10): キックとハイハット", sameNotes(notesOf(evAt(r, 1250, 3, true, 9)), {36, 42}));
    ok("1500ms(マス12): スネアとハイハット", sameNotes(notesOf(evAt(r, 1500, 3, true, 9)), {38, 42}));
    ok("2000ms: 1小節ぶん進んで、パターンが先頭に戻る（キック+ハイハット）", sameNotes(notesOf(evAt(r, 2000, 3, true, 9)), {36, 42}));
    ok("ドラムの音は、62msごろ（6ティック）で止まる", sameNotes(notesOf(evAt(r, 63, 3, false, 9)), {36, 42}));
    eqi("ドラムの強さ（ふつう=85）", evAt(r, 0, 1, true, 9)[0].vel, 85);
    eqi("ピアノの音は出ない", std::count_if(r.ev.begin(), r.ev.end(), [](const Rec::Ev& e) { return e.ch == 0; }), 0);
    // ステップの始まり（1000ms）でも、コードの表示のために、ステップは進む
    eqi("ステップは進む（0〜2000ms で 3回）", r.steps.size(), 3);
  }

  // ===== 3. ドラム: メトロノーム（強・ふつう）=====
  {
    Rec r; Groove g(4, &r); g.setDrumPattern(drumPresetById(1));
    r.now = 0; g.start(0); run(g, r, 1, 1100);
    eqi("先頭は強い（112）", evAt(r, 0, 1, true, 9)[0].vel, 112);
    eqi("次の拍(500ms)はふつう（85）", evAt(r, 500, 3, true, 9)[0].vel, 85);
  }
  {
    Rec r; Groove g(4, &r); g.setDrumPattern(drumPresetById(4));   // H: XoxoXoxo...
    r.now = 0; g.start(0); run(g, r, 1, 400);
    eqi("16ビート 0: 強い(X)", evAt(r, 0, 1, true, 9).back().vel, 112);
    eqi("16ビート 125ms: 弱い(o)=45", evAt(r, 125, 3, true, 9)[0].vel, 45);
  }

  // ===== 4. ドラムとバッキングを、同時に（独立に組み合わせる）=====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(B1); g.setDrumPattern(drumPresetById(2)); g.setVoiceLeading(false);
    r.now = 0; g.start(0);
    // 時刻0: 和音4音 + キック + ハイハット が、1回の emit にまとまる
    eqi("時刻0の emit は 1回", r.batches, 1);
    eqi("時刻0の指示は 6つ（ピアノ4 + ドラム2）", r.batchSizes[0], 6);
    run(g, r, 1, 1100);
    ok("1000msにピアノの Ⅵm とドラムが同時", sameNotes(notesOf(evAt(r, 1000, 3, true, 0)), VIM_NOMINAL) && sameNotes(notesOf(evAt(r, 1000, 3, true, 9)), {36, 42}));
  }
  // 組み合わせを入れ替えても動く（バッキング4分チョップ + ドラム4つ打ち）
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(backingPresetById(2)); g.setDrumPattern(drumPresetById(3));
    r.now = 0; g.start(0); run(g, r, 1, 1100);
    ok("4つ打ち: 2拍目の頭(500ms)に キック・クラップ・ハイハット", sameNotes(notesOf(evAt(r, 500, 3, true, 9)), {36, 39, 42}));
    int kicks = 0; for (auto& e : r.ev) if (e.on && e.ch == 9 && e.note == 36 && e.ms < 1000) kicks++;
    eqi("4つ打ち: キックは1拍ごと（1ステップ=2拍の間に 2回）", kicks, 2);
    int kicks2 = 0; for (auto& e : r.ev) if (e.on && e.ch == 9 && e.note == 36) kicks2++;
    eqi("4つ打ち: 1100msまでに 3回（0, 500, 1000ms）", kicks2, 3);
    int chords = 0; for (auto& e : r.ev) if (e.on && e.ch == 0 && e.ms < 1000) chords++;
    eqi("4分チョップ: 1ステップ(2拍)に和音は2回（4音×2）", chords, 8);
  }

  // ===== 4b. 位置1に戻ったら、高さを本来に戻す =====
  {
    // どんな進行でも、2周目の位置1は、1周目の位置1と同じ音で始まる（前のコードの高さを引きずらない）
    static const uint8_t IDS[] = {1, 2, 3, 4, 9};
    int bad = 0, total = 0;
    for (uint8_t a : IDS) for (uint8_t b : IDS) for (uint8_t c : IDS) for (uint8_t d : IDS) {
      Rec r; r.raw[0] = a; r.raw[1] = b; r.raw[2] = c; r.raw[3] = d;
      Groove g(4, &r); g.setBackingPattern(B1); g.setVoiceLeading(true);
      r.now = 0; g.start(0); run(g, r, 1, 8100, 5);
      total++;
      if (r.steps.size() < 9) { bad++; continue; }
      if (memcmp(r.steps[0].info.notes, r.steps[4].info.notes, 4) != 0 || memcmp(r.steps[0].info.notes, r.steps[8].info.notes, 4) != 0) bad++;
    }
    eqi("625通りの進行で、ループの最初は本来の高さ（" + std::to_string(total) + "通り）", bad, 0);
    // 具体例: Ⅴ Ⅴ Ⅴ Ⅰ のあとは、前のコード(Ⅰが+12で高い)を引きずらず、位置1(Ⅴ)は本来の高さ。同じく Ⅰ が最後なら 3周目でも変わらない
    Rec r; r.raw[0] = 1; r.raw[1] = 4; r.raw[2] = 4; r.raw[3] = 1;
    Groove g(4, &r); g.setBackingPattern(B1); g.setVoiceLeading(true);
    r.now = 0; g.start(0); run(g, r, 1, 4100, 5);
    eqi("例: 2周目の位置1は Ⅰ(本来 C3=48)", r.steps[4].info.root, 48);
  }

  // ===== 4c. 和音の高さ（baseC）を再生中に変える =====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(B1); g.setVoiceLeading(true);
    r.now = 0; g.start(0); run(g, r, 1, 1000 + 10);
    // 位置2(Ⅵm)が始まって 10ms: 前のコード(Ⅰ=48)に近づけて A2(45)
    ok("変更前: Ⅵm は 45 から", sameNotes(notesOf(evAt(r, 1000, 3, true, 0)), {45, 48, 52, 57}));
    size_t before = r.ev.size();
    g.setBaseC(60);                      // 1オクターブ上げる
    run(g, r, 1011, 1030);
    auto ons = evAfter(r, before);
    std::vector<int> on, off;
    for (auto& e : ons) { if (e.ch == 0 && e.on) on.push_back(e.note); if (e.ch == 0 && !e.on) off.push_back(e.note); }
    ok("止める: 元の和音", sameNotes(off, {45, 48, 52, 57}));
    ok("鳴らし直し: 1オクターブ上（記憶も動くので、引き戻されない）", sameNotes(on, {57, 60, 64, 69}));
    run(g, r, 1031, 2010);
    ok("次の Ⅳ も、新しい高さ（計画は、高さを変えても同じ形。baseC=48 のときの F3=53 の、1オクターブ上 F4=65）", sameNotes(notesOf(evAt(r, 2000, 3, true, 0)), {65, 69, 72, 77}));
    eqi("baseC() で読める", g.baseC(), 60);
  }

  // ===== 5. バッキングの形 =====
  {
    // 8分チョップ C.C.C.C. : 1ステップに 4回、各 1マス（95%=11ティック=114ms）
    Rec r; Groove g(4, &r); g.setBackingPattern(backingPresetById(3)); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 1000);
    for (int k = 0; k < 4; k++) ok("8分チョップ " + std::to_string(k), sameNotes(notesOf(evAt(r, k * 250, 3, true, 0)), k < 4 ? I : I));
    ok("止めるのは +114ms ごろ", sameNotes(notesOf(evAt(r, 114, 3, false, 0)), I));
  }
  {
    // ベース+コード B...C... : ベースはルートの1オクターブ下（C2=36）、1音
    Rec r; Groove g(4, &r); g.setBackingPattern(backingPresetById(8)); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 1000);
    ok("0ms: ベース C2(36) だけ", sameNotes(notesOf(evAt(r, 0, 2, true, 0)), {36}));
    ok("500ms: 和音", sameNotes(notesOf(evAt(r, 500, 3, true, 0)), I));
    ok("1000ms(次のステップ Ⅵm=A3): ベースは 1オクターブ下の A2(45)", sameNotes(notesOf(evAt(r, 1000, 3, true, 0)), {45}));
  }
  {
    // ベースの下限: ボイスリーディングで和音が下がっても、ベースは C2(36) より下に行かない
    //   Ⅰ(48) → Ⅵm(45) → Ⅳ(41) → Ⅴ(43): ベースは 36, 45(33+12), 41(29+12), 43(31+12)
    Rec r; Groove g(4, &r); g.setBackingPattern(backingPresetById(8)); g.setVoiceLeading(true);
    r.now = 0; g.start(0); run(g, r, 1, 4000);
    int lowest = 127;
    for (auto& e : r.ev) if (e.on && e.ch == 0) lowest = std::min(lowest, (int)e.note);
    ok("ベース+コード: ピアノの音は、すべて 36 以上（lowest=" + std::to_string(lowest) + "）", lowest >= 36);
    ok("Ⅳ のベースは F2(41)（F1 にならない）", sameNotes(notesOf(evAt(r, 2000, 2, true, 0)), {41}));
    ok("Ⅴ のベースは G2(43)", sameNotes(notesOf(evAt(r, 3000, 2, true, 0)), {43}));
  }
  {
    // アルペジオ 1-2-3-4-: 1ステップに4音を順番に（各2マス=250ms、95%=22ティック=229ms）
    Rec r; Groove g(4, &r); g.setBackingPattern(backingPresetById(6)); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 1000);
    ok("0ms: 1番目 C3(48)", sameNotes(notesOf(evAt(r, 0, 2, true, 0)), {48}));
    ok("250ms: 2番目 E3(52)", sameNotes(notesOf(evAt(r, 250, 3, true, 0)), {52}));
    ok("500ms: 3番目 G3(55)", sameNotes(notesOf(evAt(r, 500, 3, true, 0)), {55}));
    ok("750ms: 4番目 C4(60)（3和音のオクターブ上）", sameNotes(notesOf(evAt(r, 750, 3, true, 0)), {60}));
    ok("229ms ごろに、最初の音が止まる", sameNotes(notesOf(evAt(r, 229, 3, false, 0)), {48}));
  }
  {
    // 3音モード: 4番目は、ルートのオクターブ上
    Rec r; Groove g(4, &r); g.setBackingPattern(backingPresetById(6)); g.setVoiceLeading(false); g.setOctaveForTriads(false);
    r.now = 0; g.start(0); run(g, r, 1, 1000);
    ok("3音モード: 4番目は C4(60)（ルート+12）", sameNotes(notesOf(evAt(r, 750, 3, true, 0)), {60}));
  }
  {
    // 7thコード（Ⅴ7 = G B D F）の4番目は、4番目の音（F=65）。Ⅴ7 が位置1
    Rec r; r.raw[0] = 9; Groove g(4, &r); g.setBackingPattern(backingPresetById(6)); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 1000);
    ok("Ⅴ7: 1番目 G3(55)", sameNotes(notesOf(evAt(r, 0, 2, true, 0)), {55}));
    ok("Ⅴ7: 4番目 F4(65)", sameNotes(notesOf(evAt(r, 750, 3, true, 0)), {65}));
  }
  {
    // チャールストン C-----C- : 2つ目は 6マス目（750ms）、のばしは2マス（95%=22ティック）
    Rec r; Groove g(4, &r); g.setBackingPattern(backingPresetById(5)); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 1000);
    ok("0ms 和音", sameNotes(notesOf(evAt(r, 0, 2, true, 0)), I));
    ok("のばし6マス: 95%=68ティック → 708ms で止まる", sameNotes(notesOf(evAt(r, 708, 4, false, 0)), I));
    ok("750ms: 2つ目の和音", sameNotes(notesOf(evAt(r, 750, 3, true, 0)), I));
    ok("のばし2マス: 95%=22ティック → 750+229=979ms で止まる（ステップの終わりの前）", sameNotes(notesOf(evAt(r, 979, 4, false, 0)), I));
  }
  {
    // のばしが、ステップの終わりを超えない（16個の「-」でも、次のコードにはみ出さない）
    BackingPattern p = backing("C---------------");
    Rec r; Groove g(4, &r); g.setBackingPattern(&p); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 1100);
    ok("ステップの終わり(1000ms)より前に止まる", sameNotes(notesOf(evAt(r, 948, 3, false, 0)), I));
    int offsAfter = 0; for (auto& e : r.ev) if (!e.on && e.ms > 960 && e.ms < 1000) offsAfter++;
    eqi("1000ms の直前に、止まっていない音はない", offsAfter, 0);
  }
  {
    // 弱い(c)・ベース+和音(D)
    BackingPattern p = backing("c...D...c...d...");
    Rec r; Groove g(4, &r); g.setBackingPattern(&p); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 1000);
    eqi("c は弱い(55)", evAt(r, 0, 2, true, 0)[0].vel, 55);
    ok("D = ベース + 和音（5音）", sameNotes(notesOf(evAt(r, 500, 3, true, 0)), {36, 48, 52, 55, 60}));
  }

  // ===== 6. 「→」=前のコマと同じコード =====
  {
    Rec r; r.raw[0] = 1; r.raw[1] = 99; r.raw[2] = 3; r.raw[3] = 99;   // Ⅰ → Ⅳ →
    Groove g(4, &r); g.setBackingPattern(B1); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 4100);
    eqi("位置2は →", r.steps[1].info.rawId, 99);
    ok("位置2は、前(Ⅰ)と同じ", r.steps[1].info.chordId == 1 && r.steps[1].info.repeated);
    ok("位置4は、前(Ⅳ)と同じ", r.steps[3].info.chordId == 3 && r.steps[3].info.repeated);
    ok("位置2: Ⅰ の和音を、もう一度鳴らす", sameNotes(notesOf(evAt(r, 1000, 3, true, 0)), I));
    ok("位置4: Ⅳ の和音をもう一度", sameNotes(notesOf(evAt(r, 3000, 3, true, 0)), {53, 57, 60, 65}));
    ok("→ でない位置は repeated=false", !r.steps[0].info.repeated && !r.steps[2].info.repeated);
  }
  {
    // 先頭が →: 前（ループの最後）のコード
    Rec r; r.raw[0] = 99; r.raw[1] = 1; r.raw[2] = 3; r.raw[3] = 4;
    Groove g(4, &r); g.setBackingPattern(B1);
    r.now = 0; g.start(0);
    eqi("先頭の → は、最後の位置(Ⅴ)と同じ", r.steps[0].info.chordId, 4);
  }
  {
    // → が続く: 最初の、→ でない駒まで、さかのぼる
    Rec r; r.raw[0] = 2; r.raw[1] = 99; r.raw[2] = 99; r.raw[3] = 99;
    Groove g(4, &r); g.setBackingPattern(B1);
    r.now = 0; g.start(0); run(g, r, 1, 3100);
    eqi("位置2", r.steps[1].info.chordId, 2); eqi("位置3", r.steps[2].info.chordId, 2); eqi("位置4", r.steps[3].info.chordId, 2);
  }
  {
    // 前が空なら、休みを繰り返す
    Rec r; r.raw[0] = 1; r.raw[1] = 0; r.raw[2] = 99; r.raw[3] = 4;
    Groove g(4, &r); g.setBackingPattern(B1);
    r.now = 0; g.start(0); run(g, r, 1, 3100);
    eqi("位置3(→)の前は空 → 休み", r.steps[2].info.chordId, 0);
    eqi("休みは音がない", r.steps[2].info.noteCount, 0);
    eqi("空の位置も休み", r.steps[1].info.noteCount, 0);
  }
  {
    // 全部 → : 休み
    Rec r; for (int i = 0; i < 4; i++) r.raw[i] = 99;
    Groove g(4, &r); g.setBackingPattern(B1);
    r.now = 0; g.start(0); run(g, r, 1, 2100);
    for (auto& s : r.steps) eqi("全部 → なら休み", s.info.chordId, 0);
    eqi("音は出ない", r.ev.size(), 0);
  }
  {
    // 1ステップだけ、 → : 休み
    Rec r; r.raw[0] = 99; Groove g(1, &r); g.setBackingPattern(B1);
    r.now = 0; g.start(0); eqi("1ステップの → は休み", r.steps[0].info.chordId, 0);
  }

  // ===== 7. ボイスリーディング =====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(B1);   // ボイスリーディング ON（標準）
    r.now = 0; g.start(0); run(g, r, 1, 8100);
    // ループ全体の計画（2026-11-24）: Ⅰ=48, Ⅵ=45(A2), Ⅳ=53(F3), Ⅴ=55(G3), Ⅰ=48 ...（つなぎ目の Ⅴ → Ⅰ を、完全5度下にするため、Ⅳ・Ⅴ は上の高さ）
    const int roots[8] = {48, 45, 53, 55, 48, 45, 53, 55};
    for (int i = 0; i < 8; i++) eqi("王道 ルート " + std::to_string(i), r.steps[i].info.root, roots[i]);
    eqi("Ⅵm の音（A2 C3 E3 A3）", r.steps[1].info.notes[0], 45);
    ok("Ⅵm の4音", sameNotes(notesOf(evAt(r, 1000, 3, true, 0)), {45, 48, 52, 57}));
    eqi("シフト Ⅵ=-12", r.steps[1].info.shift, -12);
    eqi("最初のコードはシフトなし", r.steps[0].info.shift, 0);
  }
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(B1); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 4100);
    const int roots[4] = {48, 57, 53, 55};
    for (int i = 0; i < 4; i++) eqi("OFF: 本来の高さ " + std::to_string(i), r.steps[i].info.root, roots[i]);
  }
  {
    // → のあとも、同じ高さ。空（休み）は、前のコードを覚えたまま
    Rec r; r.raw[0] = 1; r.raw[1] = 99; r.raw[2] = 2; r.raw[3] = 99;
    Groove g(4, &r); g.setBackingPattern(B1);
    r.now = 0; g.start(0); run(g, r, 1, 4100);
    eqi("Ⅰ", r.steps[0].info.root, 48); eqi("→ は同じ高さ", r.steps[1].info.root, 48);
    eqi("Ⅵ は 48 から A2(45)", r.steps[2].info.root, 45); eqi("→", r.steps[3].info.root, 45);
  }
  {
    Rec r; r.raw[0] = 1; r.raw[1] = 0; r.raw[2] = 2; r.raw[3] = 4;
    Groove g(4, &r); g.setBackingPattern(B1);
    r.now = 0; g.start(0); run(g, r, 1, 3100);
    eqi("休みをはさんでも、つながりは切れない: Ⅰ(48) → Ⅵ → Ⅴ(G3=55) → Ⅰ（5度下）。全体で、Ⅵ=A3(57)", r.steps[2].info.root, 57);
  }
  {
    // 1周ごとにではなく、START し直すと、前のコードの記憶は消える
    Rec r; Groove g(4, &r); g.setBackingPattern(B1);
    r.now = 0; g.start(0); run(g, r, 1, 2100);
    r.now = 2200; g.stop(); r.steps.clear();
    r.now = 3000; g.start(3000);
    eqi("START し直すと、最初のコードは本来の高さ（Ⅰ=48）", r.steps[0].info.root, 48);
    eqi("シフトなし", r.steps[0].info.shift, 0);
  }

  // ===== 8. BPM を、再生中に、すぐに変える =====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(nullptr); g.setDrumPattern(drumPresetById(2));
    r.now = 0; g.start(0); run(g, r, 1, 1000);   // BPM120: 1000msまで
    r.now = 1000; ok("BPM 60 に変える", g.setBpm(60, 1000));
    eqi("BPM は 60", g.bpm(), 60);
    size_t mark = r.ev.size();
    run(g, r, 1001, 3300);
    // 60 BPM: 1マス = 250ms。1000msはマス8（キック+ハイハット）を処理済み。次のマス9は 1250ms 後ではなく 1250ms...
    // 1000ms がマス8の始まり。マス10（キック+ハイハット）は、BPM60 では 1000 + 2*250 = 1500ms
    auto later = evAfter(r, mark);
    std::vector<Rec::Ev> k; for (auto& e : later) if (e.on && e.note == 36) k.push_back(e);
    ok("BPM60 で、次のキック(マス10)は 1500ms ごろ", !k.empty() && (int)k[0].ms >= 1498 && (int)k[0].ms <= 1503);
    // マス12(スネア)は 1000 + 4*250 = 2000ms
    std::vector<Rec::Ev> s; for (auto& e : later) if (e.on && e.note == 38) s.push_back(e);
    ok("BPM60 で、スネア(マス12)は 2000ms ごろ", !s.empty() && (int)s[0].ms >= 1998 && (int)s[0].ms <= 2003);
    ok("範囲外は拒否", !g.setBpm(29, 3300) && !g.setBpm(241, 3300) && g.bpm() == 60);
    ok("30と240はOK", g.setBpm(30, 3300) && g.setBpm(240, 3300));
  }
  {
    // ステップの途中で変えると、残りの時間が、新しい BPM で、すぐに変わる
    Rec r; Groove g(4, &r); g.setBackingPattern(B1);
    r.now = 0; g.start(0); run(g, r, 1, 500);       // ステップ1の半分（48ティック）
    r.now = 500; g.setBpm(240, 500);                // 4倍速
    run(g, r, 501, 1500);
    // 残り48ティック: 240BPM では 1ティック = 5.2083ms → 250ms → ステップ2は 750ms
    ok("BPM240 に変えたら、残りの半分は 250ms で終わる（750msごろ）", r.steps.size() >= 2 && (int)r.steps[1].ms >= 748 && (int)r.steps[1].ms <= 753);
    // その次のステップは 1ステップ = 500ms
    ok("次のステップは 500ms 後（1250msごろ）", r.steps.size() >= 3 && (int)r.steps[2].ms >= 1248 && (int)r.steps[2].ms <= 1253);
  }
  {
    // 何度も変えても、ずれが溜まらない（時間が失われない）
    Rec r; Groove g(4, &r); g.setBackingPattern(B1);
    r.now = 0; g.start(0);
    uint32_t t = 0; int bpms[6] = {120, 90, 150, 60, 200, 120};
    double ticks = 0; int idx = 0;
    // 各 500ms ごとに BPM を変えて、進んだティック数を、別に計算して比べる
    for (int seg = 0; seg < 12; seg++) {
      int bpm = bpms[idx++ % 6];
      r.now = t; g.setBpm(bpm, t);
      for (uint32_t u = 1; u <= 500; u++) { r.now = t + u; g.update(t + u); }
      t += 500; ticks += 500.0 * bpm * 48 / 60000.0;
    }
    // ステップの数 = floor(ティック / 96) + 1（0番目を含む）
    eqi("BPM を何度も変えても、ステップの数が理論値と一致する", r.steps.size(), (int)(ticks / 96) + 1);
  }

  // ===== 9. キーを、再生中に、すぐに変える =====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(B1); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 300);
    size_t mark = r.ev.size();
    r.now = 300; g.setKey({1, 0});   // Key=D
    eqi("キー変更の要求は、すぐ処理される（次の update を待つ）", g.msUntilNextEvent(300), 0);
    run(g, r, 301, 400);
    auto after = evAfter(r, mark);
    std::vector<int> offs, ons; for (auto& e : after) (e.on ? ons : offs).push_back(e.note);
    ok("古い Ⅰ(C)の音を止める", sameNotes(offs, I));
    ok("新しいキー D の Ⅰ(D3 F#3 A3 D4)を、すぐに鳴らし直す", sameNotes(ons, {50, 54, 57, 62}));
    ok("鳴らし直しは、300ms の直後（10ms以内）", !after.empty() && after[0].ms <= 310);
    // 止める時刻は、元の予定のまま（948ms ごろ）
    run(g, r, 401, 1100);
    ok("止める時刻は元のまま（948msごろに D の和音を止める）", sameNotes(notesOf(evAt(r, 948, 4, false, 0)), {50, 54, 57, 62}));
    // 次のステップ以降は、新しいキー（Ⅵm = Bm: B3 D4 F#4 B4）
    ok("次のステップは新しいキーの Ⅵm（Bm）", sameNotes(notesOf(evAt(r, 1000, 4, true, 0)), {59, 62, 66, 71}));
  }
  {
    // 休みのときのキー変更: 何も鳴らない。次のコードから新しいキー
    Rec r; r.raw[0] = 0; r.raw[1] = 1; Groove g(4, &r); g.setBackingPattern(B1); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 300);
    size_t mark = r.ev.size(); r.now = 300; g.setKey({2, 0}); run(g, r, 301, 400);
    eqi("休みのとき、鳴らし直さない", r.ev.size(), mark);
    run(g, r, 401, 1100);
    ok("次のコードは E の Ⅰ(E3 G#3 B3 E4)", sameNotes(notesOf(evAt(r, 1000, 3, true, 0)), {52, 56, 59, 64}));
  }
  {
    // バッキングが、まだ1回も鳴らしていないマスで変えても、おかしくならない（8分チョップの途中）
    Rec r; Groove g(4, &r); g.setBackingPattern(backingPresetById(3)); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 180);   // 最初の和音(0ms)は止まって、次(250ms)の前
    size_t mark = r.ev.size(); r.now = 180; g.setKey({1, 0}); run(g, r, 181, 300);
    auto after = evAfter(r, mark);
    ok("すでに止まった和音は、鳴らし直さない（250msの新しい和音だけ、新しいキー）", sameNotes(notesOf(evAt(r, 250, 3, true, 0)), {50, 54, 57, 62}));
    int onsBefore250 = 0; for (auto& e : after) if (e.on && e.ms < 245) onsBefore250++;
    eqi("鳴らし直しなし", onsBefore250, 0);
  }

  // ===== 10. パターンの切り替え =====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(B1); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 300);
    g.setBackingPattern(backingPresetById(3)); g.setDrumPattern(drumPresetById(3));   // 8分チョップ + 4つ打ち
    run(g, r, 301, 700);
    ok("切り替えたマスから、新しいパターン（500msに和音）", sameNotes(notesOf(evAt(r, 500, 3, true, 0)), I));
    ok("ドラムも、すぐに新しいパターン（4つ打ち）で始まる: 500ms にキック・クラップ・ハイハット", sameNotes(notesOf(evAt(r, 500, 3, true, 9)), {36, 39, 42}));
    g.setDrumPattern(nullptr); size_t mark = r.ev.size(); run(g, r, 701, 1100);
    int drums = 0; for (auto& e : evAfter(r, mark)) if (e.on && e.ch == 9) drums++;
    eqi("ドラムをなしにすると、鳴らない", drums, 0);
  }

  // ===== 11. STOP =====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(B1); g.setDrumPattern(drumPresetById(2));
    r.now = 0; g.start(0); run(g, r, 1, 30);
    size_t mark = r.ev.size(); r.now = 30; g.stop();
    auto after = evAfter(r, mark);
    ok("STOP で、鳴っている音を、すぐに全部止める", !after.empty() && std::all_of(after.begin(), after.end(), [](const Rec::Ev& e) { return !e.on; }));
    ok("止めた音は、ピアノ4音 + ドラム2音", after.size() == 6);
    ok("停止した", !g.playing());
    eqi("停止中は、次の予定なし", g.msUntilNextEvent(30), (long long)UINT32_MAX);
    mark = r.ev.size(); run(g, r, 31, 3000);
    eqi("止まったあとは、何も出ない", r.ev.size(), mark);
    g.stop(); eqi("STOP を2回呼んでも、二重に出さない", r.ev.size(), mark);
  }

  // ===== 12. 長い遅れ =====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(backingPresetById(3)); g.setDrumPattern(drumPresetById(2));
    r.now = 0; g.start(0); run(g, r, 1, 100);
    size_t mark = r.ev.size();
    r.now = 5100; g.update(5100);   // 5秒、update が呼ばれなかった
    auto after = evAfter(r, mark);
    int ons = 0; for (auto& e : after) if (e.on) ons++;
    ok("長く止まったあとに、音が一度に何十個も出ない（古いマスは出さない）", ons <= 12);
    ok("ステップは、進んでいる（5ステップ以上）", r.steps.size() >= 5);
    // 止めるべき音は、残さない
    run(g, r, 5101, 7000);
    g.stop();
    int on = 0, off = 0; for (auto& e : r.ev) (e.on ? on : off)++;
    eqi("止めたあと、出した音と止めた音の数が一致（鳴りっぱなしがない）", on, off);
  }

  // ===== 13. 次の予定までの時間（読み取りを見送る判断）=====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(B1);   // ロング: 0ms と 1000ms に和音、止めるのは 948ms
    r.now = 0; g.start(0);
    eqi("開始直後、次は 948ms（和音を止める）", g.msUntilNextEvent(0), 948);
    eqi("500ms のとき、あと 448ms", g.msUntilNextEvent(500), 448);
    run(g, r, 1, 948);
    eqi("止めたあと、次は 1000ms（ステップ）", g.msUntilNextEvent(949), 51);
    eqi("すでに時刻なら 0", g.msUntilNextEvent(1000), 0);
  }
  {
    Rec r; Groove g(4, &r); g.setDrumPattern(drumPresetById(2));
    r.now = 0; g.start(0);
    // マス0の音は 6ティック(62.5ms)後に止まる。その次は マス2(250ms)
    eqi("ドラム: 次は 63ms 後（止める）", g.msUntilNextEvent(0), 63);
    run(g, r, 1, 63);
    eqi("次は 250ms（マス2: ハイハット）", g.msUntilNextEvent(64), 186);
  }
  {
    // 何も予定がなくても、ステップの始まり（コードの切り替え）で目を覚ます
    Rec r; Groove g(4, &r);   // バッキングもドラムもなし
    r.now = 0; g.start(0);
    eqi("パターンなし: 次はステップの始まり(1000ms)", g.msUntilNextEvent(0), 1000);
  }

  // ===== 14. 診断: 時刻のずれ =====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(backingPresetById(3)); g.setDrumPattern(drumPresetById(4));
    r.now = 0; g.start(0);
    for (uint32_t t = 37; t <= 6000; t += 37) { r.now = t; g.update(t); }
    ok("update が 37ms ごとなら、遅れは 37ms 未満", g.maxLateMs() < 37);
    ok("遅れが測れている", g.maxLateMs() > 0);
    Rec r2; Groove g2(4, &r2); g2.setBackingPattern(backingPresetById(3)); r2.now = 0; g2.start(0);
    for (uint32_t t = 1; t <= 6000; t++) { r2.now = t; g2.update(t); }
    ok("1msごとに呼べば、遅れは 1ms 以下", g2.maxLateMs() <= 1);
    g2.start(7000); eqi("start し直すと、記録は 0 に戻る", g2.maxLateMs(), 0);
  }

  // ===== 15. 時計の一周（millis のオーバーフロー）=====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(B1); g.setDrumPattern(drumPresetById(2));
    uint32_t t0 = 0xFFFFFFFFu - 1500;
    r.now = t0; g.start(t0);
    for (uint32_t i = 1; i <= 4000; i++) { uint32_t t = t0 + i; r.now = t; g.update(t); }
    eqi("一周をまたいでも、ステップが進む（0,1000,2000,3000,4000）", r.steps.size(), 5);
    for (size_t i = 1; i < r.steps.size(); i++) eqi("間隔は 1000ms", (uint32_t)(r.steps[i].ms - r.steps[i - 1].ms), 1000);
  }

  // ===== 16. 8ステップ =====
  {
    Rec r; for (int i = 0; i < 8; i++) r.raw[i] = (i % 4) + 1;
    Groove g(8, &r); g.setBackingPattern(B1);
    r.now = 0; g.start(0); run(g, r, 1, 8100);
    eqi("8ステップで一周（8000msで先頭に戻る）", r.steps.size(), 9);
    eqi("9番目は位置1", r.steps[8].info.step, 0);
    eqi("ステップ番号 7", r.steps[7].info.step, 7);
  }

  // ===== 17. 駒の交換は、次にその位置を再生するときに反映 =====
  {
    Rec r; Groove g(4, &r); g.setBackingPattern(B1); g.setVoiceLeading(false);
    r.now = 0; g.start(0); run(g, r, 1, 1500);
    r.raw[2] = 9; r.raw[1] = 7;   // 位置3 を Ⅴ7 に、鳴っている位置2 を Ⅲm に交換
    run(g, r, 1501, 5100);
    eqi("鳴っていた位置2は、最後まで元のコード（Ⅵm=2）", r.steps[1].info.chordId, 2);
    eqi("位置3は新しいコード（Ⅴ7=9）", r.steps[2].info.chordId, 9);
    eqi("次の周の位置2（6番目のステップ）は、新しい駒（Ⅲm=7）", r.steps[5].info.chordId, 7);
    eqi("次の周の位置2のステップ番号", r.steps[5].info.step, 1);
  }

  // ===== 18. 同じ時刻の「止める」と「出す」: 止めるが先 =====
  {
    GrooveSettings s; s.gatePercent = 100;   // 止める時刻 = ステップの終わり = 次の和音の始まり
    Rec r; Groove g(4, &r, s); g.setBackingPattern(B1); g.setVoiceLeading(false);
    r.raw[0] = 1; r.raw[1] = 1;
    r.now = 0; g.start(0); run(g, r, 1, 1100);
    // 1000ms の emit: 同じ和音の止める4音が、出す4音より先
    std::vector<Rec::Ev> at1000; for (auto& e : r.ev) if (e.ms >= 999 && e.ms <= 1002) at1000.push_back(e);
    ok("1000ms に、止める4音と出す4音がある", at1000.size() == 8);
    bool offsFirst = true; bool seenOn = false; for (auto& e : at1000) { if (e.on) seenOn = true; else if (seenOn) offsFirst = false; }
    ok("止める指示が、出す指示より先に並ぶ", offsFirst);
  }

  // ===== 19. 設定の取得・初期値 =====
  {
    Rec r; Groove g(4, &r);
    eqi("初期 BPM 120", g.bpm(), 120); ok("初期のキーは C", g.key().letter == 0 && g.key().accidental == 0);
    ok("初期: 3和音にオクターブ上を足す", g.octaveForTriads()); ok("初期: ボイスリーディング ON", g.voiceLeading());
    ok("初期: パターンなし", g.drumPattern() == nullptr && g.backingPattern() == nullptr);
    ok("停止中", !g.playing()); eqi("ステップ数", g.numSteps(), 4);
    Groove g2(0, &r); eqi("0ステップは 1 に直る", g2.numSteps(), 1);
    Groove g3(99, &r); eqi("多すぎるステップは 8 に直る", g3.numSteps(), 8);
  }

  // ===== 20. 駒が1つもなくても、ドラムは鳴り続ける（ピアノは鳴らない）=====
  //   製品の動き: 電源を入れて何も置いていなくても、ドラムのリズムだけは流れていて、駒を置くとコードが重なる
  {
    Rec r; for (int i = 0; i < 8; i++) r.raw[i] = 0;   // 全部の位置が空
    Groove g(4, &r); g.setBackingPattern(B1); g.setDrumPattern(drumPresetById(2));
    r.now = 0; g.start(0); run(g, r, 1, 4100);
    int piano = (int)std::count_if(r.ev.begin(), r.ev.end(), [](const Rec::Ev& e) { return e.on && e.ch == 0; });
    int drums = (int)std::count_if(r.ev.begin(), r.ev.end(), [](const Rec::Ev& e) { return e.on && e.ch == 9; });
    eqi("全部空: ピアノの音は鳴らない", piano, 0);
    ok("全部空でも、ドラムは鳴る（4ステップ=4秒の間に 8音以上）", drums >= 8);
    for (int st = 0; st < 4; st++) {
      int n = (int)std::count_if(r.ev.begin(), r.ev.end(), [st](const Rec::Ev& e) { return e.on && e.ch == 9 && (int)e.ms >= st * 1000 && (int)e.ms < (st + 1) * 1000; });
      ok("全部空: ステップ" + std::to_string(st + 1) + " でも、ドラムが鳴る", n > 0);
    }
    // 途中で駒を置く（位置2に Ⅰ）と、次のステップからピアノが加わる。ドラムは途切れない
    r.raw[1] = 1;
    size_t mark = r.ev.size(); run(g, r, 4101, 8100);
    int piano2 = 0, drums2 = 0;
    for (size_t i = mark; i < r.ev.size(); i++) { if (r.ev[i].on && r.ev[i].ch == 0) piano2++; if (r.ev[i].on && r.ev[i].ch == 9) drums2++; }
    ok("駒を置いたあと、ピアノが加わる（位置2のステップで4音）", piano2 == 4);
    ok("ドラムは続いている", drums2 >= 8);
  }

  printf("test_groove: checks=%d fails=%d\n", checks, fails);
  return fails != 0;
}
