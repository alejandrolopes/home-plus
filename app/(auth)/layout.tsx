export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Home+</h1>
          <p className="text-muted-foreground text-sm">
            Gestão doméstica familiar
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
