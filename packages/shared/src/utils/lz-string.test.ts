import { describe, it, expect } from "bun:test";
import { decompressFromUTF16 } from "./lz-string";

describe("decompressFromUTF16", () => {
    // Pre-compressed UTF-16 fixtures produced by LZString.compressToUTF16
    const validCompressed = "ˢ䰭䰾怤ޔ䂼怩䠠 "; // "hello world"
    const longCompressed = "ၦ弹⺽忣઒⵻椆廯㰞ش㢳▾⋪坳㛚ㄠ "; // "A" x 1000
    const repeat500Compressed = "ၦ弹⺽忣઒⵻椆廯㰞ضࠠ "; // "A" x 500

    it("returns empty string when input is null or undefined", () => {
        expect(decompressFromUTF16(null)).toBe("");
        expect(decompressFromUTF16(undefined)).toBe("");
    });

    it("returns null when input is empty string", () => {
        expect(decompressFromUTF16("")).toBeNull();
    });

    it("returns null for corrupt/invalid compressed data", () => {
        expect(decompressFromUTF16("clearly_invalid_compressed_payload_xyz")).toBeNull();
    });

    it("successfully decompresses valid UTF-16 compressed text", () => {
        expect(decompressFromUTF16(validCompressed)).toBe("hello world");
    });

    it("throws an error when decompressed size exceeds maxDecompressedLength", () => {
        expect(() => {
            decompressFromUTF16(longCompressed, 500);
        }).toThrow("exceeds safety limit of 500 characters");
    });

    it("does not throw when decompressed size is within maxDecompressedLength", () => {
        expect(decompressFromUTF16(repeat500Compressed, 1000)).toBe("A".repeat(500));
    });
});
