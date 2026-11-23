#pragma once
// パソコン上のテスト用の、偽の Arduino.h。
// 本物の Serial の代わりに、表示した文字を集める（test_firmware_sim.cpp が内容を調べる）。
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <string>

#define HEX 16
#define DEC 10

class SimSerial {
 public:
  size_t write(uint8_t c);
  size_t print(const char* s);
  size_t print(char c);
  size_t print(int v, int base = DEC);
  size_t print(unsigned int v, int base = DEC);
  size_t print(unsigned char v, int base = DEC);
  size_t print(long v, int base = DEC);
  size_t print(unsigned long v, int base = DEC);
  size_t println();
  size_t println(const char* s);
  size_t println(int v);
  size_t printf(const char* format, ...) __attribute__((format(printf, 2, 3)));
  void flush() {}
};
extern SimSerial Serial;

uint32_t millis();
void delay(uint32_t ms);
void delayMicroseconds(uint32_t us);

// ---- テストから使う、偽の環境の操作 ----
std::string& simOut();            // Serial に出た文字の全部
void simSetMillis(uint32_t ms);   // 偽の時計を進める
