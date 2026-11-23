// ============================================================
// ESP32_Octo_01: RC522 を最大8台使った、コード進行の再生プロトタイプ
//
//   各位置（最大8つ）に駒（NFCタグ）を置く → 登録済みのコードを取得 → Key=C の実音に変換
//     → BPM に従って、2拍ごとに次の位置のコードを、和音（同時発音）で再生する（MIDI）
//
//   このファイルは「全体の組み立て」だけ。仕事は、それぞれの部品がする。
//     reader_array … RC522 を最大8台読む（置かれた／交換された／外れた）
//     board        … 各位置の状態（空 / 未登録 / コード）
//     chords       … コードの定義と、Key から実音への変換
//     groove       … BPM に合わせた、時間の管理（delay を使わない）。ドラム・バッキングのパターンの再生
//     rhythm       … パターン（ドラム・バッキング）の定義。rhythm_store が保存する
//     voicing      … ボイスリーディング（前のコードから一番近い高さで鳴らす）
//     player       … 上の部品をつないで、コード進行を再生する
//     midi_out     … 音源への出力（MIDI）
//     commands     … ターミナルから打つコマンド（START / STOP / BPM / KEY / DRUM / BACKING / STATUS ...）
//     register_ui  … タグの登録の画面（1台版から引き継ぎ）
//     rc522_test   … RC522 のテストモード（x）
// ============================================================
#include <Arduino.h>
#include <string.h>

#include "board.h"
#include "bridge_link.h"
#include "buzzer.h"
#include "commands.h"
#include "config.h"
#include "midi_out.h"
#include "player.h"
#include "rc522_test.h"
#include "reader_array.h"
#include "register_ui.h"
#include "rhythm_store.h"
#include "settings_store.h"
#include "tag_store.h"
#include "ui_util.h"

// いまのキー。今回は Key=C 固定（将来、ここを変えるとキーを変更できる）
Key currentKey = KEY_C;

// 読み取り1回にかかる時間（SCAN_GUARD_MS。config.h）より、音を鳴らす／止める時刻が近いときは、
// 読み取りを見送って時刻を待つ（読み取りの途中で時刻が来て、音がずれるのを防ぐ）

// Serial Monitor から入力した1行をためておく場所（DRUM SET 11 K x...x...x...x...x...x...x...x... のような長い行も入る）
char lineBuf[96];
uint8_t lineLen = 0;

// ------------------------------------------------------------
// Serial Monitor からの入力
// ------------------------------------------------------------

// Enter が押されて1行そろったときに呼ばれる
void onLine(char* rawLine) {
  const char* line = trimInPlace(rawLine);
  if (line[0] == '\0') return;  // 空の行は無視

  // START / STOP / BPM / KEY / DRUM / BACKING / STATUS / MIDI / HELP ...
  if (commandsHandle(line)) return;

  if (testActive()) {  // RC522 のテストモード中の入力
    testHandleLine(line);
    if (!testActive()) {  // q で終了した: 通常の動作に戻る
      readersResetPresence();
      registerUiBegin();
    }
    return;
  }
  if (playerIsPlaying()) {
    Serial.println("再生中です。止めるには STOP、状態は STATUS、BPM は BPM 120（または + -）、キーは KEY D（または ] [）。");
    return;
  }
  registerUiHandleLine(line);  // 登録の画面（l / t / x / y / n / 番号）
}

// Serial Monitor から届いた文字を1行にまとめる
void pollSerial() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    // 行の最初の1文字が + - ] [ のときは、Enter を待たずに、すぐに BPM／キーを変える
    if (lineLen == 0 && commandsHotkey(c)) continue;
    if (c == '\r' || c == '\n') {
      if (lineLen > 0) {
        lineBuf[lineLen] = '\0';
        lineLen = 0;
        onLine(lineBuf);
      }
    } else if (lineLen < sizeof(lineBuf) - 1) {
      lineBuf[lineLen++] = c;
    }
  }
}

// ------------------------------------------------------------
// リーダーで起きたこと
// ------------------------------------------------------------
void onReaderEvent(const ReaderEvent& event) {
  if (commandsLayoutLearnEvent(event)) {   // 配置を覚えさせている最中は、そちらで使う（覚えた結果を、画面に知らせる）
    commandsPushState();
    return;
  }
  // 画面（ゲーム・操作画面）への知らせ（~S の行）を、いちばん先に出す。
  // 登録の画面の表示や、ブザー（アルペジオ）のあとに回すと、その分だけ、ゲームへの反映が遅れる
  commandsPushState();
  if (playerIsPlaying()) {
    playerOnReaderEvent(event);  // 再生中: 表示するだけ。音には、次にその位置を再生するときに反映
    return;
  }
  if (event.type == READER_EVENT_REMOVED) return;  // 登録の画面では、外れたことは表示しない（これまでと同じ）
  registerUiOnTag(event.reader, event.uid);
}

// ------------------------------------------------------------
// 起動時に1回だけ実行される
// ------------------------------------------------------------
void setup() {
  Serial.setTxBufferSize(2048);  // 送信用のバッファを大きくして、表示のたびに処理が止まらないようにする
  Serial.begin(115200);          // シリアル通信を開始（速度は 115200 bps）
  delay(1000);                   // Serial Monitor が接続されるまで少し待つ

  Serial.println("Hello ESP32!");
  Serial.printf("ESP32_Octo_01: RC522 を最大%d台使った、コード進行の再生プロトタイプ\n", NUM_READERS);
  Serial.println("=== 音について（大事）===");
  Serial.println("  ESP32 自身は、ピアノやドラムの音を出しません。Mac から鳴ります（GarageBand のピアノ・ドラム、ゲーム）。");
  Serial.println("  ブリッジが ESP32 につながっていないと、Mac から音は鳴りません。");
  Serial.println("  ブリッジがつながっている間は、駒を置いたときの基板のブザー（アルペジオ）は鳴りません。Serial Monitor で作業するとき（ブリッジを解除したとき）だけ鳴ります。");
  Serial.println("=== Serial Monitor を使うとき（確認・操作・駒の登録）===");
  Serial.println("  同じポートをブリッジと取り合うと、文字化け・切断が起きます。先にブリッジを「解除」します（解除中は、音が鳴りません）。");
  Serial.println("  おすすめ: PlatformIO の Project Tasks > Custom > 「Serial Monitor（ブリッジ自動解除）」（閉じると、自動でつなぎ直す）");
  Serial.println("  手動: 「ブリッジ解除」→ Monitor で作業 →「ブリッジ接続」 ／ ブラウザの画面のボタン ／ sh tools/bridge_release.sh と sh tools/bridge_connect.sh");
  Serial.println("=== ブラウザの画面（Command を押しながらクリックで開く）===");
  Serial.println("  リズム・コード編集（GarageBand の MIDI）: http://127.0.0.1:8765/");
  Serial.println("  ゲーム: http://127.0.0.1:8765/game/");

  // 本体に保存してある設定（リーダーの止め方・受信感度）。保存がなければ config.h の初期値
  settingsBegin();
  buzzerSetMuted(!settingsLoadBuzzer(true));   // BUZZER OFF にしてあれば、ブザーは鳴らさない（電源を入れて10秒のあいだは、設定にかかわらず鳴らさない）
  IdleMethod savedIdle = settingsLoadIdleMethod(DEFAULT_IDLE_METHOD);
  readersSetGainDb(settingsLoadGainDb(DEFAULT_RX_GAIN_DB));  // リーダーを起こす前に、受信感度を決めておく

  readersBegin(PIN_SCK, PIN_MISO, PIN_MOSI);  // SPIを開始して、全リーダーを準備する
  readersResetPresence();

  // リーダーごとに、RC522が応答するか確認する（0x91 か 0x92 なら正常。0x00 や 0xFF なら配線を確認）
  for (int i = 0; i < NUM_READERS; i++) {
    uint8_t version;
    bool ok = readersProbe(i, &version);
    Serial.printf("リーダー%d (SS=GPIO%d, RST=GPIO%d): ", i + 1, readerSsPin(i), readerRstPin(i));
    if (ok) {
      Serial.printf("RC522 version: 0x%02X\n", version);
    } else {
      Serial.printf("応答なし (0x%02X)  → 配線を確認してください。このリーダーは使いません\n", version);
    }
    // ブザーのピンが、リーダーのピンと重なっていないか確認する
    if (readerSsPin(i) == PIN_BUZZER || readerRstPin(i) == PIN_BUZZER) {
      Serial.printf("※ ブザーのピン(GPIO%d)が、リーダー%dのピンと重なっています\n", PIN_BUZZER, i + 1);
    }
  }
  if (readersAliveCount() == 0) {
    Serial.println("※ 応答するリーダーがありません。タグは読み取れません。");
  }

  // 使っていないリーダーの止め方を決める。RESET方式は、全リーダーを起こして自己診断してから使う。
  // 診断に失敗したら、今回は「アンテナOFF」で動かす（保存した設定は変えない）
  if (!readersSetIdleMethod(savedIdle, true)) {
    Serial.printf("※ リーダーの止め方「%s」の自己診断で、%d 台がうまく起きませんでした。\n", readersIdleMethodName(savedIdle),
                  readersLastSelfTestFailures());
    Serial.println("  今回は「アンテナOFF」で動かします（保存した設定は、そのままです）。配線（特に MISO と RST）を確認してください。");
    readersSetIdleMethod(IDLE_ANTENNA_OFF, false);
  }
  Serial.printf("リーダーの止め方: %s ／ 受信感度: %d dB   （変更は IDLE ・ GAIN。HELP で一覧）\n",
                readersIdleMethodName(readersIdleMethod()), readersGainDb());

  buzzerBegin(PIN_BUZZER);  // ブザーを使えるようにする（登録の合図）

  // 保存してある登録を読み込む（電源を切っても残っている）
  if (!tagStoreBegin()) {
    Serial.println("※ 保存データを正しく読み込めませんでした。");
  }
  registerUiPrintList();

  int brokenPatterns = rhythmStoreBegin();  // 自分で作ったリズムのパターンを読み込む
  if (brokenPatterns > 0) Serial.printf("※ 保存してあるリズムのパターンのうち、%d 件が壊れていて読めませんでした（その番号は空きになります）。\n", brokenPatterns);

  {  // 保存してある、位置とリーダーの対応（なければ標準）
    uint8_t saved[LAYOUT_MAX];
    if (settingsLoadMap(saved, NUM_POSITIONS) && boardLayout().set(saved, NUM_POSITIONS)) Serial.println("位置とリーダーの対応: 保存してある配置を使います（MAP で確認）");
  }
  midiBegin();
  playerSetOctave(settingsLoadOctave(DEFAULT_OCTAVE));   // 保存してある和音の高さ（なければ標準）
  playerBegin();
  // 自動再生が ON（標準）なら、再生を始める前に、置いてある駒を見つけ終わるまで読んでおく
  // （最初のステップから、位置1の和音が鳴るように。隣のリーダーが読む影も、ここで見分ける。
  //  見つけた駒の表示や、登録の確認は出さない）。最大 2.5 秒
  if (settingsLoadAutostart(DEFAULT_AUTOSTART)) {
    readersScanUntilSettled(2500);
  }
  // 保存してあるドラム・バッキング・BPM・キーを戻す。自動再生が ON（標準）なら、このまま再生を始める
  // （再生中は、駒の置き換えは登録ではなく再生に使われる。駒を登録するときは STOP）
  if (!playerBoot()) registerUiBegin();
  Serial.println("[READY]");  // 起動が終わった目印（PC側のブリッジが、これを見て準備する）
}

// setup() のあと、ずっと繰り返し実行される
void loop() {
  pollSerial();  // Serial Monitor からの入力を確認する
  playerTick();  // 和音を鳴らす／止める時刻が来ていれば、実行する
  buzzerTick();  // ブザーのアルペジオを、次の音へ進める（待たずに鳴らしているので、ここで進める）

  if (testActive()) {  // テストモード中は、テストの処理だけを行う
    testLoop();
    return;
  }

  // ブザーが鳴っている間は、駒を読まない（鳴っている間に読むと、電気的なノイズで読み取りが失敗して、動かしていない駒が「外れた」と
  // 誤って知らせられる）。ブリッジがつながっているときは、ブザーを鳴らさないので、ここには来ない
  if (buzzerHoldsReads()) {
    delay(1);
    return;
  }

  // 和音を鳴らす／止める時刻がもうすぐなら、読み取りは見送って、その時刻まで待つ
  uint32_t wait = playerMsUntilEvent();
  if (wait < SCAN_GUARD_MS) {
    uint32_t until = millis() + wait;
    while ((int32_t)(millis() - until) < 0) delayMicroseconds(200);
    playerTick();
    return;
  }

  // リーダーを1台ずつ順番に調べて、何か起きたら処理する
  ReaderEvent event;
  if (readersPollNext(&event)) {
    onReaderEvent(event);
  }
  commandsPollDiagnostics();   // SHADOWLOG ON のとき、影の判定の結果を表示する
  if (readersAliveCount() == 0) delay(50);  // 調べるリーダーがないときは、回りすぎないように待つ
}
