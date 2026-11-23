#include "bridge_link.h"

#include <Arduino.h>

static bool seen = false;
static uint32_t lastPingMs = 0;

void bridgeLinkPing() {
  lastPingMs = millis();
  seen = true;
}

bool bridgeLinkAlive() { return seen && (uint32_t)(millis() - lastPingMs) < BRIDGE_LINK_TIMEOUT_MS; }

void bridgeLinkReset() { seen = false; }

static bool buzzerOff = false;
void buzzerSetMuted(bool muted) { buzzerOff = muted; }
bool buzzerMuted() { return buzzerOff; }
bool buzzerAllowed() { return !buzzerOff && (uint32_t)millis() >= BUZZER_BOOT_QUIET_MS; }
