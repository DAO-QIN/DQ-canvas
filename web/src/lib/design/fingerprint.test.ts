import { describe, expect, it } from "vitest";

import { sha256Hex } from "./fingerprint";

describe("Design fingerprint", () => {
    it.each([
        ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
        ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
        ["画板", "53f23afed6017d31516efa5bf50238fa6817d7b97a69438b41a106755df64ec7"],
    ])("matches the SHA-256 vector for %j", (value, expected) => {
        expect(sha256Hex(value)).toBe(expected);
    });
});
