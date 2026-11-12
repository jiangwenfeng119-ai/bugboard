import {
  IconAlert,
  IconBan,
  IconCheck,
  IconClock,
  IconStamp,
  IconInbox,
  IconMessage,
  IconWrench,
} from "./Icons";
import type { BugStatus } from "@/lib/types";

export function StatIcon({
  kind,
}: {
  kind: BugStatus | "total";
}) {
  const common = { size: 18 } as const;
  switch (kind) {
    case "total":
      return <IconInbox {...common} />;
    case "pending":
      return <IconAlert {...common} />;
    case "fixing":
      return <IconWrench {...common} />;
    case "needs_info":
      return <IconMessage {...common} />;
    case "needs_product":
      return <IconStamp {...common} />;
    case "awaiting_confirm":
      return <IconClock {...common} />;
    case "confirmed":
      return <IconCheck {...common} />;
    case "acknowledged":
      return <IconStamp {...common} />;
    case "invalid":
      return <IconBan {...common} />;
  }
}
