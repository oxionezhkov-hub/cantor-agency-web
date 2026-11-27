import { useState } from "react";
type Preferences = { email: string; channels: boolean[]; events: boolean[] };
const defaults = (): Preferences => ({
  email: "",
  channels: [false, false],
  events: Array(8).fill(true),
});
function read(key: string): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (
      !value ||
      typeof value.email !== "string" ||
      !Array.isArray(value.channels) ||
      value.channels.length !== 2 ||
      !Array.isArray(value.events) ||
      value.events.length !== 8 ||
      ![...value.channels, ...value.events].every((v) => typeof v === "boolean")
    )
      return defaults();
    return { email: value.email, channels: value.channels, events: value.events };
  } catch {
    return defaults();
  }
}
// Only user-entered notification preferences; never account snapshots or API credentials.
export function useNotificationPreferences(scope: string, persist = true) {
  const key = `cantor.notifications.v1.${encodeURIComponent(scope)}`;
  const [preferences, setPreferences] = useState(() => (persist ? read(key) : defaults()));
  const [error, setError] = useState("");
  function update(patch: Partial<Preferences>) {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    if (!persist) return;
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setError("");
    } catch {
      setError(
        "Не удалось сохранить настройки уведомлений. Проверьте доступ к хранилищу браузера.",
      );
    }
  }
  return { ...preferences, update, error };
}
