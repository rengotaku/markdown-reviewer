import { Link as RouterLink } from "react-router-dom";
import { CircleCheck } from "lucide-react";

import { TailwindDemo } from "@/components";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  "Vite + TypeScript",
  "React Router",
  "TanStack Query (API state)",
  "Zustand (UI state)",
  "ky (HTTP client)",
  "Vitest + Testing Library",
  "Tailwind CSS + shadcn/ui",
];

export function HomePage() {
  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold tracking-tight">React SPA Boilerplate</h1>

      <Card className="mb-6 max-w-md">
        <CardHeader>
          <CardTitle>Features</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {features.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-sm">
                <CircleCheck className="size-4 shrink-0 text-primary" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Button asChild>
        <RouterLink to="/users">Users</RouterLink>
      </Button>

      <TailwindDemo />
    </div>
  );
}
