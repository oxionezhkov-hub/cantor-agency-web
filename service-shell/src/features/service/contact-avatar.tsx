import { useState } from "react";
import type { Lead } from "./crm.ts";
export function Avatar({ lead }: { lead: Lead }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="chat-avatar" aria-hidden="true">
      {lead.avatarUrl?.startsWith("https://") && !failed ? (
        <img src={lead.avatarUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        lead.name.slice(0, 1)
      )}
    </span>
  );
}
