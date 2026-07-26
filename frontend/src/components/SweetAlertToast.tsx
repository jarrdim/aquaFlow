import { ReactNode, isValidElement, useEffect } from "react";
import Swal, { SweetAlertIcon } from "sweetalert2";

type ToastType = Extract<SweetAlertIcon, "success" | "error" | "warning" | "info">;

type Props = {
  message?: ReactNode;
  type?: ToastType;
};

const recentToasts = new Map<string, number>();

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return "";
}

export function showToast(message: ReactNode, type: ToastType = "info") {
  const text = textFromNode(message).replace(/\s+/g, " ").trim();
  if (!text) return;

  const key = `${type}:${text}`;
  const now = Date.now();
  if (now - (recentToasts.get(key) ?? 0) < 500) return;
  recentToasts.set(key, now);

  void Swal.fire({
    toast: true,
    position: "top-end",
    icon: type,
    title: text,
    showConfirmButton: false,
    showCloseButton: true,
    timer: type === "error" ? 6500 : 4500,
    timerProgressBar: true,
    didOpen: (toast) => {
      toast.addEventListener("mouseenter", Swal.stopTimer);
      toast.addEventListener("mouseleave", Swal.resumeTimer);
    },
  });
}

export function SweetAlertToast({ message, type = "info" }: Props) {
  const text = textFromNode(message).replace(/\s+/g, " ").trim();

  useEffect(() => {
    if (text) showToast(text, type);
  }, [text, type]);

  return null;
}
