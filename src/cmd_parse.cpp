#include "cmd_parse.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

const char* cmdSplitName(const char* line, char* name, size_t nameSize) {
  if (line == nullptr || nameSize < 2) return nullptr;
  while (*line == ' ' || *line == '\t') line++;
  size_t n = 0;
  const char* p = line;
  while (isalpha((unsigned char)*p)) {
    if (n + 1 >= nameSize) return nullptr;  // 長すぎる
    name[n++] = (char)toupper((unsigned char)*p++);
  }
  name[n] = '\0';
  if (n == 0) return nullptr;
  while (*p == ' ' || *p == '\t' || *p == '=') p++;
  return p;
}

bool cmdNextToken(const char** cursor, char* token, size_t tokenSize) {
  const char* p = *cursor;
  while (*p == ' ' || *p == '\t') p++;
  if (*p == '\0') {
    *cursor = p;
    return false;
  }
  size_t n = 0;
  while (*p != '\0' && *p != ' ' && *p != '\t') {
    if (n + 1 < tokenSize) token[n++] = *p;
    p++;
  }
  token[n] = '\0';
  *cursor = p;
  return true;
}

bool cmdRest(const char* cursor, char* text, size_t textSize) {
  while (*cursor == ' ' || *cursor == '\t') cursor++;
  size_t len = strlen(cursor);
  while (len > 0 && (cursor[len - 1] == ' ' || cursor[len - 1] == '\t')) len--;
  if (len == 0 || textSize == 0) return false;
  if (len >= textSize) len = textSize - 1;
  memcpy(text, cursor, len);
  text[len] = '\0';
  return true;
}

bool cmdParseInt(const char* text, long* value, bool* relative) {
  if (text == nullptr || *text == '\0') return false;
  bool rel = (*text == '+' || *text == '-');
  const char* digits = rel ? text + 1 : text;
  if (!cmdIsAllDigits(digits)) return false;
  if (strlen(digits) > 9) return false;  // 大きすぎる数
  *value = strtol(text, nullptr, 10);
  if (relative != nullptr) *relative = rel;
  return true;
}

bool cmdIsAllDigits(const char* text) {
  if (text == nullptr || *text == '\0') return false;
  for (const char* p = text; *p != '\0'; p++) {
    if (!isdigit((unsigned char)*p)) return false;
  }
  return true;
}

void cmdToUpper(char* text) {
  for (; *text != '\0'; text++) {
    if ((unsigned char)*text < 0x80) *text = (char)toupper((unsigned char)*text);
  }
}
