export const bidModes = [
  { value: "manual", label: "Вручную" },
  { value: "assist", label: "С рекомендациями" },
  { value: "position", label: "По позиции" },
];
export const timeOptions = Array.from({ length: 96 }, (_, i) => {
  const value = `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`;
  return { value, label: value };
});
