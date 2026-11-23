// midi_protocol.cpp のパソコン上テスト（ブリッジ用の1行の形式と、MIDIメッセージの作り方）
//   実行: tools/host_tests/run_all.sh
#include "midi_protocol.h"

#include <stdio.h>
#include <string.h>

#include <string>

static int fails = 0, checks = 0;
static void eqs(const std::string& w, const std::string& g, const std::string& e) {
  checks++;
  if (g != e) { fails++; printf("FAIL %s: got [%s] want [%s]\n", w.c_str(), g.c_str(), e.c_str()); }
}
static void eqi(const std::string& w, long long g, long long e) {
  checks++;
  if (g != e) { fails++; printf("FAIL %s: got %lld want %lld\n", w.c_str(), g, e); }
}

static std::string line(const uint8_t* b, size_t n, size_t bufSize = 128) {
  char out[256]; size_t k = midiFormatBridgeLine(b, n, out, bufSize); return k ? std::string(out, k) : std::string("<too small>");
}

int main() {
  uint8_t m[3];
  eqi("noteOn 長さ", midiBuildNoteOn(0, 60, 80, m), 3);
  eqi("noteOn status(ch1)", m[0], 0x90); eqi("noteOn note", m[1], 60); eqi("noteOn vel", m[2], 80);
  midiBuildNoteOn(15, 127, 127, m); eqi("noteOn ch16", m[0], 0x9F);
  midiBuildNoteOn(0, 200, 200, m); eqi("範囲外のノートは127に", m[1], 127); eqi("範囲外のベロシティは127に", m[2], 127);
  eqi("noteOff 長さ", midiBuildNoteOff(0, 48, m), 3); eqi("noteOff status", m[0], 0x80); eqi("noteOff note", m[1], 48); eqi("noteOff vel", m[2], 0);
  eqi("programChange 長さ", midiBuildProgramChange(0, 0, m), 2); eqi("PC status", m[0], 0xC0); eqi("PC program", m[1], 0);
  midiBuildProgramChange(2, 24, m); eqi("PC ch3 status", m[0], 0xC2); eqi("PC ギター", m[1], 24);
  eqi("allNotesOff 長さ", midiBuildAllNotesOff(0, m), 3); eqi("CC status", m[0], 0xB0); eqi("CC123", m[1], 123); eqi("CC value", m[2], 0);

  // ブリッジ用の1行
  uint8_t on[12]; size_t n = 0;
  const uint8_t notes[4] = {48, 52, 55, 60};   // Ⅰ = C3 E3 G3 C4
  for (int i = 0; i < 4; i++) n += midiBuildNoteOn(0, notes[i], 80, on + n);
  eqs("和音ON(Ⅰ)", line(on, n), "~M 90 30 50 90 34 50 90 37 50 90 3C 50 \n");
  uint8_t pc[2]; midiBuildProgramChange(0, 0, pc);
  eqs("プログラムチェンジ", line(pc, 2), "~M C0 00 \n");
  uint8_t off[3]; midiBuildAllNotesOff(0, off);
  eqs("オールノートオフ", line(off, 3), "~M B0 7B 00 \n");
  eqs("空のメッセージ", line(on, 0), "~M \n");
  // バッファが足りないとき
  char tiny[10]; eqi("バッファ不足は0", (long long)midiFormatBridgeLine(on, 12, tiny, sizeof tiny), 0);
  // ぴったりの大きさ
  size_t need = 3 + 12 * 3 + 1 + 1; char exact[64];
  eqi("ぴったりの大きさ", (long long)midiFormatBridgeLine(on, 12, exact, need), (long long)(need - 1));
  eqi("1バイト足りないと0", (long long)midiFormatBridgeLine(on, 12, exact, need - 1), 0);
  // 1行は必ず「~M 」で始まり、改行で終わる（PC側が見分けられる）
  std::string s = line(on, n); eqi("先頭", s.compare(0, 3, "~M "), 0); eqi("末尾", s.back() == '\n', 1);

  printf("test_midi_protocol: checks=%d fails=%d\n", checks, fails);
  return fails != 0;
}
