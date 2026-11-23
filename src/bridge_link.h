#pragma once
#include <stdint.h>

// ============================================================
// PC 側のブリッジ（tools/midi_bridge.py）が、いま、ESP32 につながっているか
//   ブリッジは、つながっている間、約1秒ごとに PING というコマンドを送ってくる（画面には何も出さない）。
//   最後の PING から BRIDGE_LINK_TIMEOUT_MS 以内なら、「つながっている」。
//   ブリッジがつながっているとき、音は Mac（ゲーム・GarageBand）が鳴らす。
//   そこで、ブザーのアルペジオは鳴らさない（Mac の音とぶつかるし、鳴り終わるまで駒の読み取りと画面への知らせが遅れるため）。
//   Serial Monitor で作業するとき（ブリッジを解除したとき）は、PING が来ないので、これまでどおり、ブザーが鳴る。
// ============================================================
const uint32_t BRIDGE_LINK_TIMEOUT_MS = 2500;

// ------------------------------------------------------------
// ブザーを鳴らしてよいか（2026-11-18）。次のときは、鳴らさない:
//   ・BUZZER OFF にしてあるとき（設定は、NVS に保存。buzzerSetMuted）
//   ・電源を入れてから BUZZER_BOOT_QUIET_MS のあいだ（駒が載ったまま電源を入れたり、書き込みで再起動すると、駒の数だけ、アルペジオが鳴り続けるため。
//     ブリッジの PING が届き始めるまでは、「ブリッジがつながっている」と分からない）
// ------------------------------------------------------------
const uint32_t BUZZER_BOOT_QUIET_MS = 10000;
void buzzerSetMuted(bool muted);
bool buzzerMuted();       // BUZZER OFF にしてあるか
bool buzzerAllowed();     // 鳴らしてよいか（OFF でなく、起動直後でもない）

void bridgeLinkPing();    // PING が届いた
bool bridgeLinkAlive();   // いま、ブリッジがつながっているか
void bridgeLinkReset();   // 記憶を消す（テスト用）
