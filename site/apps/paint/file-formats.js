const bytesToDataUrl = (bytes, type) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return `data:${type};base64,${btoa(binary)}`;
};

export const encodeBmp = (image) => {
  const { width, height, data } = image;
  const stride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = stride * height;
  const bytes = new Uint8Array(54 + pixelBytes);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  for (let y = 0; y < height; y += 1) {
    const sourceY = height - y - 1;
    for (let x = 0; x < width; x += 1) {
      const source = (sourceY * width + x) * 4;
      const destination = 54 + y * stride + x * 3;
      bytes[destination] = data[source + 2];
      bytes[destination + 1] = data[source + 1];
      bytes[destination + 2] = data[source];
    }
  }
  return bytes;
};

// Like the file system, a leading dot starts the name, not an extension.
export const extensionFor = (name) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "bmp";
};

export const encodeCanvas = async (canvas, name) => {
  const extension = extensionFor(name);
  if (["bmp", "dib"].includes(extension)) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    return bytesToDataUrl(
      encodeBmp(context.getImageData(0, 0, canvas.width, canvas.height)),
      "image/bmp",
    );
  }
  const type = ["jpg", "jpeg"].includes(extension) ? "image/jpeg" : "image/png";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type));
  return bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), type);
};
