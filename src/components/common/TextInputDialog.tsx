import { ReactNode, useEffect, useState } from "react";
import clsx from "clsx";

interface TextInputDialogProps {
    open: boolean;
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    initialValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmTone?: "primary" | "danger";
    allowEmpty?: boolean;
    onConfirm: (value: string) => void;
    onCancel: () => void;
}

const toneStyles = {
    danger: "bg-red-500 hover:bg-red-600 shadow-red-500/20",
    primary: "bg-[var(--accent)] hover:bg-[var(--accent)]/90 shadow-purple-900/20"
};

export function TextInputDialog({
    open,
    title,
    subtitle,
    icon,
    initialValue = "",
    placeholder,
    confirmLabel = "Save",
    cancelLabel = "Cancel",
    confirmTone = "primary",
    allowEmpty = false,
    onConfirm,
    onCancel
}: TextInputDialogProps) {
    const [value, setValue] = useState(initialValue);

    useEffect(() => {
        if (open) {
            setValue(initialValue);
        }
    }, [open, initialValue]);

    if (!open) return null;

    const isDisabled = !allowEmpty && !value.trim();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onCancel}>
            <div
                className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl w-[420px] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="h-14 border-b border-[var(--border)] flex items-center justify-between px-6 bg-[var(--bg-base)]">
                    <div className="flex items-center gap-3">
                        {icon && (
                            <div className="p-2 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
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
                    <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={placeholder}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-[var(--accent)]"
                        autoFocus
                    />
                    {allowEmpty && (
                        <p className="mt-2 text-[10px] text-zinc-500">Leave empty to clear the name.</p>
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
                        onClick={() => onConfirm(value)}
                        disabled={isDisabled}
                        className={clsx(
                            "px-4 py-2 rounded-lg text-white font-bold text-xs flex items-center gap-2 transition-colors shadow-lg",
                            toneStyles[confirmTone],
                            isDisabled && "opacity-60 cursor-not-allowed"
                        )}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
