// @ts-nocheck -- Paint's canvas encoder takes structural canvas stand-ins.
import { describe, expect, test } from "bun:test";
import {
  encodeBmp,
  encodeCanvas,
  extensionFor,
} from "../site/apps/paint/file-formats.js";
import { createPaintHistory } from "../site/apps/paint/history.js";

describe("Paint", () => {
  describe("image formats", () => {
    test("encodes a valid bottom-up 24-bit BMP", () => {
      const bmp = encodeBmp({
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
      });
      const header = new DataView(bmp.buffer);
      expect(String.fromCharCode(bmp[0], bmp[1])).toBe("BM");
      expect(header.getUint32(2, true)).toBe(62);
      expect(header.getInt32(18, true)).toBe(2);
      expect(header.getInt32(22, true)).toBe(1);
      expect(header.getUint16(28, true)).toBe(24);
      expect([...bmp.slice(54, 60)]).toEqual([0, 0, 255, 0, 255, 0]);
    });

    test("pads BMP rows to four-byte boundaries", () => {
      const bmp = encodeBmp({
        width: 1,
        height: 2,
        data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]),
      });
      expect(bmp.length).toBe(54 + 2 * 4);
      expect(new DataView(bmp.buffer).getUint32(2, true)).toBe(bmp.length);
      expect([...bmp.slice(54, 62)]).toEqual([6, 5, 4, 0, 3, 2, 1, 0]);
    });

    test("uses BMP when a filename has no extension", () => {
      expect(extensionFor("untitled")).toBe("bmp");
      expect(extensionFor("photo.JPEG")).toBe("jpeg");
      // A leading dot starts the name, as on the disk.
      expect(extensionFor(".png")).toBe("bmp");
    });

    test("saves BMP and DIB files from canvas pixels", async () => {
      const canvas = {
        width: 1,
        height: 1,
        getContext: () => ({
          getImageData: () => ({
            width: 1,
            height: 1,
            data: new Uint8ClampedArray([255, 0, 0, 255]),
          }),
        }),
      };
      for (const name of ["picture.bmp", "picture.DIB", "untitled"]) {
        const url = await encodeCanvas(canvas, name);
        expect(url).toStartWith("data:image/bmp;base64,");
        const bytes = Buffer.from(url.split(",")[1], "base64");
        expect(bytes.subarray(0, 2).toString()).toBe("BM");
        expect([...bytes.subarray(54, 57)]).toEqual([0, 0, 255]);
      }
    });

    test("saves JPEG files as JPEG and other formats as PNG", async () => {
      const requested: string[] = [];
      const canvas = {
        toBlob(callback: (blob: Blob) => void, type: string) {
          requested.push(type);
          callback(new Blob([new Uint8Array([1, 2, 3])], { type }));
        },
      };
      expect(await encodeCanvas(canvas, "photo.jpg")).toBe(
        "data:image/jpeg;base64,AQID",
      );
      expect(await encodeCanvas(canvas, "photo.jpeg")).toStartWith(
        "data:image/jpeg;",
      );
      expect(await encodeCanvas(canvas, "anim.gif")).toStartWith(
        "data:image/png;",
      );
      expect(await encodeCanvas(canvas, "art.png")).toStartWith(
        "data:image/png;",
      );
      expect(requested).toEqual([
        "image/jpeg",
        "image/jpeg",
        "image/png",
        "image/png",
      ]);
    });
  });

  describe("history", () => {
    test("restores actual canvas states through undo and repeat", () => {
      const history = createPaintHistory(3);
      history.capture(1);
      history.capture(2);
      expect(history.undo(3)).toBe(2);
      expect(history.undo(2)).toBe(1);
      expect(history.redo(1)).toBe(2);
    });

    test("keeps the three undo levels supported by XP Paint", () => {
      const history = createPaintHistory();
      for (const state of [1, 2, 3, 4]) history.capture(state);
      expect(history.undo(5)).toBe(4);
      expect(history.undo(4)).toBe(3);
      expect(history.undo(3)).toBe(2);
      expect(history.undo(2)).toBeNull();
    });

    test("clears undo and repeat when a picture is opened or created", () => {
      const history = createPaintHistory(3);
      history.capture(1);
      history.clear();
      expect(history.undo(2)).toBeNull();
      expect(history.redo(2)).toBeNull();
    });
  });
});
