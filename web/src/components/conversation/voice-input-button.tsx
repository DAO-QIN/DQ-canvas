"use client";

import { App, Button, Tooltip } from "antd";
import { LoaderCircle, Mic, MicOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const SILENCE_TIMEOUT_MS = 5_000;
const SILENCE_THRESHOLD = 0.018;
const WAVEFORM_BAR_COUNT = 16;

type SpeechAlternative = { transcript: string };
type SpeechResult = { readonly length: number; readonly [index: number]: SpeechAlternative; readonly isFinal?: boolean };
type SpeechResultList = { readonly length: number; readonly [index: number]: SpeechResult };
type SpeechResultEvent = Event & { results: SpeechResultList; resultIndex?: number };
type SpeechErrorEvent = Event & { error: string };
type SpeechRecognitionInstance = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onresult: ((event: SpeechResultEvent) => void) | null;
    onerror: ((event: SpeechErrorEvent) => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;
type SpeechWindow = {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function VoiceInputButton({ disabled, onTranscribed }: { disabled?: boolean; onTranscribed: (text: string) => void }) {
    const { message } = App.useApp();
    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const transcribedRef = useRef(onTranscribed);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const silenceStartedAtRef = useRef<number | null>(null);
    const silenceStopRequestedRef = useRef(false);
    const waveformRef = useRef<HTMLSpanElement | null>(null);
    const [supported, setSupported] = useState(true);
    const [recording, setRecording] = useState(false);
    const [requesting, setRequesting] = useState(false);

    const renderWaveform = useCallback((frequencyData?: Uint8Array) => {
        const bars = waveformRef.current?.querySelectorAll<HTMLElement>("[data-voice-wave-bar]");
        bars?.forEach((bar, index) => {
            const idleHeight = 3 + (Math.abs(index - (WAVEFORM_BAR_COUNT - 1) / 2) % 3);
            const magnitude = frequencyData?.[Math.min(frequencyData.length - 1, index + 1)] || 0;
            const height = frequencyData ? 3 + Math.min(1, magnitude / 110) * 15 : idleHeight;
            bar.style.height = `${Math.round(height)}px`;
        });
    }, []);

    const stopAudioMonitoring = useCallback(() => {
        if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
        silenceStartedAtRef.current = null;
        silenceStopRequestedRef.current = false;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const audioContext = audioContextRef.current;
        audioContextRef.current = null;
        if (audioContext && audioContext.state !== "closed") void audioContext.close();
        renderWaveform();
    }, [renderWaveform]);

    const startAudioMonitoring = useCallback(
        (stream: MediaStream) => {
            stopAudioMonitoring();
            streamRef.current = stream;
            const AudioContextConstructor = window.AudioContext;
            if (!AudioContextConstructor) return;

            const audioContext = new AudioContextConstructor();
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.72;
            audioContext.createMediaStreamSource(stream).connect(analyser);
            audioContextRef.current = audioContext;
            const timeDomainData = new Uint8Array(analyser.fftSize);
            const frequencyData = new Uint8Array(analyser.frequencyBinCount);

            const sample = (timestamp: number) => {
                analyser.getByteTimeDomainData(timeDomainData);
                analyser.getByteFrequencyData(frequencyData);
                renderWaveform(frequencyData);

                if (audioLevel(timeDomainData) >= SILENCE_THRESHOLD) {
                    silenceStartedAtRef.current = null;
                } else if (silenceStartedAtRef.current === null) {
                    silenceStartedAtRef.current = timestamp;
                } else if (silenceTimedOut(silenceStartedAtRef.current, timestamp)) {
                    if (!silenceStopRequestedRef.current) {
                        silenceStopRequestedRef.current = true;
                        recognitionRef.current?.stop();
                        setRecording(false);
                        setRequesting(false);
                        stopAudioMonitoring();
                    }
                    return;
                }
                animationFrameRef.current = window.requestAnimationFrame(sample);
            };

            animationFrameRef.current = window.requestAnimationFrame(sample);
        },
        [renderWaveform, stopAudioMonitoring],
    );

    useEffect(() => {
        transcribedRef.current = onTranscribed;
    }, [onTranscribed]);

    useEffect(() => {
        const browser = window as unknown as SpeechWindow;
        const Recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
        if (!Recognition) {
            setSupported(false);
            return;
        }

        const recognition = new Recognition();
        recognition.lang = "zh-CN";
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.onstart = () => {
            setRequesting(false);
            setRecording(true);
        };
        recognition.onend = () => {
            setRequesting(false);
            setRecording(false);
            stopAudioMonitoring();
        };
        recognition.onresult = (event) => {
            const transcripts: string[] = [];
            for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
                const result = event.results[index];
                const transcript = result?.[0]?.transcript?.trim();
                if (transcript && result.isFinal !== false) transcripts.push(transcript);
            }
            if (transcripts.length) transcribedRef.current(transcripts.join(" "));
        };
        recognition.onerror = (event) => {
            setRequesting(false);
            setRecording(false);
            stopAudioMonitoring();
            if (event.error === "aborted") return;
            if (event.error === "not-allowed" || event.error === "service-not-allowed") showMicrophonePermissionHelp(message.error);
            else if (event.error === "no-speech") message.warning("没有检测到语音，请重试");
            else message.error("语音识别失败，请重试");
        };
        recognitionRef.current = recognition;
        return () => {
            recognition.abort();
            recognitionRef.current = null;
            stopAudioMonitoring();
        };
    }, [message, stopAudioMonitoring]);

    const toggle = () => {
        if (!supported) {
            message.info("当前浏览器不支持语音输入");
            return;
        }
        const recognition = recognitionRef.current;
        if (!recognition) return;
        if (recording) {
            recognition.stop();
            stopAudioMonitoring();
            return;
        }
        setRequesting(true);
        // getUserMedia is invoked synchronously from this click handler so the
        // browser owns and displays its native microphone permission prompt.
        void requestMicrophonePermission()
            .then((stream) => {
                startAudioMonitoring(stream);
                try {
                    recognition.start();
                } catch (error) {
                    stopAudioMonitoring();
                    throw error;
                }
            })
            .catch((error: unknown) => {
                setRequesting(false);
                if (isMicrophonePermissionError(error)) {
                    showMicrophonePermissionHelp(message.error);
                } else if (isMicrophoneUnavailableError(error)) {
                    message.info("当前浏览器无法申请麦克风权限");
                } else {
                    message.warning("语音输入正在切换，请稍后再试");
                }
            });
    };

    return (
        <div className="flex shrink-0 items-center gap-1.5" aria-live="polite">
            {requesting || recording ? (
                <span
                    ref={waveformRef}
                    className="flex h-7 w-24 shrink-0 items-center justify-center gap-[2px] rounded-[7px] border border-[#dfe4ea] bg-[#f4f6f8] px-2 text-[#657180] shadow-inner dark:border-[#343b44] dark:bg-[#252a31] dark:text-[#b4bdc8]"
                    role="status"
                >
                    <span className="sr-only">{requesting ? "等待麦克风授权" : "正在语音识别，连续静音五秒后自动停止"}</span>
                    {Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => (
                        <span
                            key={index}
                            data-voice-wave-bar
                            className={requesting ? "w-[2px] rounded-full bg-current opacity-45 transition-[height] duration-75" : "w-[2px] rounded-full bg-current transition-[height] duration-75"}
                            style={{ height: `${3 + (index % 4)}px` }}
                            aria-hidden="true"
                        />
                    ))}
                </span>
            ) : null}
            <Tooltip title={!supported ? "当前浏览器不支持语音输入" : recording ? "停止语音输入" : "语音输入"}>
                <Button
                    type="text"
                    shape="circle"
                    className={recording ? "!size-9 !min-w-9 !bg-red-50 !text-red-600 dark:!bg-red-500/12 dark:!text-red-300" : "!size-9 !min-w-9 !text-[#6f7b89] dark:!text-[#96a0ac]"}
                    icon={requesting ? <LoaderCircle className="size-4 animate-spin" /> : recording ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                    disabled={disabled || requesting}
                    onClick={toggle}
                    aria-label={recording ? "停止语音输入" : "语音输入"}
                    aria-pressed={recording}
                />
            </Tooltip>
        </div>
    );
}

export async function requestMicrophonePermission(mediaDevices: Pick<MediaDevices, "getUserMedia"> | undefined = navigator.mediaDevices) {
    if (!mediaDevices?.getUserMedia) throw new Error("MICROPHONE_UNAVAILABLE");
    return mediaDevices.getUserMedia({ audio: true });
}

export function audioLevel(samples: Uint8Array) {
    if (!samples.length) return 0;
    let sumOfSquares = 0;
    samples.forEach((sample) => {
        const normalized = (sample - 128) / 128;
        sumOfSquares += normalized * normalized;
    });
    return Math.sqrt(sumOfSquares / samples.length);
}

export function silenceTimedOut(silenceStartedAt: number | null, timestamp: number) {
    return silenceStartedAt !== null && timestamp - silenceStartedAt >= SILENCE_TIMEOUT_MS;
}

function isMicrophonePermissionError(error: unknown) {
    return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
}

function isMicrophoneUnavailableError(error: unknown) {
    return error instanceof Error && error.message === "MICROPHONE_UNAVAILABLE";
}

function showMicrophonePermissionHelp(showError: (content: string) => void) {
    showError("麦克风权限已被浏览器拦截，请在地址栏的网站权限中开启");
}
