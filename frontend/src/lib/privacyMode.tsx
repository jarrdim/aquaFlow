import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type PrivacyModeValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

const PrivacyModeContext = createContext<PrivacyModeValue | null>(null);
const STORAGE_KEY = "aquaflow_demo_privacy_mode";

export function PrivacyModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(STORAGE_KEY) === "true");
  useEffect(() => { localStorage.setItem(STORAGE_KEY, String(enabled)); }, [enabled]);
  return <PrivacyModeContext.Provider value={{ enabled, setEnabled }}>{children}</PrivacyModeContext.Provider>;
}

export function usePrivacyMode() {
  const value = useContext(PrivacyModeContext);
  if (!value) throw new Error("usePrivacyMode must be used within PrivacyModeProvider");
  return value;
}

export function maskPhone(value?: string | null) {
  if (!value) return "—";
  const visible = value.replace(/\D/g, "");
  if (visible.length < 5) return "••••";
  return `${value.slice(0, 4)} ••• •${visible.slice(-2)}`;
}

export function maskEmail(value?: string | null) {
  if (!value) return "—";
  const [local, domain] = value.split("@");
  if (!domain) return "••••";
  return `${local.slice(0, 1)}•••@${domain}`;
}

export function maskAddress(value?: string | null) {
  if (!value) return "—";
  return "Address masked for demo";
}

export function maskName(value?: string | null) {
  if (!value) return "Customer masked";
  return "Customer masked for demo";
}

export function maskIdentifier(value?: string | null) {
  if (!value) return "—";
  return `••••••${value.slice(-4)}`;
}
