import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { audioLevel, requestMicrophonePermission, silenceTimedOut } from "./voice-input-button";

describe("VoiceInputButton", () => {
    it("requests and returns the browser microphone stream for live waveform analysis", async () => {
        const stop = vi.fn();
        const stream = { getTracks: () => [{ stop }] };
        const getUserMedia = vi.fn().mockResolvedValue(stream);

        const result = await requestMicrophonePermission({ getUserMedia });

        expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
        expect(result).toBe(stream);
        expect(stop).not.toHaveBeenCalled();
    });

    it("reports when the browser cannot request a microphone", async () => {
        await expect(requestMicrophonePermission(undefined)).rejects.toThrow("MICROPHONE_UNAVAILABLE");
    });

    it("shows a slim live waveform and stops after five seconds of silence", async () => {
        const source = await readFile(resolve(process.cwd(), "src/components/conversation/voice-input-button.tsx"), "utf8");

        expect(source).toContain('aria-live="polite"');
        expect(source).toContain('role="status"');
        expect(source).toContain("data-voice-wave-bar");
        expect(source).toContain("SILENCE_TIMEOUT_MS = 5_000");
        expect(source).toContain("getByteTimeDomainData");
        expect(source).toContain("连续静音五秒后自动停止");
    });

    it("measures silence and audible samples", () => {
        expect(audioLevel(new Uint8Array([128, 128, 128, 128]))).toBe(0);
        expect(audioLevel(new Uint8Array([96, 160, 96, 160]))).toBeGreaterThan(0.2);
    });

    it("only stops after five continuous seconds of silence", () => {
        expect(silenceTimedOut(null, 7_000)).toBe(false);
        expect(silenceTimedOut(2_000, 6_999)).toBe(false);
        expect(silenceTimedOut(2_000, 7_000)).toBe(true);
    });
});
