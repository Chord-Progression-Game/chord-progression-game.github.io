#include "midi_out.h"

#include <Arduino.h>

#include "midi_protocol.h"
#include "usb_midi.h"

static MidiBackend backend = MIDI_BACKEND_NONE;

// 1回に送れる最大のバイト数（これを超えるときは、分けて送る）
static const size_t MAX_SEND_BYTES = 192;

void midiBegin() {
  backend = MIDI_BACKEND_NONE;
}

MidiBackend midiBackend() { return backend; }

const char* midiBackendName() {
  switch (backend) {
    case MIDI_BACKEND_BRIDGE: return "ブリッジ（PCの tools/midi_bridge.py 経由）";
    case MIDI_BACKEND_USB:    return "USB-MIDI";
    default:                  return "なし（画面に表示するだけ）";
  }
}

bool midiUsbMounted() { return usbMidiMounted(); }

// 完成したMIDIメッセージを、いまの出力先に送る
static void send(const uint8_t* bytes, size_t len) {
  switch (backend) {
    case MIDI_BACKEND_BRIDGE: {
      char line[3 + MAX_SEND_BYTES * 3 + 2];  // "~M " + 1バイトあたり3文字 + 改行
      size_t n = midiFormatBridgeLine(bytes, len, line, sizeof(line));
      if (n > 0) Serial.write((const uint8_t*)line, n);  // 1回の書き込みで送る（途中に他の表示が割り込まない）
      break;
    }
    case MIDI_BACKEND_USB:
      usbMidiWrite(bytes, len);
      break;
    default:
      break;
  }
}

bool midiSetBackend(MidiBackend newBackend) {
  if (newBackend == backend) return true;
  midiAllNotesOff(0);  // 切り替える前に、いまの出力先の音を止める
  if (newBackend == MIDI_BACKEND_USB) {
    if (!usbMidiBegin("ESP32 Chord Prototype")) {
      backend = MIDI_BACKEND_NONE;
      return false;
    }
  }
  backend = newBackend;
  return true;
}

void midiSendMessages(const uint8_t* bytes, size_t len) {
  // 1つのメッセージを途中で切らないように、3バイトずつ（ノートオン・オフ）の区切りで分ける
  while (len > 0) {
    size_t n = len > MAX_SEND_BYTES ? (MAX_SEND_BYTES / 3) * 3 : len;
    send(bytes, n);
    bytes += n;
    len -= n;
  }
}

void midiProgramChange(uint8_t channel, uint8_t program) {
  uint8_t buf[2];
  size_t len = midiBuildProgramChange(channel, program, buf);
  send(buf, len);
}

void midiAllNotesOff(uint8_t channel) {
  uint8_t buf[3];
  size_t len = midiBuildAllNotesOff(channel, buf);
  send(buf, len);
}
