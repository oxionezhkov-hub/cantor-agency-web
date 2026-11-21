export async function createAdCover(photo: string, title: string, format: string) {
  await document.fonts.ready;
  const image = new Image();
  image.src = photo;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось собрать обложку.");
  ctx.fillStyle = "#f1ede4";
  ctx.fillRect(0, 0, 960, 720);
  const scale = Math.min(462 / image.naturalWidth, 650 / image.naturalHeight);
  const width = image.naturalWidth * scale,
    height = image.naturalHeight * scale;
  ctx.drawImage(image, 474 + (462 - width) / 2, (720 - height) / 2, width, height);
  ctx.fillStyle = "#2a4239";
  ctx.fillRect(48, 82, 80, 4);
  ctx.font = "600 21px Geologica, sans-serif";
  ctx.fillText(format.toUpperCase(), 48, 136, 395);
  ctx.font = "500 51px Geologica, sans-serif";
  const lines: string[] = [];
  let current = "";
  for (const word of title.trim().split(/\s+/)) {
    const next = [current, word].filter(Boolean).join(" ");
    if (current && ctx.measureText(next).width > 390) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  lines.forEach((line, index) => ctx.fillText(line, 48, 250 + index * 62, 390));
  return canvas.toDataURL("image/jpeg", 0.9);
}
