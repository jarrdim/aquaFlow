import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export function DeliveryQueueLink({
  label = "Open delivery queue",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      api.notificationQueueCount()
        .then((result) => {
          if (active) setCount(Number(result.queued ?? 0));
        })
        .catch(() => {
          if (active) setCount(0);
        });
    void load();
    const timer = window.setInterval(load, 30_000);
    window.addEventListener("focus", load);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

  return (
    <Link
      to="/notifications/queue"
      className={`inline-flex items-center justify-center gap-2 ${className}`}
      aria-label={`${label}${count == null ? "" : `, ${count.toLocaleString()} queued`}`}
    >
      <span>{label}</span>
      <span className="rounded-full bg-black/15 px-2 py-0.5 text-xs font-extrabold leading-5 text-current ring-1 ring-inset ring-current/15">
        {count == null ? "…" : count.toLocaleString()}
      </span>
    </Link>
  );
}
