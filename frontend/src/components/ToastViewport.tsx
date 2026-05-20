import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import { useToast } from "@/hooks/useToast";

export function ToastViewport() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);
  const current = toasts[0];

  return (
    <Snackbar
      key={current?.id ?? "empty"}
      open={Boolean(current)}
      autoHideDuration={5000}
      onClose={() => current && dismiss(current.id)}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
    >
      {current ? (
        <Alert
          severity={current.severity}
          variant="filled"
          onClose={() => dismiss(current.id)}
          sx={{ width: "100%" }}
        >
          {current.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );
}
