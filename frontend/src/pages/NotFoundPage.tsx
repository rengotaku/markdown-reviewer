import { Link as RouterLink } from "react-router-dom";

import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="mt-16 text-center">
      <h1 className="mb-4 text-5xl font-bold tracking-tight">404</h1>
      <p className="mb-2 text-xl text-muted-foreground">Page Not Found</p>
      <p className="mb-6 text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Button asChild>
        <RouterLink to="/">Go to Home</RouterLink>
      </Button>
    </div>
  );
}
