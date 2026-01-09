export function StatusIndicator({
  status,
}: {
  status: { type: "error" | "loading" | "ready"; message: string };
}) {
  const dotColor = {
    error: "bg-red-500",
    loading: "bg-yellow-500",
    ready: "bg-green-500",
  }[status.type];

  return (
    <p className="flex items-center gap-2 mb-4">
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      <span className="text-muted-foreground">{status.message}</span>
    </p>
  );
}
