// gm_synth: Mac 標準の GM 音源（Apple の MIDI シンセ + gs_instruments.dls）で、
//   ピアノ（MIDIチャンネル1）とドラム（チャンネル10）を、同時に鳴らす小さなアプリ。
//   tools/midi_bridge.py が作る仮想MIDIポート「ESP32 Chord Prototype」から MIDI を受け取る。
//   GarageBand は「選んだ1つのトラック」でしか鳴らせないので、ドラムも鳴らしたいときはこちらを使う。
//
// 使い方:  tools/gm_synth/gm_synth                 （ブリッジを動かしてから。Ctrl+C で終了）
//          tools/gm_synth/gm_synth --selftest      （音を出さずに、音色の読み込みと、ドラムの音が出るかを検査する）
import AVFoundation
import AudioToolbox
import CoreMIDI
import Foundation

let dlsPath = "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls"
let portFilter = CommandLine.arguments.contains("--port")
    ? CommandLine.arguments[(CommandLine.arguments.firstIndex(of: "--port") ?? 0) + 1] : "ESP32 Chord Prototype"
let selfTest = CommandLine.arguments.contains("--selftest")

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

// ---- 音源 ----
let engine = AVAudioEngine()
let desc = AudioComponentDescription(
    componentType: kAudioUnitType_MusicDevice, componentSubType: kAudioUnitSubType_MIDISynth,
    componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0)
let synth = AVAudioUnitMIDIInstrument(audioComponentDescription: desc)
engine.attach(synth)
engine.connect(synth, to: engine.mainMixerNode, format: nil)

// 音色バンク（GM）を指定する。エンジンを動かす前に設定する
var bankURL = URL(fileURLWithPath: dlsPath) as CFURL
let status = AudioUnitSetProperty(
    synth.audioUnit, AudioUnitPropertyID(kMusicDeviceProperty_SoundBankURL), AudioUnitScope(kAudioUnitScope_Global), 0,
    &bankURL, UInt32(MemoryLayout<CFURL>.size))
if status != noErr { fail("音色バンクを読み込めませんでした (\(status)): \(dlsPath)") }

if selfTest {
    // 画面にも耳にも出さず、メモリの中で音を作って、音が出るかを調べる
    let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
    do {
        try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
        try engine.start()
    } catch { fail("エンジンを始められませんでした: \(error)") }
    synth.sendProgramChange(0, onChannel: 0)  // ピアノ
    let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: 4096)!

    // 指定の音を鳴らして、鳴らした直後(0〜0.3秒)と、少しあと(0.8〜1.1秒)の音の大きさ(RMS)を返す
    func measure(channel: UInt8, note: UInt8) -> (Float, Float) {
        synth.sendMIDIEvent(0x90 | channel, data1: note, data2: 100)
        var early: Float = 0, late: Float = 0, total = 0
        while total < 44100 * 12 / 10 {
            do { _ = try engine.renderOffline(4096, to: buffer) } catch { fail("書き出せませんでした: \(error)") }
            let n = Int(buffer.frameLength)
            let samples = buffer.floatChannelData![0]
            for i in 0..<n {
                let t = total + i
                let v = samples[i] * samples[i]
                if t < 13230 { early += v }
                if t >= 35280 && t < 48510 { late += v }
            }
            total += n
        }
        synth.sendMIDIEvent(0x80 | channel, data1: note, data2: 0)
        return (sqrtf(early / 13230), sqrtf(late / 13230))
    }
    let piano = measure(channel: 0, note: 48)
    for _ in 0..<12 { _ = try? engine.renderOffline(4096, to: buffer) }   // 余韻を流す
    let kick = measure(channel: 9, note: 36)
    for _ in 0..<12 { _ = try? engine.renderOffline(4096, to: buffer) }
    let hat = measure(channel: 9, note: 42)
    print(String(format: "ピアノ(ch1, ノート48): 直後 %.4f / 0.8秒後 %.4f", piano.0, piano.1))
    print(String(format: "ドラム(ch10, キック36): 直後 %.4f / 0.8秒後 %.4f", kick.0, kick.1))
    print(String(format: "ドラム(ch10, ハイハット42): 直後 %.4f / 0.8秒後 %.4f", hat.0, hat.1))
    let ok = piano.0 > 0.001 && kick.0 > 0.001 && hat.0 > 0.001
    print(ok ? "OK: ピアノもドラムも、音が出ています（耳での確認は別）" : "NG: 無音のものがあります")
    exit(ok ? 0 : 2)
}

do { try engine.start() } catch { fail("オーディオを始められませんでした: \(error)") }

// ---- MIDI 入力 ----
var client = MIDIClientRef()
var inPort = MIDIPortRef()
var connected = Set<MIDIEndpointRef>()

func sourceName(_ src: MIDIEndpointRef) -> String {
    var cf: Unmanaged<CFString>?
    MIDIObjectGetStringProperty(src, kMIDIPropertyDisplayName, &cf)
    return (cf?.takeRetainedValue() as String?) ?? ""
}

func connectSources() {
    for i in 0..<MIDIGetNumberOfSources() {
        let src = MIDIGetSource(i)
        let name = sourceName(src)
        if name.contains(portFilter) && !connected.contains(src) {
            if MIDIPortConnectSource(inPort, src, nil) == noErr {
                connected.insert(src)
                print("つなぎました: \(name)")
            }
        }
    }
}

func handle(_ bytes: [UInt8]) {
    var i = 0
    while i < bytes.count {
        let s = bytes[i]
        guard s >= 0x80 else { i += 1; continue }
        let kind = s & 0xF0
        if kind == 0xC0 || kind == 0xD0 {
            if i + 1 < bytes.count { synth.sendMIDIEvent(s, data1: bytes[i + 1]) }
            i += 2
        } else if kind < 0xF0 {
            if i + 2 < bytes.count { synth.sendMIDIEvent(s, data1: bytes[i + 1], data2: bytes[i + 2]) }
            i += 3
        } else {
            i += 1
        }
    }
}

MIDIClientCreateWithBlock("gm_synth" as CFString, &client) { _ in connectSources() }   // 仮想ポートが増えたら、つなぎ直す
MIDIInputPortCreateWithBlock(client, "in" as CFString, &inPort) { list, _ in
    for packet in list.unsafeSequence() {
        let length = Int(packet.pointee.length)
        let bytes = withUnsafeBytes(of: packet.pointee.data) { Array($0.prefix(length)) }
        handle(bytes)
    }
}
connectSources()
print("GM音源を起動しました（ピアノ=チャンネル1、ドラム=チャンネル10）。「\(portFilter)」の MIDI を待っています。Ctrl+C で終了。")

signal(SIGINT, SIG_IGN)
let sigSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
sigSource.setEventHandler {
    for ch in 0..<16 { synth.sendMIDIEvent(UInt8(0xB0 | ch), data1: 123, data2: 0) }
    print("\n終了しました。")
    exit(0)
}
sigSource.resume()
RunLoop.main.run()
