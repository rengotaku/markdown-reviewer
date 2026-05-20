import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import { useConfirm } from "@/hooks/useConfirm";

export function ConfirmDialog() {
  const pending = useConfirm((s) => s.pending);
  const resolve = useConfirm((s) => s.resolve);

  return (
    <Dialog
      open={Boolean(pending)}
      onClose={() => resolve(false)}
      aria-labelledby="confirm-dialog-title"
    >
      <DialogTitle id="confirm-dialog-title">{pending?.title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{pending?.message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => resolve(false)}>{pending?.cancelLabel}</Button>
        <Button onClick={() => resolve(true)} variant="contained" autoFocus>
          {pending?.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
