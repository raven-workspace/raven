import { Button, Dialog } from "../../ui";

/** Confirm-before-delete dialog, same shape as the log entry delete. */
export function ConfirmDelete({ title, error, pending, label, onConfirm, onCancel }: {
  title: string;
  error?: string;
  pending: boolean;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onCancel()}
      title={title}
      description={error ? <span role="alert" className="text-warn">{error}</span> : undefined}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>{label}</Button>
        </>
      }
    />
  );
}
