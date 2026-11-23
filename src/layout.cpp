#include "layout.h"

#include <string.h>

Layout::Layout(int count) : count_(count < 1 ? 1 : (count > LAYOUT_MAX ? LAYOUT_MAX : count)), learning_(false), learnNext_(0) {
  memset(map_, 0, sizeof(map_));
  memset(backup_, 0, sizeof(backup_));
  memset(used_, 0, sizeof(used_));
  reset();
}

int Layout::readerOfPosition(int position) const {
  if (position < 0 || position >= count_) return -1;
  return map_[position];
}

int Layout::positionOfReader(int reader) const {
  for (int p = 0; p < count_; p++) {
    if (map_[p] == reader) return p;
  }
  return -1;
}

void Layout::reset() {
  learning_ = false;
  int front = count_ < 4 ? count_ : 4;
  for (int p = 0; p < front; p++) map_[p] = (uint8_t)(front - 1 - p);   // 先頭の4つは逆順
  for (int p = front; p < count_; p++) map_[p] = (uint8_t)p;            // 5つめ以降は配線順
}

bool Layout::set(const uint8_t* readers, int n) {
  if (n != count_) return false;
  bool seen[LAYOUT_MAX] = {false};
  for (int p = 0; p < n; p++) {
    if (readers[p] >= count_ || seen[readers[p]]) return false;
    seen[readers[p]] = true;
  }
  memcpy(map_, readers, (size_t)n);
  learning_ = false;
  return true;
}

void Layout::get(uint8_t* out) const { memcpy(out, map_, (size_t)count_); }

void Layout::learnBegin() {
  memcpy(backup_, map_, sizeof(map_));
  memset(used_, 0, sizeof(used_));
  learning_ = true;
  learnNext_ = 0;
}

Layout::LearnResult Layout::learnPlaced(int reader) {
  if (!learning_ || reader < 0 || reader >= count_ || used_[reader]) return LEARN_IGNORED;
  used_[reader] = true;
  map_[learnNext_] = (uint8_t)reader;
  learnNext_++;
  if (learnNext_ >= count_) {
    learning_ = false;
    return LEARN_COMPLETE;
  }
  return LEARN_ASSIGNED;
}

void Layout::learnFinish() {
  if (!learning_) return;
  int reader = 0;
  for (int p = learnNext_; p < count_; p++) {
    while (reader < count_ && used_[reader]) reader++;
    map_[p] = (uint8_t)reader;
    used_[reader] = true;
  }
  learning_ = false;
}

void Layout::learnCancel() {
  if (!learning_) return;
  memcpy(map_, backup_, sizeof(map_));
  learning_ = false;
}
