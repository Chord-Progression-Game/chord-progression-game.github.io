#include "ui_util.h"

#include <Arduino.h>
#include <ctype.h>
#include <string.h>

void printUidBytes(const TagUid& uid) {
  for (uint8_t i = 0; i < uid.size; i++) {
    if (i > 0) Serial.print(" ");
    if (uid.bytes[i] < 0x10) Serial.print("0");  // 1桁なら0を補う
    Serial.print(uid.bytes[i], HEX);
  }
}

char* trimInPlace(char* s) {
  while (*s == ' ' || *s == '\t') s++;
  size_t n = strlen(s);
  while (n > 0 && (s[n - 1] == ' ' || s[n - 1] == '\t')) s[--n] = '\0';
  return s;
}

bool isSingleCharCommand(const char* line, char command) {
  return line[0] != '\0' && line[1] == '\0' && tolower((unsigned char)line[0]) == command;
}
