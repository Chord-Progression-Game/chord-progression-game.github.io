#include "usb_midi.h"

#include <Arduino.h>
#include <string.h>

#include "sdkconfig.h"

#if CONFIG_TINYUSB_ENABLED && CONFIG_TINYUSB_MIDI_ENABLED

#include "USB.h"
#include "esp32-hal-tinyusb.h"

static bool started = false;
static char productName[33] = "ESP32 Chord";

// USBの「設定の説明書」（ディスクリプタ）に、MIDI機器として自分を書き込む。
// コアの USBVendor と同じ形。MIDI は インターフェースを2つ使う（音声の制御用 + MIDIのデータ用）
extern "C" uint16_t usb_midi_load_descriptor(uint8_t* dst, uint8_t* itf) {
  uint8_t strIndex = tinyusb_add_string_descriptor(productName);
  uint8_t ep = tinyusb_get_free_duplex_endpoint();
  if (ep == 0) return 0;
  uint8_t descriptor[TUD_MIDI_DESC_LEN] = {
      TUD_MIDI_DESCRIPTOR(*itf, strIndex, ep, (uint8_t)(0x80 | ep), 64),
  };
  *itf += 2;
  memcpy(dst, descriptor, TUD_MIDI_DESC_LEN);
  return TUD_MIDI_DESC_LEN;
}

bool usbMidiBegin(const char* deviceName) {
  if (started) return true;
  if (deviceName != nullptr && deviceName[0] != '\0') {
    strncpy(productName, deviceName, sizeof(productName) - 1);
    productName[sizeof(productName) - 1] = '\0';
  }
  if (tinyusb_enable_interface(USB_INTERFACE_MIDI, TUD_MIDI_DESC_LEN, usb_midi_load_descriptor) != ESP_OK) {
    return false;
  }
  USB.productName(productName);
  USB.manufacturerName("ESP32_Octo_01");
  if (!USB.begin()) return false;
  started = true;
  return true;
}

bool usbMidiStarted() { return started; }

bool usbMidiMounted() { return started && tud_midi_mounted(); }

void usbMidiWrite(const uint8_t* bytes, size_t len) {
  if (!usbMidiMounted()) return;
  // 送信用のバッファ（64バイト）に入りきらないときは、USBが送り出すのを少し待って、残りを送る
  for (int attempt = 0; attempt < 4 && len > 0; attempt++) {
    uint32_t written = tud_midi_stream_write(0, bytes, (uint32_t)len);
    if (written >= len) return;
    bytes += written;
    len -= written;
    delay(1);
  }
}

#else  // この環境では USB-MIDI を使えない

bool usbMidiBegin(const char*) { return false; }
bool usbMidiStarted() { return false; }
bool usbMidiMounted() { return false; }
void usbMidiWrite(const uint8_t*, size_t) {}

#endif
