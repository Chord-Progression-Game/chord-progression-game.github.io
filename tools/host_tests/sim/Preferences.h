#pragma once
// パソコン上のテスト用の、偽の Preferences（NVS）。メモリの中に保存する。
// 本物と同じく、読み取り専用で開くとき、その名前空間がまだなければ失敗する。
#include <stddef.h>
#include <stdint.h>

class Preferences {
 public:
  bool begin(const char* name, bool readOnly = false);
  void end();
  size_t putBytes(const char* key, const void* value, size_t len);
  size_t getBytes(const char* key, void* buf, size_t maxLen);
  size_t getBytesLength(const char* key);
  bool isKey(const char* key);
  bool remove(const char* key);
  size_t putUChar(const char* key, uint8_t value);
  uint8_t getUChar(const char* key, uint8_t defaultValue = 0);

 private:
  const char* ns_ = nullptr;
  bool readOnly_ = false;
};

// テストから: 保存の中身を調べる／消す
bool simNvsHas(const char* ns, const char* key);
void simNvsClear();
