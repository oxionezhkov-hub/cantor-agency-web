export type CoverStyle = "cream" | "green";

async function loadImage(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

export async function createAdCover(
  portrait: string,
  background: string,
  title: string,
  subtitle: string,
  style: CoverStyle,
) {
  await document.fonts.ready;
  const [photo, artwork] = await Promise.all([loadImage(portrait), loadImage(background)]);
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось собрать обложку.");
  const dark = style === "green";
  const paper = dark ? "#233c33" : "#f2eee3";
  const ink = dark ? "#fcf4e3" : "#223e33";
  const backgroundScale = Math.max(960 / artwork.naturalWidth, 720 / artwork.naturalHeight);
  const bw = artwork.naturalWidth * backgroundScale;
  const bh = artwork.naturalHeight * backgroundScale;
  ctx.drawImage(artwork, (960 - bw) / 2, (720 - bh) / 2, bw, bh);
  const wash = ctx.createLinearGradient(0, 0, 960, 0);
  wash.addColorStop(0, paper);
  wash.addColorStop(0.47, paper);
  wash.addColorStop(1, dark ? "#233c3370" : "#f2eee370");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, 960, 720);

  const scale = Math.min(404 / photo.naturalWidth, 609 / photo.naturalHeight);
  const width = photo.naturalWidth * scale;
  const height = photo.naturalHeight * scale;
  const x = 511 + (404 - width) / 2;
  const y = (720 - height) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.min(width / 5, 70));
  ctx.clip();
  ctx.drawImage(photo, x, y, width, height);
  ctx.restore();

  const wrap = (value: string, max: number) => {
    const lines: string[] = [];
    let line = "";
    for (const word of value.trim().split(/\s+/)) {
      const next = [line, word].filter(Boolean).join(" ");
      if (line && ctx.measureText(next).width > max) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  ctx.fillStyle = ink;
  let size = 76;
  ctx.font = "600 76px Georgia, serif";
  let lines = wrap(title, 424);
  while (lines.length > 3 && size > 36) {
    size -= 4;
    ctx.font = `600 ${size}px Georgia, serif`;
    lines = wrap(title, 424);
  }
  const lineHeight = Math.ceil(size * 1.02);
  ctx.font = "500 28px Geologica, sans-serif";
  const captions = subtitle.trim() ? wrap(subtitle, 410) : [];
  const top =
    (720 - lines.length * lineHeight - (captions.length ? 33 + captions.length * 36 : 0)) / 2;
  ctx.fillRect(55, top - 32, 68, 3);
  ctx.textBaseline = "top";
  ctx.font = `600 ${size}px Georgia, serif`;
  lines.forEach((line, index) => ctx.fillText(line, 54, top + index * lineHeight, 424));
  ctx.font = "500 28px Geologica, sans-serif";
  captions.forEach((line, index) =>
    ctx.fillText(line, 56, top + lines.length * lineHeight + 33 + index * 36, 410),
  );
  return canvas.toDataURL("image/jpeg", 0.92);
}
