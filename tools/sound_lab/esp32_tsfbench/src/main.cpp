// TinySoundFont（SF2 の音源エンジン）を ESP32-S3 で動かす測定。音は出さない（アンプなし）。
//  1) 3MB に絞った SF2 をフラッシュから読み、PSRAM に展開できるか
//  2) 実機から録った演奏（20.5秒）を、全力で計算して、Mac の結果と一致するか・何倍速か
//  3) 実際の時間に合わせて I2S に流し続けて、遅れないか（もう一方のコアで重い処理を回しながら）
#include <Arduino.h>
#include "driver/i2s.h"
#include "esp_partition.h"
#include "esp_heap_caps.h"
#define TSF_IMPLEMENTATION
#define TSF_NO_STDIO
#define TSF_MALLOC(s) heap_caps_malloc((s), MALLOC_CAP_SPIRAM)
#define TSF_REALLOC(p, s) heap_caps_realloc((p), (s), MALLOC_CAP_SPIRAM)
#define TSF_FREE(p) heap_caps_free(p)
#include "tsf.h"
#include "events.h"

static const int RATE = 44100;
static tsf* gTsf = nullptr;
static int16_t chunk[512 * 2];
static int16_t dumpBuf[1024 * 2];
static const uint32_t DUMP_AT = 200000;

static void applyEvent(const Ev& e) {
  int st = e.st & 0xF0, ch = e.st & 0x0F;
  if (st == 0x90 && e.d2 > 0) tsf_channel_note_on(gTsf, ch, e.d1, e.d2 / 127.0f);
  else if (st == 0x80 || st == 0x90) tsf_channel_note_off(gTsf, ch, e.d1);
  else if (st == 0xB0 && e.d1 == 123) tsf_channel_note_off_all(gTsf, ch);
}

struct RunResult { uint32_t totalUs, maxChunkUs; int maxVoices; uint32_t frames; double win[64]; int nwin; };

// realtime=false: 全力で計算して、0.5秒ごとの音の大きさを記録する
// realtime=true : 計算した音を I2S に流す（流す速さで進む）
static void playAll(bool realtime, RunResult* r) {
  static double winAcc[64];
  memset(winAcc, 0, sizeof(winAcc));
  uint32_t cur = 0, maxChunk = 0; int maxV = 0;
  uint32_t t0 = micros();
  auto renderTo = [&](uint32_t target) {
    while (cur < target) {
      int n = (int)min<uint32_t>(target - cur, 512);
      uint32_t a = micros();
      tsf_render_short(gTsf, chunk, n, 0);
      uint32_t d = micros() - a;
      if (d > maxChunk) maxChunk = d;
      if (!realtime) {
        for (int i = 0; i < n; i++) {
          uint32_t fr = cur + i;
          if (fr >= DUMP_AT && fr < DUMP_AT + 1024) { dumpBuf[2 * (fr - DUMP_AT)] = chunk[2 * i]; dumpBuf[2 * (fr - DUMP_AT) + 1] = chunk[2 * i + 1]; }
          double v = chunk[2 * i];
          uint32_t w = (cur + i) / (RATE / 2);
          if (w < 64) winAcc[w] += v * v;
        }
      } else {
        size_t written;
        i2s_write(I2S_NUM_0, chunk, n * 4, &written, portMAX_DELAY);
      }
      cur += n;
      int v = tsf_active_voice_count(gTsf); if (v > maxV) maxV = v;
    }
  };
  for (int i = 0; i < NEV; i++) { renderTo(EVS[i].at); applyEvent(EVS[i]); }
  renderTo(cur + RATE * 3);
  r->totalUs = micros() - t0; r->maxChunkUs = maxChunk; r->maxVoices = maxV; r->frames = cur;
  r->nwin = (int)(cur / (RATE / 2)); if (r->nwin > 64) r->nwin = 64;
  for (int w = 0; w < r->nwin; w++) r->win[w] = sqrt(winAcc[w] / (RATE / 2));
}

static void setupChannels() {
  tsf_reset(gTsf);
  tsf_channel_set_presetnumber(gTsf, 0, 0, 0);   // チャンネル1: ピアノ
  tsf_channel_set_presetnumber(gTsf, 9, 0, 1);   // チャンネル10: ドラム
}

static RunResult res;
static volatile bool taskDone = false;
static void rtTask(void*) { playAll(true, &res); taskDone = true; vTaskDelete(nullptr); }

static void realtimeTest(int core) {
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
  cfg.sample_rate = RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 6; cfg.dma_buf_len = 256;
  cfg.use_apll = false; cfg.tx_desc_auto_clear = true;
  if (i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL) != ESP_OK) { Serial.println("I2S 初期化に失敗"); return; }
  i2s_pin_config_t pins = {};
  pins.mck_io_num = I2S_PIN_NO_CHANGE; pins.bck_io_num = 38; pins.ws_io_num = 39; pins.data_out_num = 40; pins.data_in_num = I2S_PIN_NO_CHANGE;
  i2s_set_pin(I2S_NUM_0, &pins);
  setupChannels();
  taskDone = false;
  uint32_t t0 = millis();
  xTaskCreatePinnedToCore(rtTask, "rt", 16384, nullptr, 10, nullptr, core);
  while (!taskDone) {   // 読み取りのような重い処理（約150ms 計算 + 50ms 休み）を回し続ける
    uint32_t s = millis(); volatile uint32_t x = 0;
    while (millis() - s < 150 && !taskDone) { for (int i = 0; i < 2000; i++) x += i; }
    delay(50);
  }
  uint32_t el = millis() - t0;
  double expect = res.frames * 1000.0 / RATE;
  Serial.printf("  リアルタイム（音作りはコア%d・もう一方のコアは重い処理中）: 実時間 %u ms / 音の長さ %.0f ms（ずれ %+.2f%%）  1チャンク(512フレーム=11.6ms)の最大 %u µs  同時発音の最大 %d 声\n",
                core, (unsigned)el, expect, (el - expect) / expect * 100.0, (unsigned)res.maxChunkUs, res.maxVoices);
  i2s_driver_uninstall(I2S_NUM_0);
}


struct QResult { uint32_t totalUs, maxChunkUs; int maxVoices; uint32_t frames; uint32_t lateChunks; uint32_t maxLagMs; };
static QResult qres;
static void playQuant(int rate, int chunkFrames, bool realtime) {
  tsf_set_output(gTsf, TSF_STEREO_INTERLEAVED, rate, -3.0f);
  setupChannels();
  uint32_t cur = 0, maxChunk = 0; int maxV = 0, ei = 0; uint32_t late = 0, maxLag = 0;
  uint32_t total = (uint32_t)((uint64_t)EVS[NEV - 1].at * rate / 44100) + (uint32_t)rate * 3;
  uint32_t t0 = micros(), t0ms = millis();
  while (cur < total) {
    while (ei < NEV && (uint64_t)EVS[ei].at * rate / 44100 <= cur) applyEvent(EVS[ei++]);
    uint32_t a = micros();
    tsf_render_short(gTsf, chunk, chunkFrames, 0);
    uint32_t d = micros() - a; if (d > maxChunk) maxChunk = d;
    if (realtime) {
      size_t w; i2s_write(I2S_NUM_0, chunk, chunkFrames * 4, &w, portMAX_DELAY);
      uint32_t el = millis() - t0ms, want = (uint32_t)((uint64_t)cur * 1000 / rate);
      if (el > want + 150) {   // DMA に溜めた分（約35ms）より遅れた = 音が途切れている
        late++; if (el - want > maxLag) maxLag = el - want;
        vTaskDelay(1);         // 間に合わないときも、他のタスク（ウォッチドッグ）に時間を譲る
      }
    }
    cur += chunkFrames;
    int v = tsf_active_voice_count(gTsf); if (v > maxV) maxV = v;
  }
  qres.totalUs = micros() - t0; qres.maxChunkUs = maxChunk; qres.maxVoices = maxV; qres.frames = cur; qres.lateChunks = late; qres.maxLagMs = maxLag;
}
static void reportQ(const char* label, int rate, int chunkFrames) {
  double audioMs = qres.frames * 1000.0 / rate;
  Serial.printf("  %-34s %5d Hz・%3d フレーム/回: 計算 %6.0f ms / 音 %.0f ms → %4.2f 倍速（CPU 1コアの %5.1f%%）  最大 %6u µs（制限 %5.0f µs）",
                label, rate, chunkFrames, qres.totalUs / 1000.0, audioMs, audioMs / (qres.totalUs / 1000.0), qres.totalUs / 1000.0 / audioMs * 100.0,
                (unsigned)qres.maxChunkUs, chunkFrames * 1e6 / rate);
  Serial.printf("  同時発音の最大 %d 声\n", qres.maxVoices);
}
static volatile bool qTaskDone = false; static int qRate, qChunk;
static void qTask(void*) { playQuant(qRate, qChunk, true); qTaskDone = true; vTaskDelete(nullptr); }
static void realtimeQuant(int rate, int chunkFrames, int core) {
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
  cfg.sample_rate = rate; cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT; cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S; cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 6; cfg.dma_buf_len = 256; cfg.use_apll = false; cfg.tx_desc_auto_clear = true;
  if (i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL) != ESP_OK) { Serial.println("I2S 初期化に失敗"); return; }
  i2s_pin_config_t pins = {};
  pins.mck_io_num = I2S_PIN_NO_CHANGE; pins.bck_io_num = 38; pins.ws_io_num = 39; pins.data_out_num = 40; pins.data_in_num = I2S_PIN_NO_CHANGE;
  i2s_set_pin(I2S_NUM_0, &pins);
  qRate = rate; qChunk = chunkFrames; qTaskDone = false;
  uint32_t t0 = millis();
  xTaskCreatePinnedToCore(qTask, "q", 16384, nullptr, 10, nullptr, core);
  while (!qTaskDone) {   // もう一方のコアでは、読み取りのような重い処理を回し続ける
    uint32_t s = millis(); volatile uint32_t x = 0;
    while (millis() - s < 150 && !qTaskDone) { for (int i = 0; i < 2000; i++) x += i; }
    delay(50);
  }
  uint32_t el = millis() - t0; double expect = qres.frames * 1000.0 / rate;
  Serial.printf("  リアルタイム %5d Hz・%3d フレーム/回・コア%d: 実時間 %u ms / 音 %.0f ms（ずれ %+.2f%%）  遅れたチャンク %u 個・最大の遅れ %u ms\n",
                rate, chunkFrames, core, (unsigned)el, expect, (el - expect) / expect * 100.0, (unsigned)qres.lateChunks, (unsigned)qres.maxLagMs);
  i2s_driver_uninstall(I2S_NUM_0);
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n=== TinySoundFont を ESP32-S3 で動かす測定 ===");
  Serial.printf("PSRAM 空き %u KB / 内蔵RAM空き %u KB\n", (unsigned)(ESP.getFreePsram() >> 10), (unsigned)(ESP.getFreeHeap() >> 10));
  const esp_partition_t* p = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)0x40, "bank");
  if (!p) { Serial.println("bank パーティションが見つかりません"); return; }
  const void* ptr = nullptr; spi_flash_mmap_handle_t h;
  if (esp_partition_mmap(p, 0, 0x400000, SPI_FLASH_MMAP_DATA, &ptr, &h) != ESP_OK) { Serial.println("mmap に失敗"); return; }
  const uint8_t* b = (const uint8_t*)ptr;
  if (memcmp(b, "RIFF", 4) != 0 || memcmp(b + 8, "sfbk", 4) != 0) { Serial.println("bank に SF2 が入っていません"); return; }
  uint32_t size = *(const uint32_t*)(b + 4) + 8;
  Serial.printf("bank パーティション: %u KB、SF2 のサイズ %u KB\n", (unsigned)(p->size >> 10), (unsigned)(size >> 10));
  uint32_t t0 = millis();
  gTsf = tsf_load_memory(ptr, (int)size);
  uint32_t loadMs = millis() - t0;
  if (!gTsf) { Serial.println("tsf_load_memory に失敗（メモリ不足など）"); return; }
  Serial.printf("読み込み: %u ms、PSRAM 空き %u KB（使用 %u KB）、プリセット %d 個: ", (unsigned)loadMs, (unsigned)(ESP.getFreePsram() >> 10),
                (unsigned)((8189 * 1024 - ESP.getFreePsram()) >> 10), tsf_get_presetcount(gTsf));
  for (int i = 0; i < tsf_get_presetcount(gTsf); i++) Serial.printf("[%s] ", tsf_get_presetname(gTsf, i));
  Serial.println();
  tsf_set_output(gTsf, TSF_STEREO_INTERLEAVED, RATE, -3.0f);

  Serial.println("\n--- 1. 全力で計算（演奏 20.5 秒ぶん）---");
  setupChannels();
  playAll(false, &res);
  double audioMs = res.frames * 1000.0 / RATE;
  Serial.printf("  計算時間 %.0f ms / 音の長さ %.0f ms → %.1f 倍速（CPU 1コアの %.1f%% で足りる）  最大の512フレームは %u µs（制限 11610 µs）  同時発音の最大 %d 声\n",
                res.totalUs / 1000.0, audioMs, audioMs / (res.totalUs / 1000.0), res.totalUs / 1000.0 / audioMs * 100.0, (unsigned)res.maxChunkUs, res.maxVoices);
  Serial.print("DUMP:");
  for (int i = 0; i < 2048; i++) Serial.printf(" %d", dumpBuf[i]);
  Serial.println();
  Serial.print("WINRMS:");
  for (int w = 0; w < res.nwin; w++) Serial.printf(" %.2f", res.win[w]);
  Serial.println();

  Serial.println("\n--- 2. イベントをチャンクの境目で処理する進め方（本物のシンセと同じ。全力で計算）---");
  playQuant(44100, 512, false); reportQ("44.1kHz", 44100, 512);
  playQuant(44100, 256, false); reportQ("44.1kHz", 44100, 256);
  playQuant(44100, 64, false);  reportQ("44.1kHz", 44100, 64);
  playQuant(22050, 256, false); reportQ("22.05kHz（サンプル周波数を半分に）", 22050, 256);
  playQuant(22050, 128, false); reportQ("22.05kHz", 22050, 128);
  Serial.println("\n--- 3. リアルタイム試験（I2S に流し続ける。間に合わないと「遅れたチャンク」が増える）---");
  realtimeQuant(22050, 256, 0);
  realtimeQuant(22050, 256, 1);
  realtimeQuant(44100, 256, 0);
  Serial.println("\n=== 測定おわり ===");
}

void loop() { delay(1000); }
