import clsx from "clsx";
import { ReactNode } from "react";

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    description?: string;
    body?: ReactNode;
    subtitle?: string;
    icon?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmTone?: "danger" | "primary";
    confirmDisabled?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    widthClassName?: string;
}

const toneStyles = {
    danger: {
        icon: "bg-red-500/10 text-red-400",
        confirm: "bg-red-500 hover:bg-red-600 shadow-red-500/20"
    },
    primary: {
        icon: "bg-[var(--accent)]/10 text-[var(--accent)]",
        confirm: "bg-[var(--accent)] hover:bg-[var(--accent)]/90 shadow-purple-900/20"
    }
};

export function ConfirmDialog({
    open,
    title,
    description,
    body,
    subtitle,
    icon,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    confirmTone = "danger",
    confirmDisabled = false,
    onConfirm,
    onCancel,
    widthClassName = "w-[400px]"
}: ConfirmDialogProps) {
    if (!open) return null;

    const tone = toneStyles[confirmTone];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onCancel}>
            <div
                className={clsx(
                    "bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200",
                    widthClassName
                )}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="h-14 border-b border-[var(--border)] flex items-center justify-between px-6 bg-[var(--bg-base)]">
                    <div className="flex items-center gap-3">
                        {icon && (
                            <div className={clsx("p-2 rounded-lg", tone.icon)}>
                                {icon}
                            </div>
                        )}
                        <div>
                            <h2 className="font-bold text-sm tracking-tight">{title}</h2>
                            {subtitle && (
                                <p className="text-[10px] text-zinc-500 truncate max-w-[260px]">{subtitle}</p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-6">
                    {body ? body : (
                        <p className="text-sm text-zinc-300 leading-relaxed">{description}</p>
                    )}
                </div>

                <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-base)] flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-[var(--border)] font-medium text-xs flex items-center gap-2 transition-colors"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={confirmDisabled}
                        className={clsx(
                            "px-4 py-2 rounded-lg text-white font-bold text-xs flex items-center gap-2 transition-colors shadow-lg",
                            tone.confirm,
                            confirmDisabled && "opacity-60 cursor-not-allowed"
                        )}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
