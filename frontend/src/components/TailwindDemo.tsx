import { Rocket } from "lucide-react";

export function TailwindDemo() {
  return (
    <div
      data-testid="tailwind-demo"
      className="mt-4 p-4 rounded-lg border border-gray-200"
    >
      <p className="text-sm font-semibold text-gray-700 mb-2">Tailwind + Lucide Demo</p>
      <button
        type="button"
        className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
      >
        <Rocket size={16} />
        Tailwind Button
      </button>
    </div>
  );
}
