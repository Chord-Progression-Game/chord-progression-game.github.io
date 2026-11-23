// 実機から録ったMIDI（capture.json を変換した events.txt）を、サンプル音源（TinySoundFont + SF2）で鳴らして WAV にする
//   使い方: render events.txt out.wav SF2 ピアノの音色番号 [scale]
//   events.txt の1行 = 「秒 バイト バイト …」（MIDIのメッセージ1つ）
#define TSF_IMPLEMENTATION
#include "tsf.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <vector>
#include <string>
#include <algorithm>

struct Ev { double t; int b[3]; int n; };

static void writeWav(const char* path, const std::vector<short>& pcm, int rate) {
  FILE* f = fopen(path, "wb");
  unsigned dataBytes = (unsigned)(pcm.size() * 2), riff = 36 + dataBytes, fmtLen = 16, byteRate = rate * 4, srate = rate;
  unsigned short fmt = 1, ch = 2, align = 4, bits = 16;
  fwrite("RIFF", 1, 4, f); fwrite(&riff, 4, 1, f); fwrite("WAVEfmt ", 1, 8, f); fwrite(&fmtLen, 4, 1, f);
  fwrite(&fmt, 2, 1, f); fwrite(&ch, 2, 1, f); fwrite(&srate, 4, 1, f); fwrite(&byteRate, 4, 1, f);
  fwrite(&align, 2, 1, f); fwrite(&bits, 2, 1, f); fwrite("data", 1, 4, f); fwrite(&dataBytes, 4, 1, f);
  fwrite(pcm.data(), 2, pcm.size(), f); fclose(f);
}

int main(int argc, char** argv) {
  if (argc < 5) { fprintf(stderr, "使い方: render events.txt out.wav font.sf2 piano_program [scale]\n"); return 1; }
  const int RATE = 44100;
  std::vector<Ev> evs;
  if (argc >= 6 && strcmp(argv[5], "scale") == 0) {
    // ドレミファソラシド（C4〜C5）を2回。1音 0.30秒、間は 0.34秒
    int notes[8] = {60, 62, 64, 65, 67, 69, 71, 72};
    double t = 0.1;
    for (int rep = 0; rep < 2; rep++) {
      for (int i = 0; i < 8; i++) {
        Ev on = {t, {0x90, notes[i], 88}, 3}; Ev off = {t + 0.30, {0x80, notes[i], 0}, 3};
        evs.push_back(on); evs.push_back(off); t += 0.34;
      }
      t += 0.45;
    }
  } else {
    FILE* in = fopen(argv[1], "r"); if (!in) { perror("events"); return 1; }
    char line[256];
    while (fgets(line, sizeof line, in)) {
      double t; int b[3] = {0, 0, 0};
      int n = sscanf(line, "%lf %d %d %d", &t, &b[0], &b[1], &b[2]);
      if (n >= 2) { Ev e; e.t = t; e.n = n - 1; memcpy(e.b, b, sizeof b); evs.push_back(e); }
    }
    fclose(in);
  }
  std::stable_sort(evs.begin(), evs.end(), [](const Ev& a, const Ev& b) { return a.t < b.t; });

  tsf* f = tsf_load_filename(argv[3]);
  if (!f) { fprintf(stderr, "SF2 を開けません\n"); return 1; }
  tsf_set_output(f, TSF_STEREO_INTERLEAVED, RATE, -3.0f);
  int piano = atoi(argv[4]);
  tsf_channel_set_presetnumber(f, 0, piano, 0);   // チャンネル1: ピアノ（など）
  tsf_channel_set_presetnumber(f, 9, 0, 1);       // チャンネル10: ドラム

  std::vector<short> pcm;
  long cur = 0; int maxVoices = 0; int noteOns = 0;
  auto renderTo = [&](long target) {
    while (cur < target) {
      int n = (int)std::min<long>(target - cur, 512);
      size_t at = pcm.size(); pcm.resize(at + n * 2);
      tsf_render_short(f, &pcm[at], n, 0);
      cur += n;
      int v = tsf_active_voice_count(f); if (v > maxVoices) maxVoices = v;
    }
  };
  for (const Ev& e : evs) {
    renderTo((long)llround(e.t * RATE));
    int st = e.b[0] & 0xF0, ch = e.b[0] & 0x0F;
    if (st == 0x90 && e.b[2] > 0) { tsf_channel_note_on(f, ch, e.b[1], e.b[2] / 127.0f); noteOns++; }
    else if (st == 0x80 || st == 0x90) tsf_channel_note_off(f, ch, e.b[1]);
    else if (st == 0xB0 && e.b[1] == 123) tsf_channel_note_off_all(f, ch);
  }
  renderTo(cur + RATE * 3);   // 余韻
  if (const char* dp = getenv("DUMP")) {   // 正規化の前の波形の一部（開始フレーム,個数,出力先）
    long a0 = 0, cnt = 0; char path[256] = ""; sscanf(dp, "%ld,%ld,%255s", &a0, &cnt, path);
    FILE* df = fopen(path, "w");
    for (long i = a0; i < a0 + cnt; i++) fprintf(df, "%d %d\n", pcm[2 * i], pcm[2 * i + 1]);
    fclose(df);
  }
  if (const char* sp = getenv("STATS")) {   // 正規化の前の音の大きさ（左チャンネルのRMS、0.5秒ごと）を書き出す
    FILE* sf = fopen(sp, "w"); size_t win = RATE / 2;
    for (size_t i = 0; i + win <= pcm.size() / 2; i += win) {
      double acc2 = 0; for (size_t k = 0; k < win; k++) { double v = pcm[2 * (i + k)]; acc2 += v * v; }
      fprintf(sf, "%.2f\n", sqrt(acc2 / win));
    }
    fclose(sf);
  }
  // 音量をそろえる（最大でも約 -4dBFS）
  int peak = 1; for (short s : pcm) peak = std::max(peak, abs((int)s));
  float g = 0.63f * 32767.0f / peak;
  for (short& s : pcm) s = (short)lrintf(s * g);
  writeWav(argv[2], pcm, RATE);
  printf("%s: %.1f 秒, 発音 %d 回, 同時発音の最大 %d 声, 音量補正 x%.2f\n", argv[2], pcm.size() / 2.0 / RATE, noteOns, maxVoices, g);
  tsf_close(f);
  return 0;
}
