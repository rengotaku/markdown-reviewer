import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import { useToast } from "@/hooks/useToast";

export function ToastViewport() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);
  const current = toasts[0];

  // Actionable toasts stay on screen longer — the user shouldn't have to race
  // to click the link before it auto-dismisses.
  const autoHide = current?.action ? 10000 : 5000;

  return (
    <Snackbar
      key={current?.id ?? "empty"}
      open={Boolean(current)}
      autoHideDuration={autoHide}
      onClose={(_, reason) => {
        if (reason === "clickaway") return;
        if (current) dismiss(current.id);
      }}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
    >
      {current ? (
        <Alert
          severity={current.severity}
          variant="filled"
          onClose={() => dismiss(current.id)}
          sx={{ width: "100%" }}
          action={
            current.action ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  current.action?.onClick();
                  dismiss(current.id);
                }}
                data-testid="toast-action"
              >
                {current.action.label}
              </Button>
            ) : undefined
          }
        >
          {current.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );
}
