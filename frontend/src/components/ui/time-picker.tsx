import * as React from "react";

import { cn } from "@/lib/utils";

export interface TimePickerProps {
  value?: string;
  onChange?: (value: string) => void;
  hourStep?: number;
  minuteStep?: number;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

const TimePicker = React.forwardRef<HTMLDivElement, TimePickerProps>(
  (
    {
      value = "00:00",
      onChange,
      hourStep = 1,
      minuteStep = 5,
      disabled = false,
      className,
      "aria-label": ariaLabel = "time",
    },
    ref
  ) => {
    const [rawHour, rawMinute] = value.split(":");
    const hour = rawHour ?? "00";
    const minute = rawMinute ?? "00";

    const hours = React.useMemo(
      () =>
        Array.from({ length: Math.floor(24 / hourStep) }, (_, i) => pad(i * hourStep)),
      [hourStep]
    );
    const minutes = React.useMemo(
      () =>
        Array.from({ length: Math.floor(60 / minuteStep) }, (_, i) =>
          pad(i * minuteStep)
        ),
      [minuteStep]
    );

    const update = (h: string, m: string) => onChange?.(`${h}:${m}`);

    const selectClass =
      "h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

    return (
      <div
        ref={ref}
        role="group"
        aria-label={ariaLabel}
        className={cn("inline-flex items-center gap-1", className)}
      >
        <select
          aria-label="hour"
          className={selectClass}
          value={hour}
          onChange={(e) => update(e.target.value, minute)}
          disabled={disabled}
        >
          {hours.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span aria-hidden className="text-sm text-muted-foreground">
          :
        </span>
        <select
          aria-label="minute"
          className={selectClass}
          value={minute}
          onChange={(e) => update(hour, e.target.value)}
          disabled={disabled}
        >
          {minutes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    );
  }
);
TimePicker.displayName = "TimePicker";

export { TimePicker };
