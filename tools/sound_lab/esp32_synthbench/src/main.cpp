// ESP32-S3 に「ピアノ＋ドラムの音源」を載せられるかを測る、使い捨ての測定。
// 音は出さない（アンプなし）。計算にかかる時間・メモリ・リアルタイムに間に合うかだけを見る。
#include <Arduino.h>
#include <math.h>
#include <string.h>
#include "driver/i2s.h"
#include "esp_partition.h"
#include "esp_heap_caps.h"
#include "esp_flash.h"

static const int BLOCK = 256;           // 1回に作る音の数（フレーム）
static int16_t* sramBuf = nullptr;      // 内蔵RAM
static int16_t* psramBuf = nullptr;     // PSRAM（外付け8MB）
static const int16_t* flashBuf = nullptr;  // フラッシュ（メモリに見せかけて読む）
static const size_t REGION = 65536;     // 1つの音（サンプル）の長さ = 65536 サンプル = 128KB
static int32_t acc[BLOCK];
static int16_t sinTab[1024];

struct Voice {
  uint32_t pos, inc;
  int32_t vol;
  const int16_t* base;
  uint32_t len;
};
static Voice voices[40];

// ---- サンプル再生（線形補間つき）。ピアノやドラムの「録音した音」を鳴らす部分 ----
static void renderSamples(Voice* v, int nv, int frames) {
  for (int k = 0; k < nv; k++) {
    Voice& s = v[k];
    const int16_t* b = s.base;
    uint32_t pos = s.pos, inc = s.inc, lim = (s.len - 2) << 16;
    int32_t vol = s.vol;
    for (int i = 0; i < frames; i++) {
      uint32_t idx = pos >> 16;
      int32_t fr = pos & 0xFFFF;
      int32_t a = b[idx], c = b[idx + 1];
      int32_t smp = a + (((c - a) * fr) >> 16);
      acc[i] += (smp * vol) >> 15;
      pos += inc;
      if (pos >= lim) pos -= lim;
    }
    s.pos = pos;
  }
}

// ---- FM（2オペレーター）のエレピ風の音。録音データを使わずに作る部分 ----
struct Fm { uint32_t pc, pm, ic, im; int32_t env, depth; };
static Fm fms[40];
static void renderFm(Fm* f, int nf, int frames) {
  for (int k = 0; k < nf; k++) {
    Fm& o = f[k];
    uint32_t pc = o.pc, pm = o.pm, ic = o.ic, im = o.im;
    int32_t env = o.env, depth = o.depth;
    for (int i = 0; i < frames; i++) {
      int32_t m = (sinTab[(pm >> 22) & 1023] * depth) >> 15;                // 変調する波
      int32_t out = sinTab[((pc >> 22) + (uint32_t)(m >> 4)) & 1023];       // 搬送する波
      acc[i] += (out * env) >> 15;
      pc += ic; pm += im;
    }
    o.pc = pc; o.pm = pm;
  }
}

// ---- 簡単なリバーブ（響き）。コムフィルター4本＋オールパス2本 ----
static const int CL[4] = {1116, 1188, 1277, 1356};
static int16_t* combBuf[4];
static int combPos[4];
static int16_t* apBuf[2];
static int apPos[2];
static const int AL[2] = {556, 441};
static void renderReverb(int frames) {
  for (int i = 0; i < frames; i++) {
    int32_t in = acc[i] >> 2, sum = 0;
    for (int c = 0; c < 4; c++) {
      int32_t y = combBuf[c][combPos[c]];
      combBuf[c][combPos[c]] = (int16_t)(in + ((y * 26214) >> 15));
      if (++combPos[c] >= CL[c]) combPos[c] = 0;
      sum += y;
    }
    for (int a = 0; a < 2; a++) {
      int32_t y = apBuf[a][apPos[a]];
      int32_t w = sum + ((y * 16384) >> 15);
      apBuf[a][apPos[a]] = (int16_t)w;
      sum = y - ((w * 16384) >> 15);
      if (++apPos[a] >= AL[a]) apPos[a] = 0;
    }
    acc[i] += sum >> 2;
  }
}

static void initVoices(int n, const int16_t* region0, size_t stride) {
  for (int k = 0; k < n; k++) {
    voices[k].base = region0 + stride * k;
    voices[k].len = REGION;
    voices[k].pos = (uint32_t)(k * 997) << 16;
    voices[k].inc = (uint32_t)(65536.0 * (0.6 + 1.4 * k / (double)n));
    voices[k].vol = 8000;
  }
}

static uint32_t cyclesPerBlock(void (*fn)(), int reps) {
  uint32_t best = 0xFFFFFFFF, total = 0;
  for (int r = 0; r < reps; r++) {
    memset(acc, 0, sizeof(acc));
    uint32_t c0 = ESP.getCycleCount();
    fn();
    uint32_t c1 = ESP.getCycleCount();
    uint32_t d = c1 - c0;
    total += d;
    if (d < best) best = d;
  }
  return total / reps;
}

static int gN = 16;
static const int16_t* gRegion;
static size_t gStride;
static void runSample() { renderSamples(voices, gN, BLOCK); }
static void runFm() { renderFm(fms, gN, BLOCK); }
static void runReverb() { renderReverb(BLOCK); }

static void reportRow(const char* label, int n, uint32_t cyclesBlock) {
  double perFrameVoice = (double)cyclesBlock / BLOCK / (n ? n : 1);
  double load44 = (double)cyclesBlock / BLOCK * 44100.0 / 240e6 * 100.0;
  double load32 = (double)cyclesBlock / BLOCK * 32000.0 / 240e6 * 100.0;
  double load22 = (double)cyclesBlock / BLOCK * 22050.0 / 240e6 * 100.0;
  Serial.printf("  %-26s 声数=%2d  1フレーム・1声あたり %5.1f サイクル  CPU(1コア)使用率: 22kHz=%4.1f%% 32kHz=%4.1f%% 44.1kHz=%4.1f%%\n",
                label, n, perFrameVoice, load22, load32, load44);
}

// ---- リアルタイム試験: 実際に I2S へ流し続けて、時間どおりに進むかを見る ----
static volatile bool audioStop = false;
static volatile uint32_t audioBlocks = 0, audioMaxUs = 0, audioSumUs = 0;
struct RtParam { int fs; int nSample; int nFm; bool reverb; };
static RtParam rt;
static int16_t outBuf[BLOCK * 2];

static void audioTask(void*) {
  while (!audioStop) {
    uint32_t t0 = micros();
    memset(acc, 0, sizeof(acc));
    renderSamples(voices, rt.nSample, BLOCK);
    if (rt.nFm) renderFm(fms, rt.nFm, BLOCK);
    if (rt.reverb) renderReverb(BLOCK);
    for (int i = 0; i < BLOCK; i++) {
      int32_t v = acc[i] >> 3;
      if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
      outBuf[2 * i] = outBuf[2 * i + 1] = (int16_t)v;
    }
    uint32_t us = micros() - t0;
    audioSumUs += us;
    if (us > audioMaxUs) audioMaxUs = us;
    size_t written;
    i2s_write(I2S_NUM_0, outBuf, sizeof(outBuf), &written, portMAX_DELAY);
    audioBlocks++;
  }
  vTaskDelete(nullptr);
}

static void realtimeTest(const char* label, int fs, int nS, int nF, bool reverb, int core, int seconds) {
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
  cfg.sample_rate = fs;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 6;
  cfg.dma_buf_len = BLOCK;
  cfg.use_apll = false;
  cfg.tx_desc_auto_clear = true;
  if (i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL) != ESP_OK) { Serial.println("  I2S の初期化に失敗"); return; }
  i2s_pin_config_t pins = {};
  pins.mck_io_num = I2S_PIN_NO_CHANGE;
  pins.bck_io_num = 38;      // 何もつないでいない出力（測定用）
  pins.ws_io_num = 39;
  pins.data_out_num = 40;
  pins.data_in_num = I2S_PIN_NO_CHANGE;
  i2s_set_pin(I2S_NUM_0, &pins);

  rt = {fs, nS, nF, reverb};
  initVoices(nS, psramBuf, REGION);
  audioStop = false; audioBlocks = 0; audioMaxUs = 0; audioSumUs = 0;
  uint32_t t0 = millis();
  xTaskCreatePinnedToCore(audioTask, "audio", 8192, nullptr, 10, nullptr, core);
  // もう一方のコアで、読み取りのような重い処理（約150ms 計算 + 50ms 休み）を回し続ける
  while (millis() - t0 < (uint32_t)seconds * 1000) {
    uint32_t s = millis();
    volatile uint32_t x = 0;
    while (millis() - s < 150) { for (int i = 0; i < 2000; i++) x += i; }
    delay(50);
  }
  audioStop = true;
  uint32_t t1 = millis();
  delay(100);
  uint32_t blocks = audioBlocks;
  double expectedMs = blocks * (double)BLOCK * 1000.0 / fs;
  double elapsed = (double)(t1 - t0);
  double budgetUs = BLOCK * 1000000.0 / fs;
  Serial.printf("  %-34s fs=%5d 声=サンプル%2d+FM%2d リバーブ=%s コア%d: %u ブロック / 実時間 %.0f ms / 理論 %.0f ms (ずれ %+.1f%%)  1ブロック作成 平均 %.0f µs・最大 %u µs（制限 %.0f µs）\n",
                label, fs, nS, nF, reverb ? "あり" : "なし", core, (unsigned)blocks, elapsed, expectedMs,
                (elapsed - expectedMs) / expectedMs * 100.0, (double)audioSumUs / (blocks ? blocks : 1), (unsigned)audioMaxUs, budgetUs);
  i2s_driver_uninstall(I2S_NUM_0);
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("=== 音源の性能測定（音は出しません）===");
#ifdef __OPTIMIZE_SIZE__
  Serial.println("最適化: サイズ優先 (-Os)");
#else
  Serial.println("最適化: 速度優先 (-O2)");
#endif
  uint32_t phys = 0;
  esp_flash_get_physical_size(NULL, &phys);
  Serial.printf("チップ: %s rev%d, %d MHz, コア数 %d\n", ESP.getChipModel(), ESP.getChipRevision(), ESP.getCpuFreqMHz(), ESP.getChipCores());
  Serial.printf("フラッシュ: 実物 %u MB / ヘッダ上 %u MB   PSRAM: 全体 %u KB・空き %u KB   内蔵RAM空き %u KB\n",
                (unsigned)(phys >> 20), (unsigned)(ESP.getFlashChipSize() >> 20), (unsigned)(ESP.getPsramSize() >> 10),
                (unsigned)(ESP.getFreePsram() >> 10), (unsigned)(ESP.getFreeHeap() >> 10));

  for (int i = 0; i < 1024; i++) sinTab[i] = (int16_t)(32767.0 * sin(2.0 * M_PI * i / 1024.0));
  sramBuf = (int16_t*)heap_caps_malloc(REGION * 2 * 2, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);   // 256KB は無理 → 下で確認
  size_t sramRegions = 2;
  if (!sramBuf) { sramRegions = 0; Serial.println("内蔵RAMに 256KB を確保できません → 128KB で試します"); sramBuf = (int16_t*)heap_caps_malloc(REGION * 2, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT); sramRegions = 1; }
  psramBuf = (int16_t*)ps_malloc(REGION * 2 * 32);   // 128KB × 32 = 4MB
  if (!psramBuf || !sramBuf) { Serial.println("メモリ確保に失敗"); return; }
  // 中身: いくつかの正弦波の合成（実際のピアノの代わり。速度の測定には中身は影響しない）
  for (size_t r = 0; r < 32; r++) {
    for (size_t i = 0; i < REGION; i++) {
      double t = (double)i;
      double v = 0.5 * sin(t * 0.021 * (1 + r % 5)) + 0.3 * sin(t * 0.057 * (1 + r % 3)) + 0.15 * sin(t * 0.131);
      psramBuf[r * REGION + i] = (int16_t)(v * 20000);
    }
  }
  for (size_t r = 0; r < sramRegions; r++) memcpy(sramBuf + r * REGION, psramBuf + r * REGION, REGION * 2);

  const esp_partition_t* part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, NULL);
  if (part) {
    const void* ptr = nullptr;
    spi_flash_mmap_handle_t h;
    size_t sz = part->size < REGION * 2 * 12 ? part->size : REGION * 2 * 12;
    if (esp_partition_mmap(part, 0, sz, SPI_FLASH_MMAP_DATA, &ptr, &h) == ESP_OK) flashBuf = (const int16_t*)ptr;
    Serial.printf("フラッシュ上のデータ領域: %u KB（うち %u KB をメモリとして読む）\n", (unsigned)(part->size >> 10), (unsigned)(sz >> 10));
  }
  for (int k = 0; k < 40; k++) {
    fms[k].ic = (uint32_t)((110.0 * (1 + k % 7)) / 32000.0 * 4294967296.0);
    fms[k].im = fms[k].ic * 14 / 1;
    fms[k].pc = fms[k].pm = 0; fms[k].env = 8000; fms[k].depth = 12000;
  }
  for (int c = 0; c < 4; c++) { combBuf[c] = (int16_t*)calloc(CL[c], 2); combPos[c] = 0; }
  for (int a = 0; a < 2; a++) { apBuf[a] = (int16_t*)calloc(AL[a], 2); apPos[a] = 0; }

  Serial.println();
  Serial.println("--- 1. 計算の速さ（256フレームを作るのにかかるサイクル数。240MHz で 1サイクル = 約4.2ns）---");
  for (int n : {8, 16, 32}) {
    gN = n; initVoices(n, sramBuf, 0);   // 全員が同じ領域でも、1声ずつの計算量は同じ
    for (int k = 0; k < n; k++) voices[k].base = sramBuf + (REGION * (k % sramRegions));
    reportRow("サンプル再生（内蔵RAM）", n, cyclesPerBlock(runSample, 50));
  }
  for (int n : {8, 16, 32}) {
    gN = n; initVoices(n, psramBuf, REGION);
    reportRow("サンプル再生（PSRAM）", n, cyclesPerBlock(runSample, 50));
  }
  if (flashBuf) {
    for (int n : {8, 12}) {
      gN = n; initVoices(n, flashBuf, REGION);
      reportRow("サンプル再生（フラッシュ）", n, cyclesPerBlock(runSample, 50));
    }
  }
  for (int n : {8, 16, 32}) { gN = n; reportRow("FM（2オペレーター）", n, cyclesPerBlock(runFm, 50)); }
  gN = 1; reportRow("リバーブ（モノラル）", 1, cyclesPerBlock(runReverb, 50));

  Serial.println();
  Serial.println("--- 2. リアルタイム試験（I2S に流し続ける。もう一方のコアでは、読み取りのような重い処理を同時に回す）---");
  Serial.println("  ずれが +0.5%以内なら、時間どおりに進んでいる（途切れなし）。大きく正なら、音作りが間に合っていない");
  realtimeTest("サンプル16声", 32000, 16, 0, false, 0, 8);
  realtimeTest("サンプル16声+リバーブ", 32000, 16, 0, true, 0, 8);
  realtimeTest("サンプル24声+FM8声+リバーブ", 44100, 24, 8, true, 0, 8);
  realtimeTest("サンプル24声+FM8声+リバーブ", 44100, 24, 8, true, 1, 8);
  realtimeTest("サンプル32声+FM8声+リバーブ", 44100, 32, 8, true, 0, 8);
  Serial.println();
  Serial.println("=== 測定おわり ===");
}

void loop() { delay(1000); }
