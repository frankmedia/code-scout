import Foundation
import Speech

// scout-stt: Apple-native speech-to-text helper bundled inside Code Scout.app
// Called by the Tauri `transcribe_audio_native` Rust command.
// Usage: scout-stt <audio_file_path>
// Outputs the transcript to stdout, error codes to stderr, exits 0 on success.

guard CommandLine.arguments.count >= 2 else {
    fputs("ERR:no_input\n", stderr)
    exit(1)
}

let audioPath = CommandLine.arguments[1]
let audioURL  = URL(fileURLWithPath: audioPath)

guard FileManager.default.fileExists(atPath: audioPath) else {
    fputs("ERR:file_not_found:\(audioPath)\n", stderr)
    exit(1)
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")) else {
    fputs("ERR:recognizer_unavailable\n", stderr)
    exit(1)
}

guard recognizer.isAvailable else {
    fputs("ERR:recognizer_unavailable\n", stderr)
    exit(1)
}

let request = SFSpeechURLRecognitionRequest(url: audioURL)
request.shouldReportPartialResults = false
request.taskHint = .dictation

let semaphore = DispatchSemaphore(value: 0)
var transcript = ""
var errorCode  = ""

SFSpeechRecognizer.requestAuthorization { status in
    switch status {
    case .authorized:
        recognizer.recognitionTask(with: request) { result, error in
            if let result = result, result.isFinal {
                transcript = result.bestTranscription.formattedString
                semaphore.signal()
            } else if let error = error {
                errorCode = "ERR:recognition:\(error.localizedDescription)"
                semaphore.signal()
            }
        }
    case .denied:
        errorCode = "ERR:not_authorized"
        semaphore.signal()
    case .restricted:
        errorCode = "ERR:restricted"
        semaphore.signal()
    case .notDetermined:
        errorCode = "ERR:not_authorized"
        semaphore.signal()
    @unknown default:
        errorCode = "ERR:unknown_auth"
        semaphore.signal()
    }
}

// Wait up to 30 seconds for recognition to complete
let timeout = DispatchTime.now() + .seconds(30)
if semaphore.wait(timeout: timeout) == .timedOut {
    fputs("ERR:timeout\n", stderr)
    exit(1)
}

if !errorCode.isEmpty {
    fputs("\(errorCode)\n", stderr)
    exit(1)
}

print(transcript)
