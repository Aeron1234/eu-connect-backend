"use client";

import {
  Clock,
  FileCheck,
  FileText,
  Star,
  User,
  ClipboardCheck,
  Hourglass,
  History,
  AlertTriangle,
} from "lucide-react";

const iconMap = {
  dtr: Clock,
  narratives: FileText,
  evaluations: Star,
  certificates: FileCheck,
  info: User,
  "evaluate-supervisor": ClipboardCheck,
  "pending-confirmation": Hourglass,
  "past-evaluations": History,
  disputed: AlertTriangle,
};

function TabBar({ tabs, selectedTab, onSelect }) {
  // Nothing to switch between — e.g. a student viewing another profile,
  // or an employer profile with no tabs beyond Info.
  if (tabs.length <= 1) return null;

  return (
    <ul className="flex gap-1">
      {tabs.map((t) => {
        const Icon = iconMap[t.value] || User;
        return (
          <li key={t.value} className="flex-1 sm:flex-0">
            <button
              type="button"
              onClick={() => onSelect(t.value)}
              title={t.text}
              className={`flex w-full items-center justify-center gap-0 sm:gap-1.5 px-2 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                t.value === selectedTab
                  ? "bg-primary-500 text-primary-foreground shadow-sm"
                  : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="sr-only sm:not-sr-only">{t.text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default TabBar;
