#include "buzzer.h"

#include <Arduino.h>
#include <math.h>
#include <string.h>

const int BUZZER_CHANNEL = 0;  // LEDC のチャンネル番号（0〜7のどれでもよい）
const int NOTE_MS = 150;       // 1音の長さ（ミリ秒）
const int GAP_MS = 30;         // 音と音のすき間（ミリ秒）
const int MAX_NOTES = 8;
const uint32_t BUZZER_SETTLE_MS = 25;  // 鳴り終わってから、読み取りを再開するまで待つ時間（電源の揺れが収まるのを待つ）

// MIDIノート番号 → 周波数(Hz)。A4 = 69 = 440Hz
static uint32_t midiToHz(uint8_t note) {
  return (uint32_t)(440.0f * powf(2.0f, (note - 69) / 12.0f) + 0.5f);
}

static uint8_t notes[MAX_NOTES];
static uint8_t noteCount = 0;
static uint8_t noteIndex = 0;
static uint32_t noteStartMs = 0;  // いまの音を鳴らし始めた時刻
static bool busy = false;
static uint32_t quietSince = 0;   // 最後に鳴り終わった時刻（0 = まだ鳴らしていない）

void buzzerBegin(int pin) {
  ledcSetup(BUZZER_CHANNEL, 2000, 10);   // チャンネルの設定（最初の周波数, 分解能10bit）
  ledcAttachPin(pin, BUZZER_CHANNEL);    // そのチャンネルをブザーのピンにつなぐ
  ledcWriteTone(BUZZER_CHANNEL, 0);      // 最初は無音
}

void buzzerPlayArpeggio(const uint8_t* midiNotes, uint8_t count) {
  if (count > MAX_NOTES) count = MAX_NOTES;
  if (count == 0) {
    busy = false;
    quietSince = millis();
    ledcWriteTone(BUZZER_CHANNEL, 0);
    return;
  }
  memcpy(notes, midiNotes, count);
  noteCount = count;
  noteIndex = 0;
  noteStartMs = millis();
  busy = true;
  ledcWriteTone(BUZZER_CHANNEL, midiToHz(notes[0]));  // 最初の音は、すぐ鳴らす
}

void buzzerTick() {
  if (!busy) return;
  uint32_t t = millis() - noteStartMs;
  if (t < (uint32_t)NOTE_MS) return;                       // 鳴らしている間
  if (t < (uint32_t)(NOTE_MS + GAP_MS)) {                  // 音と音のすき間
    ledcWriteTone(BUZZER_CHANNEL, 0);
    return;
  }
  noteIndex++;
  if (noteIndex >= noteCount) {                            // 鳴り終わった
    busy = false;
    quietSince = millis();
    ledcWriteTone(BUZZER_CHANNEL, 0);
    return;
  }
  noteStartMs += (uint32_t)(NOTE_MS + GAP_MS);
  ledcWriteTone(BUZZER_CHANNEL, midiToHz(notes[noteIndex]));
}

bool buzzerBusy() { return busy; }

bool buzzerHoldsReads() { return busy || (quietSince != 0 && (uint32_t)(millis() - quietSince) < BUZZER_SETTLE_MS); }
