#include "midi_protocol.h"

static uint8_t clamp7(uint8_t v) { return v > 127 ? 127 : v; }  // MIDIのデータは 0〜127

size_t midiBuildNoteOn(uint8_t channel, uint8_t note, uint8_t velocity, uint8_t* out) {
  out[0] = 0x90 | (channel & 0x0F);
  out[1] = clamp7(note);
  out[2] = clamp7(velocity);
  return 3;
}

size_t midiBuildNoteOff(uint8_t channel, uint8_t note, uint8_t* out) {
  out[0] = 0x80 | (channel & 0x0F);
  out[1] = clamp7(note);
  out[2] = 0;
  return 3;
}

size_t midiBuildProgramChange(uint8_t channel, uint8_t program, uint8_t* out) {
  out[0] = 0xC0 | (channel & 0x0F);
  out[1] = clamp7(program);
  return 2;
}

size_t midiBuildAllNotesOff(uint8_t channel, uint8_t* out) {
  out[0] = 0xB0 | (channel & 0x0F);
  out[1] = 123;  // All Notes Off
  out[2] = 0;
  return 3;
}

size_t midiFormatBridgeLine(const uint8_t* bytes, size_t len, char* out, size_t outSize) {
  static const char HEX_DIGITS[] = "0123456789ABCDEF";
  size_t need = MIDI_BRIDGE_PREFIX_LEN + len * 3 + 1 + 1;  // "~M " + "xx " × len + "\n" + '\0'
  if (outSize < need) return 0;
  size_t n = 0;
  out[n++] = '~';
  out[n++] = 'M';
  out[n++] = ' ';
  for (size_t i = 0; i < len; i++) {
    out[n++] = HEX_DIGITS[bytes[i] >> 4];
    out[n++] = HEX_DIGITS[bytes[i] & 0x0F];
    out[n++] = ' ';
  }
  out[n++] = '\n';
  out[n] = '\0';
  return n;
}
