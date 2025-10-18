"use client";

import { useState } from "react";
import { Button } from "../../primitives/button.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { LoadingSpinner } from "../LoadingSpinner.js";

export interface DeleteButtonProps {
  onDelete: () => Promise<{ success: boolean; error?: string }>;
  itemName?: string;
  confirmTitle?: string;
  confirmMessage?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  buttonLabel?: string;
  variant?: "danger" | "warning";
  buttonVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  disabled?: boolean;
}

/**
 * Standalone delete button with confirmation dialog
 * Can be embedded in any custom page
 *
 * @example
 * ```tsx
 * <DeleteButton
 *   onDelete={async () => {
 *     await deletePost(postId);
 *     return { success: true };
 *   }}
 *   itemName="post"
 *   confirmMessage="This will permanently delete the post and all its comments."
 * />
 * ```
 */
export function DeleteButton({
  onDelete,
  itemName = "item",
  confirmTitle,
  confirmMessage,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  buttonLabel = "Delete",
  variant = "danger",
  buttonVariant = "destructive",
  size = "default",
  className,
  disabled = false,
}: DeleteButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setShowConfirm(false);
    setIsPending(true);
    setError(null);

    try {
      const result = await onDelete();
      if (!result.success) {
        setError(result.error || `Failed to delete ${itemName}`);
      }
    } catch (err: unknown) {
      setError((err as Error).message || `Failed to delete ${itemName}`);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size={size}
        onClick={() => setShowConfirm(true)}
        disabled={disabled || isPending}
        className={className}
      >
        {isPending && <LoadingSpinner size="sm" className="border-primary-foreground border-t-transparent mr-2" />}
        {buttonLabel}
      </Button>

      {error && (
        <div className="mt-2 bg-destructive/10 border border-destructive text-destructive rounded-lg p-3">
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <ConfirmDialog
        isOpen={showConfirm}
        title={confirmTitle || `Delete ${itemName}`}
        message={
          confirmMessage ||
          `Are you sure you want to delete this ${itemName}? This action cannot be undone.`
        }
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        variant={variant}
        onConfirm={handleDelete}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}
