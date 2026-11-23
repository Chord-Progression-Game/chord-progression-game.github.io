#pragma once

// RC522 のテストモード（通常の動作中に x で入り、q で戻る）

bool testActive();                      // テストモード中か
void testEnter();                       // テストモードに入る
void testHandleLine(const char* line);  // テストモード中の入力（1行）
void testLoop();                        // テストモード中、loop() から毎回呼ぶ
